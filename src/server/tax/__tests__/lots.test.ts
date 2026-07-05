import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import {
  accounts,
  assets,
  assetTransactions,
  taxLots,
  taxLotConsumptions,
} from "../../../db/schema";
import { recomputeLotsForAsset } from "../lots";

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
    id: assetId, name: "VWCE",
    assetType: "equity", isin: "IE00BK5BQT80",
    currency: "EUR", isActive: true, assetClassTax: "etf",
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

describe("recomputeLotsForAsset", () => {
  it("creates a lot per buy and consumes lots FIFO on sell", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    const buy1 = insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, feesEur: 2, tradedAt: Date.UTC(2025, 0, 1) });
    const buy2 = insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 120, feesEur: 2, tradedAt: Date.UTC(2025, 1, 1) });
    const sell = insertTrade(db, accountId, assetId, { type: "sell", qty: 15, unitPriceEur: 130, feesEur: 3, tradedAt: Date.UTC(2025, 6, 1) });

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const lots = db.select().from(taxLots).where(eq(taxLots.assetId, assetId)).all();
    expect(lots).toHaveLength(2);
    const firstLot = lots.find((l) => l.originTransactionId === buy1)!;
    const secondLot = lots.find((l) => l.originTransactionId === buy2)!;
    expect(firstLot.remainingQty).toBe(0);
    expect(secondLot.remainingQty).toBe(5);

    const consumptions = db.select().from(taxLotConsumptions).where(eq(taxLotConsumptions.saleTransactionId, sell)).all();
    expect(consumptions).toHaveLength(2);
    const c1 = consumptions.find((c) => c.lotId === firstLot.id)!;
    const c2 = consumptions.find((c) => c.lotId === secondLot.id)!;
    expect(c1.qtyConsumed).toBe(10);
    expect(c2.qtyConsumed).toBe(5);
    // unit cost of buy1 = 1002 / 10 = 100.2 → consumed = 1002
    expect(c1.costBasisEur).toBeCloseTo(1002, 4);
    // unit cost of buy2 = 1202 / 10 = 120.2 → 5 * 120.2 = 601
    expect(c2.costBasisEur).toBeCloseTo(601, 4);
  });

  it("is idempotent", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    insertTrade(db, accountId, assetId, { type: "buy", qty: 5, unitPriceEur: 10, feesEur: 0, tradedAt: Date.UTC(2025, 0, 1) });

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    const first = db.select().from(taxLots).all();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    const second = db.select().from(taxLots).all();

    expect(second).toHaveLength(first.length);
    const projection = (rows: typeof first) => rows.map((r) => ({
      remainingQty: r.remainingQty,
      grossCostEur: r.grossCostEur,
      feesEur: r.feesEur,
      originalQty: r.originalQty,
      originTransactionId: r.originTransactionId,
    }));
    expect(projection(second)).toEqual(projection(first));
  });

  it("throws when a sell exceeds available lots", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    insertTrade(db, accountId, assetId, { type: "buy",  qty: 5,  unitPriceEur: 100, feesEur: 0, tradedAt: Date.UTC(2025, 0, 1) });
    insertTrade(db, accountId, assetId, { type: "sell", qty: 10, unitPriceEur: 120, feesEur: 0, tradedAt: Date.UTC(2025, 1, 1) });
    expect(() => {
      db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    }).toThrow(/oversells/);
  });

  // Regression (QDVE): rounding the per-unit cost to cents and multiplying
  // back by quantity inflated the basis (158 × roundEur(4966.94/158) = 4967.52
  // instead of 4966.94). Cost must be stored as separate gross/fee totals and
  // consumed exactly.
  it("sell-all cost basis equals exactly what was paid (gross + fees)", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    insertTrade(db, accountId, assetId, { type: "buy", qty: 158, unitPriceEur: 31.43, feesEur: 1, tradedAt: Date.UTC(2025, 6, 8) });
    insertTrade(db, accountId, assetId, { type: "buy", qty: 34, unitPriceEur: 33.35, feesEur: 1, tradedAt: Date.UTC(2025, 7, 1) });
    const sell = insertTrade(db, accountId, assetId, { type: "sell", qty: 192, unitPriceEur: 41.965, feesEur: 3, tradedAt: Date.UTC(2026, 5, 11) });

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const consumptions = db.select().from(taxLotConsumptions).where(eq(taxLotConsumptions.saleTransactionId, sell)).all();
    const costBasis = consumptions.reduce((s, c) => s + c.costBasisEur, 0);
    // 158 × 31.43 + 1 + 34 × 33.35 + 1 = 6101.84 — to the cent, no rounding drift.
    expect(costBasis).toBeCloseTo(6101.84, 2);

    const lots = db.select().from(taxLots).where(eq(taxLots.assetId, assetId)).all();
    const big = lots.find((l) => l.originalQty === 158)!;
    const small = lots.find((l) => l.originalQty === 34)!;
    expect(big.grossCostEur).toBeCloseTo(4965.94, 6);
    expect(big.feesEur).toBe(1);
    expect(small.grossCostEur).toBeCloseTo(1133.9, 6);
    expect(small.feesEur).toBe(1);
  });

  it("ignores dividend transactions", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "dividend",
      tradedAt: Date.UTC(2025, 5, 1),
      quantity: 0, unitPrice: 0,
      tradeCurrency: "USD", fxRateToEur: 0.92,
      tradeGrossAmount: 6.63, tradeGrossAmountEur: 6.1,
      cashImpactEur: 5.2, feesAmount: 0, feesAmountEur: 0,
      netAmountEur: 5.2,
      isListed: true, source: "manual",
    }).run();

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    expect(db.select().from(taxLots).all()).toHaveLength(0);
  });
});

