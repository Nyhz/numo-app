import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { getCountryAllocation } from "../countries";

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
  subtype?: string,
): string {
  const id = ulid();
  db.insert(schema.assets)
    .values({ id, name, assetType, subtype: subtype ?? null })
    .run();
  return id;
}

/** Seed a position valued at `valueEur` (1 unit priced at valueEur). */
function seedValued(db: DB, assetId: string, valueEur: number): void {
  db.insert(schema.assetPositions)
    .values({
      id: ulid(),
      assetId,
      quantity: 1,
      averageCost: valueEur,
      averageCostNative: valueEur,
      totalCostNative: valueEur,
      totalCostEur: valueEur,
    })
    .run();
  db.insert(schema.assetValuations)
    .values({
      id: ulid(),
      assetId,
      valuationDate: "2026-06-13",
      quantity: 1,
      unitPriceEur: valueEur,
      marketValueEur: valueEur,
      priceSource: "rebuilt",
    })
    .run();
}

function seedCountry(
  db: DB,
  assetId: string,
  country: string,
  weight: number,
  fetchedAt = 1000,
): void {
  db.insert(schema.assetCountryWeightings)
    .values({
      id: ulid(),
      assetId,
      country,
      weight,
      source: "justetf",
      fetchedAt,
    })
    .run();
}

describe("getCountryAllocation", () => {
  let db: DB;

  beforeEach(() => {
    db = makeDb();
  });

  it("returns empty on a fresh DB", async () => {
    const result = await getCountryAllocation(db);
    expect(result.slices).toEqual([]);
    expect(result.totalEur).toBe(0);
    expect(result.asOf).toBeNull();
  });

  it("folds each fund's countries into regions, weighted by EUR value", async () => {
    // ETF A: 10.000 € → 60% US (Norteamérica), 40% Japan (Asia)
    const a = seedAsset(db, "A", "etf");
    seedValued(db, a, 10000);
    seedCountry(db, a, "united_states", 0.6);
    seedCountry(db, a, "japan", 0.4);
    // ETF B: 5.000 € → 100% US
    const b = seedAsset(db, "B", "etf");
    seedValued(db, b, 5000);
    seedCountry(db, b, "united_states", 1);

    const result = await getCountryAllocation(db);
    expect(result.totalEur).toBe(15000);
    expect(result.unclassifiedEur).toBe(0);
    const na = result.slices.find((s) => s.region === "north_america");
    const asia = result.slices.find((s) => s.region === "asia");
    // Norteamérica = 0.6*10000 + 1*5000 = 11000; Asia = 4000
    expect(na?.valueEur).toBeCloseTo(11000);
    expect(asia?.valueEur).toBeCloseTo(4000);
    expect(na?.weight).toBeCloseTo(11000 / 15000);
    // biggest region first
    expect(result.slices[0]?.region).toBe("north_america");
  });

  it("groups multiple countries of the same continent into one region", async () => {
    const etf = seedAsset(db, "EU+Asia", "etf");
    seedValued(db, etf, 10000);
    // Three European countries collapse into a single "europe" slice.
    seedCountry(db, etf, "germany", 0.2);
    seedCountry(db, etf, "france", 0.2);
    seedCountry(db, etf, "switzerland", 0.1);
    seedCountry(db, etf, "japan", 0.5);

    const result = await getCountryAllocation(db);
    expect(result.slices.map((s) => s.region).sort()).toEqual(["asia", "europe"]);
    expect(result.slices.find((s) => s.region === "europe")?.valueEur).toBeCloseTo(
      5000,
    );
    expect(result.slices.find((s) => s.region === "asia")?.valueEur).toBeCloseTo(
      5000,
    );
  });

  it("omits crypto and commodities — they are not geographies", async () => {
    const etf = seedAsset(db, "ETF", "etf");
    seedValued(db, etf, 8000);
    seedCountry(db, etf, "united_states", 1);
    const crypto = seedAsset(db, "BTC", "crypto");
    seedValued(db, crypto, 1000); // not a country → omitted
    const gold = seedAsset(db, "Gold", "etf", "commodity");
    seedValued(db, gold, 3000); // not a country → omitted

    const result = await getCountryAllocation(db);
    expect(result.totalEur).toBe(12000);
    expect(result.classifiedEur).toBe(8000);
    expect(result.unclassifiedEur).toBe(4000);
    expect(result.slices.map((s) => s.region)).toEqual(["north_america"]);
    expect(result.slices[0]?.weight).toBeCloseTo(1);
  });

  it("omits positions with no country data instead of bucketing them", async () => {
    const etf = seedAsset(db, "ETF", "etf");
    seedValued(db, etf, 8000);
    seedCountry(db, etf, "united_states", 1);
    const stock = seedAsset(db, "Stock", "stock");
    seedValued(db, stock, 2000); // no country row → omitted

    const result = await getCountryAllocation(db);
    expect(result.totalEur).toBe(10000);
    expect(result.classifiedEur).toBe(8000);
    expect(result.unclassifiedEur).toBe(2000);
    expect(result.slices.map((s) => s.region)).toEqual(["north_america"]);
  });

  it("sinks the residual 'other' region below named regions", async () => {
    const etf = seedAsset(db, "ETF", "etf");
    seedValued(db, etf, 10000);
    seedCountry(db, etf, "united_states", 0.5); // north_america, 5000
    seedCountry(db, etf, "other", 0.5); // residual region, 5000 — must rank lower

    const result = await getCountryAllocation(db);
    expect(result.slices.map((s) => s.region)).toEqual([
      "north_america",
      "other",
    ]);
  });

  it("maps an unknown country to the residual 'other' region", async () => {
    const etf = seedAsset(db, "ETF", "etf");
    seedValued(db, etf, 1000);
    seedCountry(db, etf, "atlantis", 1); // not in the region map
    const result = await getCountryAllocation(db);
    expect(result.slices.map((s) => s.region)).toEqual(["other"]);
  });

  it("drops a fund's uncovered remainder from the chart", async () => {
    const fund = seedAsset(db, "Partial", "fund");
    seedValued(db, fund, 1000);
    seedCountry(db, fund, "united_states", 0.7); // only 70% covered
    const result = await getCountryAllocation(db);
    // The 30% with no country is omitted, not charted.
    expect(result.classifiedEur).toBeCloseTo(700);
    expect(result.unclassifiedEur).toBeCloseTo(300);
    const na = result.slices.find((s) => s.region === "north_america");
    expect(na?.valueEur).toBeCloseTo(700);
    expect(na?.weight).toBeCloseTo(1); // 100% of the classified part
  });

  it("reports the newest fetchedAt as asOf", async () => {
    const a = seedAsset(db, "A", "etf");
    seedValued(db, a, 1000);
    seedCountry(db, a, "united_states", 1, 5000);
    const b = seedAsset(db, "B", "etf");
    seedValued(db, b, 1000);
    seedCountry(db, b, "germany", 1, 9000);
    const result = await getCountryAllocation(db);
    expect(result.asOf).toBe(9000);
  });
});
