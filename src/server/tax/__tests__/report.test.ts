import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import { accounts, assets, assetTransactions } from "../../../db/schema";
import { recomputeLotsForAsset } from "../lots";
import { buildTaxReport, DUST_THRESHOLD_EUR } from "../report";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("buildTaxReport", () => {
  it("aggregates realised gains, losses, non-computable, and dividends for a year", () => {
    const db = makeDb();
    const accountId = ulid();
    const assetId = ulid();

    db.insert(accounts).values({
      id: accountId, name: "DEGIRO", currency: "EUR",
      accountType: "broker", countryCode: "NL",
      openingBalanceEur: 0, currentCashBalanceEur: 0,
    }).run();
    db.insert(assets).values({
      id: assetId, name: "UNITEDHEALTH GROUP INC", assetType: "equity",
      isin: "US91324P1021", currency: "USD", isActive: true,
      assetClassTax: "listed_security",
    }).run();

    const t = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
    const insert = (values: typeof assetTransactions.$inferInsert) => db.insert(assetTransactions).values(values).run();

    insert({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: t(2025, 1, 10),
      quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
      isListed: true, source: "manual",
    });
    insert({
      id: ulid(), accountId, assetId,
      transactionType: "sell", tradedAt: t(2025, 6, 1),
      quantity: 10, unitPrice: 150, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1500, tradeGrossAmountEur: 1500, cashImpactEur: 1500,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 1500,
      isListed: true, source: "manual",
    });
    insert({
      id: ulid(), accountId, assetId,
      transactionType: "dividend", tradedAt: t(2025, 3, 17),
      quantity: 0, unitPrice: 0,
      tradeCurrency: "USD", fxRateToEur: 0.92,
      tradeGrossAmount: 6.63, tradeGrossAmountEur: 6.10,
      cashImpactEur: 5.19, feesAmount: 0, feesAmountEur: 0, netAmountEur: 5.19,
      dividendGross: 6.63, dividendNet: 5.64,
      withholdingTax: 0.91, sourceCountry: "US",
      isListed: true, source: "manual",
    });

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    const report = buildTaxReport(db, 2025);

    expect(report.totals.realizedGainsEur).toBeCloseTo(500, 2);
    expect(report.totals.realizedLossesComputableEur).toBe(0);
    expect(report.totals.nonComputableLossesEur).toBe(0);
    expect(report.sales).toHaveLength(1);
    expect(report.sales[0].consumedLots).toHaveLength(1);

    expect(report.dividends).toHaveLength(1);
    expect(report.dividends[0].sourceCountry).toBe("US");
    expect(report.dividends[0].grossEur).toBeCloseTo(6.10, 2);
    expect(report.dividends[0].withholdingOrigenEur).toBeCloseTo(0.91, 2);
    expect(report.totals.dividendsGrossEur).toBeCloseTo(6.10, 2);

    expect(report.yearEndBalances).toBeDefined();
    expect(Array.isArray(report.yearEndBalances)).toBe(true);
    const unh = report.yearEndBalances.find((b) => b.isin === "US91324P1021");
    expect(unh).toBeUndefined();
  });
});

describe("buildTaxReport dust filter", () => {
  it("excludes disposals where proceeds and cost basis are both below €1", () => {
    const db = makeDb();
    const accountId = ulid();
    const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "BINANCE", currency: "EUR", accountType: "crypto_exchange", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "BNB", assetType: "crypto", currency: "BNB", isActive: true, assetClassTax: "crypto" }).run();

    // A dust sell (€0.005 cost basis, €0 proceeds)
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(2025, 0, 1),
      quantity: 0.00001, unitPrice: 500,
      tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 0.005, tradeGrossAmountEur: 0.005, cashImpactEur: -0.005,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -0.005,
      isListed: false, source: "manual",
    }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "sell", tradedAt: Date.UTC(2025, 5, 1),
      quantity: 0.00001, unitPrice: 0,
      tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 0, tradeGrossAmountEur: 0, cashImpactEur: 0,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 0,
      isListed: false, source: "manual",
    }).run();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const report = buildTaxReport(db, 2025);
    expect(report.sales).toHaveLength(0);
    expect(report.totals.realizedLossesComputableEur).toBe(0);
    expect(report.totals.proceedsEur).toBe(0);
  });

  it("keeps disposals where proceeds OR cost basis exceed the dust threshold", () => {
    expect(DUST_THRESHOLD_EUR).toBe(1);
  });
});