/**
 * Property test (audit R-5): under any random buy/sell sequence,
 *  1. every sale's consumptions sum exactly to the sale quantity, and
 *  2. cost is conserved — Σ(buy gross+fees) == Σ(consumed cost) + Σ(remaining
 *     lot cost) — within the per-consumption cent-rounding tolerance.
 * Prices only rise so no sale is at a loss: wash-sale deferrals would shift
 * cost between lots by design and void invariant 2 (they are covered by
 * washSale.test.ts).
 */
describe("recomputeLotsForAsset invariants (property)", () => {
  // Deterministic LCG — vitest must not be flaky.
  function makeRng(seedValue: number) {
    let s = seedValue >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
  }

  for (const seedValue of [1, 7, 42, 1337, 99991]) {
    it(`holds for random sequence (seed ${seedValue})`, () => {
      const rng = makeRng(seedValue);
      const db = makeDb();
      const { accountId, assetId } = seed(db);

      let held = 0;
      let totalBuyCost = 0;
      let day = 0;
      const ops = 30 + Math.floor(rng() * 30);
      for (let i = 0; i < ops; i++) {
        day += 1 + Math.floor(rng() * 3);
        const tradedAt = Date.UTC(2024, 0, 1) + day * 86_400_000;
        // Monotonically rising price → every sale realises a gain.
        const unitPriceEur = Math.round((10 + day * 0.5) * 100) / 100;
        const wantSell = held > 0 && rng() < 0.4;
        if (wantSell) {
          const qty = Math.max(1, Math.floor(rng() * held));
          insertTrade(db, accountId, assetId, {
            type: "sell", qty, unitPriceEur, feesEur: 0, tradedAt,
          });
          held -= qty;
        } else {
          const qty = 1 + Math.floor(rng() * 9);
          insertTrade(db, accountId, assetId, {
            type: "buy", qty, unitPriceEur, feesEur: 0, tradedAt,
          });
          held += qty;
          totalBuyCost += qty * unitPriceEur;
        }
      }

      db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

      const lots = db.select().from(taxLots).where(eq(taxLots.assetId, assetId)).all();
      const consumptions = db.select().from(taxLotConsumptions).all();
      const sells = db
        .select()
        .from(assetTransactions)
        .where(eq(assetTransactions.transactionType, "sell"))
        .all();

      // Invariant 1: per-sale consumed quantity == sale quantity, exactly.
      for (const sale of sells) {
        const consumed = consumptions
          .filter((c) => c.saleTransactionId === sale.id)
          .reduce((s, c) => s + c.qtyConsumed, 0);
        expect(consumed).toBeCloseTo(sale.quantity, 9);
      }

      // Invariant 2: cost conservation. Each consumption rounds to the cent,
      // so allow ±1 cent per consumption row.
      const consumedCost = consumptions.reduce((s, c) => s + c.costBasisEur, 0);
      const remainingCost = lots.reduce(
        (s, l) => s + (l.grossCostEur + l.feesEur) * (l.originalQty > 0 ? l.remainingQty / l.originalQty : 0),
        0,
      );
      const tolerance = 0.01 * Math.max(1, consumptions.length);
      expect(Math.abs(consumedCost + remainingCost - totalBuyCost)).toBeLessThanOrEqual(tolerance);

      // Invariant 3: remaining quantity matches the ledger position.
      const remainingQty = lots.reduce((s, l) => s + l.remainingQty, 0);
      expect(remainingQty).toBeCloseTo(held, 9);
    });
  }
});

