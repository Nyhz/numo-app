/**
 * Tests ported from the deleted src/server/taxes.test.ts shim.
 * Covers FIFO realized-gains scenarios via buildTaxReport and interest
 * aggregation via getInterestForYear.
 */
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import { recomputeLotsForAsset } from "../lots";
import { buildTaxReport } from "../report";
import { getTaxYears } from "../years";
import { getInterestForYear } from "../interest";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedAccountAndAsset(db: DB, opts?: { assetCurrency?: string }) {
  db.insert(schema.accounts)
    .values({
      id: "acc_1",
      name: "Broker",
      currency: "EUR",
      accountType: "broker",
    })
    .run();
  db.insert(schema.assets)
    .values({
      id: "ast_1",
      name: "ACME",
      assetType: "stock",
      currency: opts?.assetCurrency ?? "EUR",
      assetClassTax: "listed_security",
    })
    .run();
}

type TradeSeed = {
  id: string;
  side: "buy" | "sell";
  tradedAt: number;
  quantity: number;
  unitPrice: number;
  tradeCurrency?: string;
  fxRateToEur?: number;
  feesEur?: number;
};

function insertTrade(db: DB, t: TradeSeed) {
  const tradeCurrency = t.tradeCurrency ?? "EUR";
  const fxRateToEur = t.fxRateToEur ?? 1;
  const gross = t.quantity * t.unitPrice;
  const grossEur = gross * fxRateToEur;
  const feesEur = t.feesEur ?? 0;
  const sign = t.side === "buy" ? -1 : 1;
  db.insert(schema.assetTransactions)
    .values({
      id: t.id,
      accountId: "acc_1",
      assetId: "ast_1",
      transactionType: t.side,
      tradedAt: t.tradedAt,
      quantity: t.quantity,
      unitPrice: t.unitPrice,
      tradeCurrency,
      fxRateToEur,
      tradeGrossAmount: gross,
      tradeGrossAmountEur: grossEur,
      cashImpactEur: sign * grossEur - feesEur,
      feesAmount: feesEur / fxRateToEur,
      feesAmountEur: feesEur,
      netAmountEur: sign * grossEur - feesEur,
    })
    .run();
}

const D = (iso: string) =>
  Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );

describe("buildTaxReport FIFO", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("FIFO across multiple buys with a partial sell", () => {
    seedAccountAndAsset(db);
    // Buy 10 @ 10 EUR (2026-01-10): cost 100
    insertTrade(db, { id: "tx_b1", side: "buy", tradedAt: D("2026-01-10"), quantity: 10, unitPrice: 10 });
    // Buy 10 @ 20 EUR (2026-02-10): cost 200
    insertTrade(db, { id: "tx_b2", side: "buy", tradedAt: D("2026-02-10"), quantity: 10, unitPrice: 20 });
    // Sell 15 @ 25 EUR (2026-06-01): consumes 10 @ 10 + 5 @ 20 = 200 cost
    insertTrade(db, { id: "tx_s1", side: "sell", tradedAt: D("2026-06-01"), quantity: 15, unitPrice: 25 });

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, "ast_1"); });
    const report = buildTaxReport(db, 2026);

    expect(report.sales).toHaveLength(1);
    const s = report.sales[0];
    expect(s.proceedsEur).toBe(15 * 25);
    expect(s.costBasisEur).toBeCloseTo(10 * 10 + 5 * 20, 6);
    expect(s.computableGainLossEur).toBeCloseTo(375 - 200, 6);
    expect(report.totals.realizedGainsEur).toBeCloseTo(175, 6);
    expect(report.totals.realizedLossesComputableEur).toBe(0);
    expect(report.totals.netComputableEur).toBeCloseTo(175, 6);
  });

  it("FIFO spanning years: only the sell-year's realized portion is counted", () => {
    seedAccountAndAsset(db);
    // 2025: buy 10 @ 10, sell 4 @ 15 (realized in 2025, must be excluded from 2026)
    insertTrade(db, { id: "tx_b_2025", side: "buy", tradedAt: D("2025-03-01"), quantity: 10, unitPrice: 10 });
    insertTrade(db, { id: "tx_s_2025", side: "sell", tradedAt: D("2025-09-01"), quantity: 4, unitPrice: 15 });
    // 2026: sell remaining 6 @ 20 — consumes leftover 6 from the 2025 buy at 10
    insertTrade(db, { id: "tx_s_2026", side: "sell", tradedAt: D("2026-04-01"), quantity: 6, unitPrice: 20 });

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, "ast_1"); });
    const r2026 = buildTaxReport(db, 2026);
    expect(r2026.sales).toHaveLength(1);
    expect(r2026.sales[0].transactionId).toBe("tx_s_2026");
    expect(r2026.sales[0].proceedsEur).toBe(120);
    expect(r2026.sales[0].costBasisEur).toBeCloseTo(60, 6);
    expect(r2026.sales[0].computableGainLossEur).toBeCloseTo(60, 6);

    const r2025 = buildTaxReport(db, 2025);
    expect(r2025.sales).toHaveLength(1);
    expect(r2025.sales[0].transactionId).toBe("tx_s_2025");
    expect(r2025.sales[0].computableGainLossEur).toBeCloseTo(60 - 40, 6);
  });

  it("returns empty aggregates with no throw for a zero-transactions year", () => {
    const report = buildTaxReport(db, 2026);
    expect(report.sales).toEqual([]);
    expect(report.totals.realizedGainsEur).toBe(0);
    expect(report.totals.realizedLossesComputableEur).toBe(0);
    expect(report.totals.netComputableEur).toBe(0);
  });

  it("non-EUR native: proceedsEur uses the fxRateToEur snapshot on the sell trade", () => {
    seedAccountAndAsset(db, { assetCurrency: "USD" });
    // Buy 10 @ $100 with fx 1.0 → cost EUR 1000
    insertTrade(db, {
      id: "tx_b_usd",
      side: "buy",
      tradedAt: D("2026-01-10"),
      quantity: 10,
      unitPrice: 100,
      tradeCurrency: "USD",
      fxRateToEur: 1.0,
    });
    // Sell 10 @ $120 with snapshot fx 0.9 → grossEur = 10*120*0.9 = 1080
    insertTrade(db, {
      id: "tx_s_usd",
      side: "sell",
      tradedAt: D("2026-06-01"),
      quantity: 10,
      unitPrice: 120,
      tradeCurrency: "USD",
      fxRateToEur: 0.9,
    });

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, "ast_1"); });
    const report = buildTaxReport(db, 2026);
    expect(report.sales).toHaveLength(1);
    const s = report.sales[0];
    // Must reflect the snapshot on the sell row, not a re-resolved rate.
    expect(s.proceedsEur).toBeCloseTo(1080, 6);
    expect(s.costBasisEur).toBeCloseTo(1000, 6);
    expect(s.computableGainLossEur).toBeCloseTo(80, 6);
  });
});