// Audit T10/T5: year-end custody comes from per-account transaction sums
// (not residual FIFO lots), and stale valuations are flagged.
describe("buildTaxReport year-end balances", () => {
  it("attributes year-end quantities to the holding account even when global FIFO drained another account's lots", () => {
    const db = makeDb();
    const assetId = ulid();
    const accountA = ulid(); // buys first (older lots)
    const accountB = ulid(); // buys later, then sells

    for (const [id, name, country] of [[accountA, "Broker A", "NL"], [accountB, "Broker B", "DE"]] as const) {
      db.insert(accounts).values({
        id, name, currency: "EUR", accountType: "broker", countryCode: country,
        openingBalanceEur: 0, currentCashBalanceEur: 0,
      }).run();
    }
    db.insert(assets).values({
      id: assetId, name: "VWCE", assetType: "equity",
      currency: "EUR", isActive: true, assetClassTax: "etf",
    }).run();

    const mk = (accountId: string, type: "buy" | "sell", qty: number, month: number) => {
      const gross = qty * 100;
      db.insert(assetTransactions).values({
        id: ulid(), accountId, assetId,
        transactionType: type, tradedAt: Date.UTC(2025, month, 1),
        quantity: qty, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
        tradeGrossAmount: gross, tradeGrossAmountEur: gross,
        cashImpactEur: type === "buy" ? -gross : gross,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: type === "buy" ? -gross : gross,
        isListed: true, source: "manual",
      }).run();
    };
    mk(accountA, "buy", 10, 0);  // Jan: A buys 10 (oldest lots)
    mk(accountB, "buy", 10, 1);  // Feb: B buys 10
    mk(accountB, "sell", 10, 5); // Jun: B sells 10 — FIFO consumes A's lots

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    const report = buildTaxReport(db, 2025);

    // Custody truth: A still holds 10, B holds 0 — regardless of which lots
    // FIFO consumed.
    const balances = report.yearEndBalances;
    expect(balances).toHaveLength(1);
    expect(balances[0].accountId).toBe(accountA);
    expect(balances[0].quantity).toBeCloseTo(10, 9);
  });

  it("flags valuations older than the staleness window and exposes the valuation date", () => {
    const db = makeDb();
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({
      id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker",
      countryCode: "NL", openingBalanceEur: 0, currentCashBalanceEur: 0,
    }).run();
    db.insert(assets).values({
      id: assetId, name: "VWCE", assetType: "equity",
      currency: "EUR", isActive: true, assetClassTax: "etf",
    }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(2025, 0, 10),
      quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
      isListed: true, source: "manual",
    }).run();
    // Valuation from October — more than 10 days before Dec 31.
    db.insert(schema.assetValuations).values({
      id: ulid(), assetId, valuationDate: "2025-10-01",
      quantity: 10, unitPriceEur: 120, marketValueEur: 1200,
      priceSource: "test", createdAt: Date.now(),
    }).run();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const report = buildTaxReport(db, 2025);
    expect(report.yearEndBalances).toHaveLength(1);
    const b = report.yearEndBalances[0];
    expect(b.valueEur).toBeCloseTo(1200, 2);
    expect(b.unvalued).toBe(false);
    expect(b.staleValuation).toBe(true);
    expect(b.valuationDate).toBe("2025-10-01");

    // A fresh valuation clears the flag.
    db.insert(schema.assetValuations).values({
      id: ulid(), assetId, valuationDate: "2025-12-30",
      quantity: 10, unitPriceEur: 130, marketValueEur: 1300,
      priceSource: "test", createdAt: Date.now(),
    }).run();
    const fresh = buildTaxReport(db, 2025);
    expect(fresh.yearEndBalances[0].staleValuation).toBe(false);
    expect(fresh.yearEndBalances[0].valueEur).toBeCloseTo(1300, 2);
  });

  it("never flags stale for the in-progress year — its Dec-31 hasn't happened", () => {
    const db = makeDb();
    const year = new Date().getUTCFullYear();
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({
      id: accountId, name: "IBKR", currency: "EUR", accountType: "broker",
      countryCode: "IE", openingBalanceEur: 0, currentCashBalanceEur: 0,
    }).run();
    db.insert(assets).values({
      id: assetId, name: "VWCE", assetType: "equity",
      currency: "EUR", isActive: true, assetClassTax: "etf",
    }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(year, 0, 1),
      quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
      isListed: true, source: "manual",
    }).run();
    // A January valuation is way more than 10 days before Dec 31, but the
    // year is still open — the flag must stay off.
    db.insert(schema.assetValuations).values({
      id: ulid(), assetId, valuationDate: `${year}-01-01`,
      quantity: 10, unitPriceEur: 120, marketValueEur: 1200,
      priceSource: "test", createdAt: Date.now(),
    }).run();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const report = buildTaxReport(db, year);
    expect(report.yearEndBalances).toHaveLength(1);
    expect(report.yearEndBalances[0].staleValuation).toBe(false);
  });
});