// Audit T11: corrupt buy rows fail loudly instead of vanishing from cost basis.
describe("recomputeLotsForAsset corrupt-row handling", () => {
  it("throws on a non-positive buy quantity", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(2025, 0, 1),
      quantity: 0, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
      isListed: true, source: "manual",
    }).run();
    expect(() => {
      db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    }).toThrow(/non-positive quantity/);
  });
});

// Retirada de activo (transfer_out): consume lotes FIFO sin generar par
// fiscal — el coste de las unidades retiradas sale del sistema sin resultado.
describe("recomputeLotsForAsset transfer_out", () => {
  function insertTransferOut(db: DB, accountId: string, assetId: string, opts: {
    qty: number; valueEur: number; tradedAt: number;
  }): string {
    const id = ulid();
    db.insert(assetTransactions).values({
      id, accountId, assetId,
      transactionType: "transfer_out",
      tradedAt: opts.tradedAt,
      quantity: opts.qty, unitPrice: opts.valueEur / opts.qty,
      tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: opts.valueEur, tradeGrossAmountEur: opts.valueEur,
      cashImpactEur: opts.valueEur,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: opts.valueEur,
      isListed: false, source: "manual",
    }).run();
    return id;
  }

  it("consume lotes FIFO sin escribir consumos ni pares fiscales", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    const buy1 = insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, feesEur: 0, tradedAt: Date.UTC(2025, 0, 1) });
    const buy2 = insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 120, feesEur: 0, tradedAt: Date.UTC(2025, 1, 1) });
    insertTransferOut(db, accountId, assetId, { qty: 15, valueEur: 1650, tradedAt: Date.UTC(2025, 6, 1) });

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const lots = db.select().from(taxLots).where(eq(taxLots.assetId, assetId)).all();
    const firstLot = lots.find((l) => l.originTransactionId === buy1)!;
    const secondLot = lots.find((l) => l.originTransactionId === buy2)!;
    expect(firstLot.remainingQty).toBe(0);
    expect(secondLot.remainingQty).toBe(5);
    // Sin rastro fiscal: ni consumos (pares FIFO) ni ajustes antiaplicación.
    expect(db.select().from(taxLotConsumptions).all()).toHaveLength(0);
    expect(db.select().from(schema.taxWashSaleAdjustments).all()).toHaveLength(0);
  });

  it("una venta posterior consume solo lo que sobrevive a la retirada", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, feesEur: 0, tradedAt: Date.UTC(2025, 0, 1) });
    const buy2 = insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 200, feesEur: 0, tradedAt: Date.UTC(2025, 1, 1) });
    // La retirada drena el primer lote entero: la venta debe caer en el segundo.
    insertTransferOut(db, accountId, assetId, { qty: 10, valueEur: 1100, tradedAt: Date.UTC(2025, 2, 1) });
    const sell = insertTrade(db, accountId, assetId, { type: "sell", qty: 5, unitPriceEur: 130, feesEur: 0, tradedAt: Date.UTC(2025, 6, 1) });

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const consumptions = db.select().from(taxLotConsumptions).where(eq(taxLotConsumptions.saleTransactionId, sell)).all();
    expect(consumptions).toHaveLength(1);
    expect(consumptions[0].qtyConsumed).toBe(5);
    // Coste del segundo lote (200 €/ud), no del primero ya retirado.
    expect(consumptions[0].costBasisEur).toBeCloseTo(1000, 2);
    const lot2 = db.select().from(taxLots).where(eq(taxLots.originTransactionId, buy2)).get();
    expect(lot2?.remainingQty).toBe(5);
  });

  it("lanza tax-lots: si la retirada supera las unidades poseídas", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, feesEur: 0, tradedAt: Date.UTC(2025, 0, 1) });
    insertTransferOut(db, accountId, assetId, { qty: 11, valueEur: 1100, tradedAt: Date.UTC(2025, 6, 1) });
    expect(() => {
      db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    }).toThrow(/tax-lots:/);
  });
});
