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
import { buildTaxReport } from "../report";
import { buildPrevision } from "../prevision";
import { actualizationCoefficient } from "../coeficientes";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seed(db: DB) {
  const accountId = ulid();
  const assetId = ulid();
  db.insert(accounts).values({
    id: accountId, name: "DEGIRO", currency: "EUR",
    accountType: "broker",
    openingBalanceEur: 0, currentCashBalanceEur: 0,
  }).run();
  db.insert(assets).values({
    id: assetId, name: "iShares S&P 500 IT (QDVE)",
    assetType: "equity", isin: "IE00B3WJKG14",
    currency: "EUR", isActive: true, assetClassTax: "etf",
  }).run();
  return { accountId, assetId };
}

function trade(db: DB, accountId: string, assetId: string, opts: {
  type: "buy" | "sell"; qty: number; price: number; feesEur: number; tradedAt: number;
}): string {
  const gross = opts.qty * opts.price;
  const id = ulid();
  db.insert(assetTransactions).values({
    id, accountId, assetId,
    transactionType: opts.type,
    tradedAt: opts.tradedAt,
    quantity: opts.qty, unitPrice: opts.price,
    tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: gross, tradeGrossAmountEur: gross,
    cashImpactEur: opts.type === "buy" ? -(gross + opts.feesEur) : gross - opts.feesEur,
    feesAmount: opts.feesEur, feesAmountEur: opts.feesEur,
    netAmountEur: opts.type === "buy" ? -(gross + opts.feesEur) : gross - opts.feesEur,
    isListed: true, source: "manual",
  }).run();
  return id;
}

describe("actualizationCoefficient", () => {
  it("returns the DF 115/2025 IRPF coefficients for 2026 transmissions", () => {
    expect(actualizationCoefficient(2026, 2025)).toBe(1.02);
    expect(actualizationCoefficient(2026, 2024)).toBe(1.05);
    expect(actualizationCoefficient(2026, 2026)).toBe(1.0);
    expect(actualizationCoefficient(2026, 1990)).toBe(2.03);
  });
  it("returns the DF 125/2024 IRPF coefficients for 2025 transmissions", () => {
    expect(actualizationCoefficient(2025, 2024)).toBe(1.018);
    expect(actualizationCoefficient(2025, 2025)).toBe(1.0);
  });
  it("returns null for years without a published table", () => {
    expect(actualizationCoefficient(2024, 2020)).toBeNull();
    expect(actualizationCoefficient(2027, 2026)).toBeNull();
  });
});

describe("declaración + previsión (QDVE real-world scenario)", () => {
  function seedQdve(db: DB) {
    const { accountId, assetId } = seed(db);
    // Two 2025 buys, full 2026 sell — Commander's actual QDVE history.
    trade(db, accountId, assetId, { type: "buy", qty: 158, price: 31.43, feesEur: 1, tradedAt: Date.UTC(2025, 6, 8, 12) });
    trade(db, accountId, assetId, { type: "buy", qty: 34, price: 33.35, feesEur: 1, tradedAt: Date.UTC(2025, 7, 1, 12) });
    trade(db, accountId, assetId, { type: "sell", qty: 192, price: 41.965, feesEur: 3, tradedAt: Date.UTC(2026, 5, 11, 12) });
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    return buildTaxReport(db, 2026);
  }

  it("declaration rows partition the sale exactly across FIFO lots", () => {
    const report = seedQdve(makeDb());
    const rows = report.declaration!;
    expect(rows).toHaveLength(2);

    // Per-lot acquisition values: exactly what was paid (gross + fee).
    expect(rows[0].valorAdquisicionEur).toBeCloseTo(4966.94, 2);
    expect(rows[1].valorAdquisicionEur).toBeCloseTo(1134.9, 2);

    // Proceeds and fees partition exactly: 8057.28 and 3.00.
    const proceeds = rows.reduce((s, r) => s + r.valorTransmisionEur, 0);
    const fees = rows.reduce((s, r) => s + r.gastosTransmisionEur, 0);
    expect(proceeds).toBeCloseTo(8057.28, 9);
    expect(fees).toBeCloseTo(3, 9);

    // Σ resultado == rawGainLoss of the sale, to the cent.
    const resultado = rows.reduce((s, r) => s + r.resultadoEur, 0);
    expect(resultado).toBeCloseTo(report.sales[0].rawGainLossEur, 9);
    expect(resultado).toBeCloseTo(1952.44, 2);

    expect(rows[0].recompra).toBe(false);
  });

  it("previsión applies the 2026 coefficients to the 2025 lots", () => {
    const report = seedQdve(makeDb());
    const prevision = buildPrevision(report);
    expect(prevision.coefficientsAvailable).toBe(true);

    // 2025 acquisitions → coef 1.020.
    expect(prevision.rows[0].coeficiente).toBe(1.02);
    expect(prevision.rows[0].valorAdquisicionActualizadoEur).toBeCloseTo(5066.28, 2); // 4966.94 × 1.02
    expect(prevision.rows[1].valorAdquisicionActualizadoEur).toBeCloseTo(1157.6, 2);  // 1134.90 × 1.02

    // Foral saldo: 8057.28 − 3 − 5066.28 − 1157.60 = 1830.40.
    expect(prevision.saldoGananciasForalEur).toBeCloseTo(1830.4, 2);
    // Relief vs. historic saldo (1952.44).
    expect(prevision.coefficientReliefEur).toBeCloseTo(122.04, 2);

    // Cuota 2026: 1830.40 × 19% = 347.78 (first bracket).
    expect(prevision.cuota.baseAhorroEur).toBeCloseTo(1830.4, 2);
    expect(prevision.cuota.cuotaIntegraEur).toBeCloseTo(347.78, 2);
  });
});