// Audit T7/R-9: dust-filtered disposals are disclosed, never silently dropped.
describe("buildTaxReport dust disclosure", () => {
  it("reports excluded count and amounts", () => {
    const db = makeDb();
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "BINANCE", currency: "EUR", accountType: "crypto_exchange", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "BNB", assetType: "crypto", currency: "BNB", isActive: true, assetClassTax: "crypto" }).run();

    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(2025, 0, 1),
      quantity: 0.001, unitPrice: 500, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 0.5, tradeGrossAmountEur: 0.5, cashImpactEur: -0.5,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -0.5,
      isListed: false, source: "manual",
    }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "sell", tradedAt: Date.UTC(2025, 5, 1),
      quantity: 0.001, unitPrice: 600, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 0.6, tradeGrossAmountEur: 0.6, cashImpactEur: 0.6,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 0.6,
      isListed: false, source: "manual",
    }).run();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const report = buildTaxReport(db, 2025);
    expect(report.sales).toHaveLength(0);
    expect(report.excludedSales?.count).toBe(1);
    expect(report.excludedSales?.proceedsEur).toBeCloseTo(0.6, 2);
    expect(report.excludedSales?.costBasisEur).toBeCloseTo(0.5, 2);
  });
});

// Audit T9/R-8: totals are rounded at the aggregation boundary — no float
// artifacts may survive into exports.
describe("buildTaxReport totals precision", () => {
  it("sums of many 0.1-style amounts come out cent-exact", () => {
    const db = makeDb();
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "B", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "X", assetType: "equity", currency: "EUR", isActive: true, assetClassTax: "listed_security" }).run();

    // 100 buys of 0.1 € gain each: classic 0.1+0.2 float-drift territory.
    for (let i = 0; i < 100; i++) {
      db.insert(assetTransactions).values({
        id: ulid(), accountId, assetId,
        transactionType: "buy", tradedAt: Date.UTC(2025, 0, 2) + i * 2 * 86_400_000,
        quantity: 1, unitPrice: 10.1, tradeCurrency: "EUR", fxRateToEur: 1,
        tradeGrossAmount: 10.1, tradeGrossAmountEur: 10.1, cashImpactEur: -10.1,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: -10.1,
        isListed: true, source: "manual",
      }).run();
      db.insert(assetTransactions).values({
        id: ulid(), accountId, assetId,
        transactionType: "sell", tradedAt: Date.UTC(2025, 0, 3) + i * 2 * 86_400_000,
        quantity: 1, unitPrice: 10.2, tradeCurrency: "EUR", fxRateToEur: 1,
        tradeGrossAmount: 10.2, tradeGrossAmountEur: 10.2, cashImpactEur: 10.2,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: 10.2,
        isListed: true, source: "manual",
      }).run();
    }
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const report = buildTaxReport(db, 2025);
    for (const [k, v] of Object.entries(report.totals)) {
      expect(Math.round(v * 100) / 100, `totals.${k}`).toBe(v);
    }
    expect(report.totals.realizedGainsEur).toBe(10);
  });
});
