import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import {
  syncCountryWeightings,
  type CountryClient,
} from "../country-sync";
import type { CountryWeight } from "../pricing";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedAsset(
  db: DB,
  name: string,
  assetType: string,
  isin: string | null,
  opts: { isActive?: boolean; subtype?: string } = {},
): string {
  const id = ulid();
  db.insert(schema.assets)
    .values({
      id,
      name,
      assetType,
      isin,
      isActive: opts.isActive ?? true,
      subtype: opts.subtype ?? null,
    })
    .run();
  return id;
}

function fakeClient(table: Record<string, CountryWeight[]>): CountryClient {
  return {
    fetchCountryWeightings: vi.fn(async (isin: string) => {
      if (!(isin in table)) throw new Error(`no stub for ${isin}`);
      return table[isin];
    }),
  };
}

function countriesFor(db: DB, assetId: string) {
  return db
    .select()
    .from(schema.assetCountryWeightings)
    .where(eq(schema.assetCountryWeightings.assetId, assetId))
    .all();
}

const NOW = Date.UTC(2026, 5, 13, 8);
const DAY = 24 * 60 * 60 * 1000;

describe("syncCountryWeightings", () => {
  let db: DB;

  beforeEach(() => {
    db = makeDb();
  });

  it("returns an empty summary on a fresh DB", async () => {
    const summary = await syncCountryWeightings(db, fakeClient({}), NOW);
    expect(summary).toEqual({ refreshed: 0, skipped: 0, errors: [] });
  });

  it("stores the country breakdown for an ETF", async () => {
    const id = seedAsset(db, "VWCE", "etf", "IE00BK5BQT80");
    const client = fakeClient({
      IE00BK5BQT80: [
        { country: "united_states", weight: 0.65 },
        { country: "japan", weight: 0.06 },
        { country: "other", weight: 0.29 },
      ],
    });
    const summary = await syncCountryWeightings(db, client, NOW);
    expect(summary.refreshed).toBe(1);
    expect(client.fetchCountryWeightings).toHaveBeenCalledWith("IE00BK5BQT80");
    const rows = countriesFor(db, id);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.country).sort()).toEqual([
      "japan",
      "other",
      "united_states",
    ]);
    expect(
      rows.every((r) => r.fetchedAt === NOW && r.source === "justetf"),
    ).toBe(true);
  });

  it("records an error and stores nothing for an asset without an ISIN", async () => {
    const id = seedAsset(db, "No ISIN", "etf", null);
    const summary = await syncCountryWeightings(db, fakeClient({}), NOW);
    expect(summary.refreshed).toBe(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.message).toMatch(/ISIN/);
    expect(countriesFor(db, id)).toHaveLength(0);
  });

  it("ignores stocks, crypto and bonds entirely", async () => {
    seedAsset(db, "AAPL", "stock", "US0378331005");
    seedAsset(db, "BTC", "crypto", null);
    seedAsset(db, "BOND", "bond", "IE00BOND0001");
    const client = fakeClient({});
    const summary = await syncCountryWeightings(db, client, NOW);
    expect(summary.refreshed).toBe(0);
    expect(summary.errors).toEqual([]);
    expect(client.fetchCountryWeightings).not.toHaveBeenCalled();
  });

  it("skips commodity ETPs without calling JustETF", async () => {
    const id = seedAsset(db, "Gold", "etf", "IE00B4ND3602", {
      subtype: "commodity",
    });
    const client = fakeClient({ IE00B4ND3602: [] });
    const summary = await syncCountryWeightings(db, client, NOW);
    expect(summary.refreshed).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(client.fetchCountryWeightings).not.toHaveBeenCalled();
    expect(countriesFor(db, id)).toHaveLength(0);
  });

  it("skips a fund whose data is still fresh, refetches once stale", async () => {
    const id = seedAsset(db, "IS3N", "etf", "IE00BKM4GZ66");
    const client = fakeClient({
      IE00BKM4GZ66: [{ country: "united_states", weight: 0.6 }],
    });
    await syncCountryWeightings(db, client, NOW);
    expect(client.fetchCountryWeightings).toHaveBeenCalledTimes(1);

    // 20 days later: still within the 30-day freshness window → skip.
    const fresh = await syncCountryWeightings(db, client, NOW + 20 * DAY);
    expect(fresh.skipped).toBe(1);
    expect(fresh.refreshed).toBe(0);
    expect(client.fetchCountryWeightings).toHaveBeenCalledTimes(1);

    // 31 days later: stale → refetch.
    const stale = await syncCountryWeightings(db, client, NOW + 31 * DAY);
    expect(stale.refreshed).toBe(1);
    expect(client.fetchCountryWeightings).toHaveBeenCalledTimes(2);
    expect(countriesFor(db, id)[0]?.fetchedAt).toBe(NOW + 31 * DAY);
  });

  it("replaces the previous snapshot, dropping countries that fell out", async () => {
    const id = seedAsset(db, "VWCE", "etf", "IE00BK5BQT80");
    let payload: CountryWeight[] = [
      { country: "united_states", weight: 0.6 },
      { country: "germany", weight: 0.05 },
    ];
    const client: CountryClient = {
      fetchCountryWeightings: vi.fn(async () => payload),
    };
    await syncCountryWeightings(db, client, NOW);
    expect(countriesFor(db, id)).toHaveLength(2);

    payload = [{ country: "united_states", weight: 0.65 }];
    await syncCountryWeightings(db, client, NOW + 31 * DAY);
    const rows = countriesFor(db, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.country).toBe("united_states");
    expect(rows[0]?.weight).toBeCloseTo(0.65);
  });

  it("records an error and continues when a fetch fails", async () => {
    seedAsset(db, "GOOD", "etf", "IE00GOOD0001");
    seedAsset(db, "BAD", "etf", "IE00BAD00001");
    const client = fakeClient({
      IE00GOOD0001: [{ country: "united_states", weight: 0.5 }],
    });
    const summary = await syncCountryWeightings(db, client, NOW);
    expect(summary.refreshed).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.isin).toBe("IE00BAD00001");
  });
});
