import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { ensureBenchmarkHistory } from "../../lib/benchmark-sync";
import type { HistoricalBar } from "../../lib/pricing";
import { activateBenchmark } from "../../actions/benchmarks";
import { getBenchmarkSeries } from "../benchmarks";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedTradeAnchor(db: DB, iso: string) {
  db.insert(schema.accounts)
    .values({ id: "acc_1", name: "Broker", currency: "EUR", accountType: "broker" })
    .run();
  db.insert(schema.assets)
    .values({ id: "ast_1", name: "ACME", assetType: "stock", currency: "EUR" })
    .run();
  db.insert(schema.assetTransactions)
    .values({
      id: "tx_1",
      accountId: "acc_1",
      assetId: "ast_1",
      transactionType: "buy",
      tradedAt: new Date(`${iso}T12:00:00Z`).getTime(),
      quantity: 1,
      unitPrice: 100,
      tradeCurrency: "EUR",
      fxRateToEur: 1,
      tradeGrossAmount: 100,
      tradeGrossAmountEur: 100,
      cashImpactEur: -100,
      netAmountEur: -100,
    })
    .run();
}

function bars(...pairs: Array<[string, number]>): HistoricalBar[] {
  return pairs.map(([date, close]) => ({ date, close, currency: "EUR" }));
}

describe("ensureBenchmarkHistory", () => {
  it("backfills once and is a no-op while coverage is fresh", async () => {
    const db = makeDb();
    seedTradeAnchor(db, "2026-01-05");
    const today = new Date().toISOString().slice(0, 10);
    const fetchHistory = vi
      .fn()
      .mockResolvedValue(bars(["2025-12-22", 100], ["2026-01-05", 102], [today, 104]));

    const first = await ensureBenchmarkHistory(db, "msci-world", { fetchHistory });
    expect(first.fetched).toBe(true);
    expect(first.inserted).toBe(3);

    const second = await ensureBenchmarkHistory(db, "msci-world", { fetchHistory });
    expect(second.fetched).toBe(false);
    expect(second.inserted).toBe(0);
    expect(fetchHistory).toHaveBeenCalledTimes(1);
  });

  it("dedupes on (symbol, date) when re-fetching", async () => {
    const db = makeDb();
    seedTradeAnchor(db, "2026-01-05");
    // Stale tail (no close near today) forces a second fetch over the same span.
    const fetchHistory = vi
      .fn()
      .mockResolvedValue(bars(["2025-12-22", 100], ["2026-01-05", 102]));

    const first = await ensureBenchmarkHistory(db, "msci-world", { fetchHistory });
    const second = await ensureBenchmarkHistory(db, "msci-world", { fetchHistory });
    expect(first.inserted).toBe(2);
    expect(second.fetched).toBe(true);
    expect(second.inserted).toBe(0);
  });
});

describe("activateBenchmark action", () => {
  it("rejects unknown keys", async () => {
    const result = await activateBenchmark({ key: "ibex35" }, makeDb());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
  });

  it("writes an audit event when rows were inserted", async () => {
    const db = makeDb();
    seedTradeAnchor(db, "2026-01-05");
    const today = new Date().toISOString().slice(0, 10);
    const fetchHistory = vi.fn().mockResolvedValue(bars(["2026-01-05", 102], [today, 104]));

    const result = await activateBenchmark({ key: "msci-world" }, db, { fetchHistory });
    expect(result.ok).toBe(true);

    const audit = await db.select().from(schema.auditEvents).all();
    expect(audit).toHaveLength(1);
    expect(audit[0].entityType).toBe("benchmark");
    expect(audit[0].action).toBe("backfill");
  });
});

describe("getBenchmarkSeries", () => {
  function seedClose(db: DB, iso: string, price: number) {
    db.insert(schema.priceHistory)
      .values({
        id: `ph_${iso}`,
        symbol: "EUNL.DE",
        pricedAt: new Date(`${iso}T17:30:00Z`).getTime(),
        pricedDateUtc: iso,
        price,
        source: "test",
      })
      .run();
  }

  it("anchors at 100 on the first portfolio date and forward-fills gaps", async () => {
    const db = makeDb();
    // Fri 2026-01-09 close, weekend gap, Mon 2026-01-12 close.
    seedClose(db, "2026-01-09", 100);
    seedClose(db, "2026-01-12", 110);

    const dates = ["2026-01-09", "2026-01-10", "2026-01-11", "2026-01-12"];
    const [series] = await getBenchmarkSeries(["msci-world"], dates, db);
    expect(series.indexByDate["2026-01-09"]).toBeCloseTo(100, 6);
    expect(series.indexByDate["2026-01-10"]).toBeCloseTo(100, 6); // carried Friday
    expect(series.indexByDate["2026-01-12"]).toBeCloseTo(110, 6);
  });

  it("uses the nearest prior close as anchor and skips dates before the first close", async () => {
    const db = makeDb();
    seedClose(db, "2026-01-02", 200); // before the window → anchor
    seedClose(db, "2026-01-06", 210);

    const dates = ["2026-01-05", "2026-01-06"];
    const [series] = await getBenchmarkSeries(["msci-world"], dates, db);
    expect(series.indexByDate["2026-01-05"]).toBeCloseTo(100, 6);
    expect(series.indexByDate["2026-01-06"]).toBeCloseTo(105, 6);

    const empty = await getBenchmarkSeries(["sp500"], dates, db);
    expect(empty).toHaveLength(0); // no history → no line, never an error
  });
});
