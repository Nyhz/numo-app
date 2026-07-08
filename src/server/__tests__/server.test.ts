import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { listTransactions } from "../transactions";
import { getOverviewKpis } from "../overview";
import { listAccounts, getAccountsSummary } from "../accounts";
import { listAssetsWithFreshness } from "../assets";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("server read layer — fresh DB", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("listAccounts returns []", async () => {
    expect(await listAccounts(db)).toEqual([]);
  });

  it("getAccountsSummary reports zeros", async () => {
    const s = await getAccountsSummary(db);
    expect(s).toEqual({ count: 0, totalEur: 0, byCurrency: {} });
  });

  it("getOverviewKpis returns zeros (fresh DB smoke)", async () => {
    const kpis = await getOverviewKpis({ range: "ALL" }, db);
    expect(kpis.totalNetWorthEur).toBe(0);
    expect(kpis.cashEur).toBe(0);
    expect(kpis.investedEur).toBe(0);
    expect(kpis.unrealizedPnlEur).toBe(0);
  });

  it("listTransactions returns empty page", async () => {
    const page = await listTransactions({}, db);
    expect(page).toEqual({ items: [], nextCursor: null });
  });
});

describe("getOverviewKpis — cost fallback for unpriced positions", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("values a held position with no valuation at cost (no fake -100%)", async () => {
    db.insert(schema.accounts)
      .values({ id: "acc_mi", name: "MyInvestor", accountType: "investment", currency: "EUR" })
      .run();
    db.insert(schema.assets)
      .values({
        id: "ast_grp",
        name: "Groupama Trésorerie IC",
        assetType: "fund",
        symbol: "GROUPAMA",
        isin: "FR0000989626",
        priceSource: "ft",
        currency: "EUR",
        isActive: true,
      })
      .run();
    db.insert(schema.assetPositions)
      .values({
        id: "pos_grp",
        assetId: "ast_grp",
        quantity: 0.1736,
        averageCost: 44339.285714,
        totalCostEur: 7697.3,
      })
      .run();
    // No asset_valuations row → was previously valued at 0 → -100%.

    const kpis = await getOverviewKpis({ range: "ALL" }, db);
    expect(kpis.investedEur).toBeCloseTo(7697.3, 2);
    expect(kpis.investedMarketValueEur).toBeCloseTo(7697.3, 2);
    expect(kpis.totalNetWorthEur).toBeCloseTo(7697.3, 2);
    expect(kpis.unrealizedPnlEur).toBeCloseTo(0, 2);
    expect(kpis.unrealizedPnlPct ?? 0).toBeCloseTo(0, 6);
  });
});

describe("listAssetsWithFreshness — FT funds keyed by ISIN:CURRENCY", () => {
  it("finds freshness for an ft-sourced fund whose prices live under ISIN:CUR", async () => {
    const db = makeDb();
    db.insert(schema.assets)
      .values({
        id: "ast_grp",
        name: "Groupama Trésorerie IC",
        assetType: "fund",
        symbol: "GP",
        isin: "FR0000989626",
        priceSource: "ft",
        currency: "EUR",
        isActive: true,
      })
      .run();
    const pricedAt = Date.now() - 1000 * 60 * 60; // 1h ago → not stale
    db.insert(schema.priceHistory)
      .values({
        id: "ph_grp",
        symbol: "FR0000989626:EUR",
        pricedAt,
        pricedDateUtc: "2026-07-06",
        price: 620.12,
        source: "ft",
      })
      .run();

    const rows = await listAssetsWithFreshness(db);
    const grp = rows.find((r) => r.id === "ast_grp");
    expect(grp?.freshness).toEqual({ pricedAt, source: "ft" });
  });
});

describe("listTransactions — cursor round-trip", () => {
  it("paginates by tradedAt desc and accepts its own nextCursor", async () => {
    const db = makeDb();

    // Seed: one account, one asset, five transactions.
    db.insert(schema.accounts)
      .values({
        id: "acc_1",
        name: "Broker",
        currency: "EUR",
        accountType: "broker",
      })
      .run();
    db.insert(schema.assets)
      .values({ id: "ast_1", name: "ACME", assetType: "stock", currency: "EUR" })
      .run();

    const base = 1_700_000_000_000;
    for (let i = 0; i < 5; i++) {
      db.insert(schema.assetTransactions)
        .values({
          id: `tx_${i}`,
          accountId: "acc_1",
          assetId: "ast_1",
          transactionType: "buy",
          tradedAt: base + i * 1000,
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

    const first = await listTransactions({ limit: 2 }, db);
    expect(first.items).toHaveLength(2);
    expect(first.items[0].id).toBe("tx_4");
    expect(first.items[1].id).toBe("tx_3");
    expect(first.nextCursor).not.toBeNull();

    const second = await listTransactions(
      { limit: 2, cursor: first.nextCursor! },
      db,
    );
    expect(second.items).toHaveLength(2);
    expect(second.items[0].id).toBe("tx_2");
    expect(second.items[1].id).toBe("tx_1");
    expect(second.nextCursor).not.toBeNull();

    const third = await listTransactions(
      { limit: 2, cursor: second.nextCursor! },
      db,
    );
    expect(third.items).toHaveLength(1);
    expect(third.items[0].id).toBe("tx_0");
    expect(third.nextCursor).toBeNull();
  });
});
