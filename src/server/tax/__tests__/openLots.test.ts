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
import { getOpenLots } from "../openLots";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seed(db: DB, assetClassTax = "etf") {
  const accountId = ulid();
  const assetId = ulid();
  db.insert(accounts).values({
    id: accountId, name: "DEGIRO", currency: "EUR",
    accountType: "broker",
    openingBalanceEur: 0, currentCashBalanceEur: 0,
  }).run();
  db.insert(assets).values({
    id: assetId, name: "VWCE",
    assetType: "equity", isin: "IE00BK5BQT80",
    currency: "EUR", isActive: true, assetClassTax,
  }).run();
  return { accountId, assetId };
}

function insertTrade(db: DB, accountId: string, assetId: string, opts: {
  type: "buy" | "sell"; qty: number; unitPriceEur: number; feesEur: number; tradedAt: number;
}): string {
  const id = ulid();
  const gross = opts.qty * opts.unitPriceEur;
  db.insert(assetTransactions).values({
    id, accountId, assetId,
    transactionType: opts.type,
    tradedAt: opts.tradedAt,
    quantity: opts.qty, unitPrice: opts.unitPriceEur,
    tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: gross, tradeGrossAmountEur: gross,
    cashImpactEur: opts.type === "buy" ? -(gross + opts.feesEur) : gross - opts.feesEur,
    feesAmount: opts.feesEur, feesAmountEur: opts.feesEur,
    netAmountEur: opts.type === "buy" ? -(gross + opts.feesEur) : gross - opts.feesEur,
    isListed: true, source: "manual",
  }).run();
  return id;
}

function insertSplit(db: DB, accountId: string, assetId: string, opts: {
  numerator: number; denominator: number; tradedAt: number;
}) {
  db.insert(assetTransactions).values({
    id: ulid(), accountId, assetId,
    transactionType: "split", tradedAt: opts.tradedAt,
    splitNumerator: opts.numerator, splitDenominator: opts.denominator,
    quantity: 0, unitPrice: 0, tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: 0, tradeGrossAmountEur: 0, cashImpactEur: 0,
    feesAmount: 0, feesAmountEur: 0, netAmountEur: 0,
    isListed: false, source: "manual",
  }).run();
}

function recompute(db: DB, assetId: string) {
  db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
}

describe("getOpenLots", () => {
  it("base restante tras venta parcial = coste íntegro − basis consumida", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, feesEur: 2, tradedAt: Date.UTC(2025, 0, 1) });
    insertTrade(db, accountId, assetId, { type: "sell", qty: 4, unitPriceEur: 130, feesEur: 1, tradedAt: Date.UTC(2025, 6, 1) });
    recompute(db, assetId);

    const lots = await getOpenLots(assetId, db);
    expect(lots).toHaveLength(1);
    expect(lots[0].remainingQty).toBeCloseTo(6, 9);
    // buy cost = 1002; consumed = roundEur(1002 × 4/10) = 400.80 → remaining 601.20
    expect(lots[0].remainingCostEur).toBeCloseTo(1002 - 400.8, 6);
    expect(lots[0].deferredLossAddedEur).toBe(0);
  });

  it("lote drenado por completo queda excluido; orden FIFO por adquisición", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    const buy1 = insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, feesEur: 0, tradedAt: Date.UTC(2025, 0, 1) });
    insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 120, feesEur: 0, tradedAt: Date.UTC(2025, 1, 1) });
    insertTrade(db, accountId, assetId, { type: "sell", qty: 12, unitPriceEur: 130, feesEur: 0, tradedAt: Date.UTC(2025, 6, 1) });
    recompute(db, assetId);

    const lots = await getOpenLots(assetId, db);
    expect(lots).toHaveLength(1);
    expect(lots[0].acquiredAt).toBe(Date.UTC(2025, 1, 1));
    expect(lots.map((l) => l.lotId)).not.toContain(buy1);
    expect(lots[0].remainingQty).toBeCloseTo(8, 9);
    expect(lots[0].remainingCostEur).toBeCloseTo(1200 - 240, 6);
  });

  it("contra-split 1:25 (Amper): remainingQty en unidades nuevas, base intacta", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "share");
    insertTrade(db, accountId, assetId, { type: "buy", qty: 2250, unitPriceEur: 0.2, feesEur: 5, tradedAt: Date.UTC(2026, 0, 10) });
    insertSplit(db, accountId, assetId, { numerator: 1, denominator: 25, tradedAt: Date.UTC(2026, 6, 20) });
    recompute(db, assetId);

    const lots = await getOpenLots(assetId, db);
    expect(lots).toHaveLength(1);
    expect(lots[0].remainingQty).toBeCloseTo(90, 9); // 2250 / 25
    expect(lots[0].originalQty).toBe(2250); // histórico, sin ajustar
    expect(lots[0].remainingCostEur).toBeCloseTo(455, 6); // 450 + 5, intacta
  });

  it("venta parcial DESPUÉS de un contra-split no usa ratios de cantidad", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "share");
    insertTrade(db, accountId, assetId, { type: "buy", qty: 2500, unitPriceEur: 0.2, feesEur: 0, tradedAt: Date.UTC(2026, 0, 10) });
    insertSplit(db, accountId, assetId, { numerator: 1, denominator: 25, tradedAt: Date.UTC(2026, 5, 20) });
    // 100 unidades nuevas; vende 40 → quedan 60 nuevas, basis 500 × 60/100 = 300.
    insertTrade(db, accountId, assetId, { type: "sell", qty: 40, unitPriceEur: 6, feesEur: 0, tradedAt: Date.UTC(2026, 6, 1) });
    recompute(db, assetId);

    const lots = await getOpenLots(assetId, db);
    expect(lots).toHaveLength(1);
    expect(lots[0].remainingQty).toBeCloseTo(60, 9);
    // Con el ratio remainingQty/originalQty (60/2500) saldría 488 — mal.
    expect(lots[0].remainingCostEur).toBeCloseTo(300, 6);
  });

  it("pérdida diferida por recompra se integra en la base del lote absorbente", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, feesEur: 0, tradedAt: Date.UTC(2025, 0, 1) });
    // Venta a pérdida (−400) con recompra 10 días después → antiaplicación.
    insertTrade(db, accountId, assetId, { type: "sell", qty: 10, unitPriceEur: 60, feesEur: 0, tradedAt: Date.UTC(2025, 5, 1) });
    insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 62, feesEur: 0, tradedAt: Date.UTC(2025, 5, 11) });
    recompute(db, assetId);

    const lots = await getOpenLots(assetId, db);
    expect(lots).toHaveLength(1);
    // Base = 620 (recompra) + 400 (pérdida diferida integrada).
    expect(lots[0].remainingCostEur).toBeCloseTo(1020, 6);
    expect(lots[0].deferredLossAddedEur).toBeCloseTo(400, 6);
  });

  it("activo sin lotes → lista vacía", async () => {
    const db = makeDb();
    const { assetId } = seed(db);
    expect(await getOpenLots(assetId, db)).toEqual([]);
  });
});