describe("getTaxYears", () => {
  it("returns empty array for an empty database", async () => {
    const db = makeDb();
    const years = await getTaxYears(db);
    expect(years).toEqual([]);
  });

  // Audit P5: years are now the contiguous min→max span (gap years render an
  // empty report) — computed from aggregates instead of loading every row.
  it("collects years from both trades and cash movements, sorted descending", async () => {
    const db = makeDb();
    db.insert(schema.accounts)
      .values({ id: "acc_1", name: "B", currency: "EUR", accountType: "broker" })
      .run();
    db.insert(schema.assets)
      .values({ id: "ast_1", name: "ACME", assetType: "stock", currency: "EUR", assetClassTax: "listed_security" })
      .run();
    insertTrade(db, { id: "tx_2024", side: "buy", tradedAt: D("2024-06-01"), quantity: 1, unitPrice: 10 });
    db.insert(schema.accountCashMovements)
      .values({
        id: ulid(),
        accountId: "acc_1",
        movementType: "interest",
        occurredAt: D("2026-03-01"),
        nativeAmount: 5,
        currency: "EUR",
        fxRateToEur: 1,
        cashImpactEur: 5,
      })
      .run();
    const years = await getTaxYears(db);
    expect(years).toEqual([2026, 2025, 2024]);
  });
});

describe("getInterestForYear", () => {
  it("aggregates only interest movements for the given year", async () => {
    const db = makeDb();
    db.insert(schema.accounts)
      .values({ id: "acc_1", name: "B", currency: "EUR", accountType: "broker" })
      .run();

    function insertMovement(id: string, type: string, when: number, eur: number) {
      db.insert(schema.accountCashMovements)
        .values({
          id,
          accountId: "acc_1",
          movementType: type,
          occurredAt: when,
          nativeAmount: eur,
          currency: "EUR",
          fxRateToEur: 1,
          cashImpactEur: eur,
        })
        .run();
    }

    insertMovement("m1", "interest", D("2026-04-01"), 10);
    insertMovement("m2", "interest", D("2026-09-01"), 5);
    // Other year — ignored
    insertMovement("m3", "interest", D("2025-06-01"), 999);
    // Other kind — ignored
    insertMovement("m4", "deposit", D("2026-01-01"), 1000);

    const result = await getInterestForYear(2026, db);
    expect(result.grossEur).toBeCloseTo(15, 6);
    expect(result.withholdingEur).toBe(0);

    const other = await getInterestForYear(2025, db);
    expect(other.grossEur).toBeCloseTo(999, 6);

    const empty = await getInterestForYear(2027, db);
    expect(empty.grossEur).toBe(0);
    expect(empty.withholdingEur).toBe(0);
  });

  it("re-adds the recorded withholding to the gross and reports it as payment on account", async () => {
    const db = makeDb();
    db.insert(schema.accounts)
      .values({ id: "acc_1", name: "B", currency: "EUR", accountType: "savings" })
      .run();
    // Bank credits €81 net of the 19% withholding on a €100 gross interest.
    db.insert(schema.accountCashMovements)
      .values({
        id: "int_net",
        accountId: "acc_1",
        movementType: "interest",
        occurredAt: D("2026-04-01"),
        nativeAmount: 81,
        currency: "EUR",
        fxRateToEur: 1,
        cashImpactEur: 81,
        withholdingTaxEur: 19,
      })
      .run();
    // A second interest without withholding keeps the previous convention.
    db.insert(schema.accountCashMovements)
      .values({
        id: "int_gross",
        accountId: "acc_1",
        movementType: "interest",
        occurredAt: D("2026-06-01"),
        nativeAmount: 10,
        currency: "EUR",
        fxRateToEur: 1,
        cashImpactEur: 10,
      })
      .run();

    const result = await getInterestForYear(2026, db);
    expect(result.grossEur).toBeCloseTo(110, 6); // 81 + 19 + 10
    expect(result.withholdingEur).toBeCloseTo(19, 6);
  });
});
