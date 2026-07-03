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
  taxLotConsumptions,
  taxLots,
  taxWashSaleAdjustments,
} from "../../../db/schema";
import { recomputeLotsForAsset } from "../lots";
import {
  addCalendarMonths,
  allocateLargestRemainder,
  washSaleWindowForAssetClass,
} from "../washSale";

const DAY = 86_400_000;

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seed(db: DB, assetClass: "listed_security" | "unlisted_security") {
  const accountId = ulid();
  const assetId = ulid();
  db.insert(accounts).values({
    id: accountId, name: "DEGIRO", currency: "EUR",
    accountType: "broker",
    openingBalanceEur: 0, currentCashBalanceEur: 0,
  }).run();
  db.insert(assets).values({
    id: assetId, name: "Test Equity",
    assetType: "equity", currency: "EUR",
    isActive: true, assetClassTax: assetClass,
  }).run();
  return { accountId, assetId };
}

function trade(db: DB, accountId: string, assetId: string, type: "buy" | "sell", qty: number, price: number, tradedAt: number): string {
  const gross = qty * price;
  const id = ulid();
  db.insert(assetTransactions).values({
    id, accountId, assetId,
    transactionType: type,
    tradedAt, quantity: qty, unitPrice: price,
    tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: gross, tradeGrossAmountEur: gross,
    cashImpactEur: type === "buy" ? -gross : gross,
    feesAmount: 0, feesAmountEur: 0,
    netAmountEur: type === "buy" ? -gross : gross,
    isListed: true, source: "manual",
  }).run();
  return id;
}

function recompute(db: DB, assetId: string) {
  db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
}

describe("wash-sale rule (norma antiaplicación art. 43.g/h NF 13/2013)", () => {
  it("flags a loss as disallowed when repurchase happens within 2 months (listed)", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "listed_security");
    const t0 = Date.UTC(2025, 0, 1);
    trade(db, accountId, assetId, "buy",  10, 100, t0);
    const sell = trade(db, accountId, assetId, "sell", 10, 80, t0 + 30 * DAY);
    trade(db, accountId, assetId, "buy",  10, 85,  t0 + 45 * DAY);

    recompute(db, assetId);

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(1);
    expect(adj[0].disallowedLossEur).toBeCloseTo(200, 2);
    expect(adj[0].windowDays).toBe(60);

    const absorbing = db.select().from(taxLots).where(eq(taxLots.id, adj[0].absorbingLotId)).get();
    expect(absorbing!.deferredLossAddedEur).toBeCloseTo(200, 2);
  });

  it("uses a 1-year window for unlisted securities", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "unlisted_security");
    const t0 = Date.UTC(2025, 0, 1);
    trade(db, accountId, assetId, "buy",  5, 100, t0);
    const sell = trade(db, accountId, assetId, "sell", 5, 80, t0 + 200 * DAY);
    trade(db, accountId, assetId, "buy",  5, 85,  t0 + 210 * DAY);

    recompute(db, assetId);

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(1);
    expect(adj[0].windowDays).toBe(365);
  });

  it("does not flag a sale that ends at a gain", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "listed_security");
    const t0 = Date.UTC(2025, 0, 1);
    trade(db, accountId, assetId, "buy",  10, 100, t0);
    const sell = trade(db, accountId, assetId, "sell", 10, 110, t0 + 30 * DAY);
    trade(db, accountId, assetId, "buy",  10, 105, t0 + 45 * DAY);

    recompute(db, assetId);

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(0);
  });

  it("partial absorption when repurchased qty < sold qty", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "listed_security");
    const t0 = Date.UTC(2025, 0, 1);
    trade(db, accountId, assetId, "buy",  10, 100, t0);
    const sell = trade(db, accountId, assetId, "sell", 10, 80, t0 + 30 * DAY);
    trade(db, accountId, assetId, "buy",  3,  85,  t0 + 45 * DAY);

    recompute(db, assetId);

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(1);
    // disallowed = 200 * (3/10) = 60
    expect(adj[0].disallowedLossEur).toBeCloseTo(60, 2);
  });

  it("a repurchase outside the 2-calendar-month window does NOT defer the loss", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "listed_security");
    // Sell 15-Mar-2025; repurchase 16-May-2025 (2 months + 1 day later).
    trade(db, accountId, assetId, "buy",  10, 100, Date.UTC(2025, 0, 10));
    const sell = trade(db, accountId, assetId, "sell", 10, 80, Date.UTC(2025, 2, 15));
    trade(db, accountId, assetId, "buy",  10, 85,  Date.UTC(2025, 4, 16));

    recompute(db, assetId);

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(0);
  });

  // The core of the norm: the deferred loss integrates into the basis of the
  // absorbing lot, so its DEFINITIVE sale recovers the loss in that year.
  it("recovers the deferred loss when the absorbing lot is fully sold later", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "listed_security");
    trade(db, accountId, assetId, "buy",  10, 100, Date.UTC(2025, 0, 1));   // 1000
    const lossSell = trade(db, accountId, assetId, "sell", 10, 80, Date.UTC(2025, 1, 1)); // 800 → loss 200
    trade(db, accountId, assetId, "buy",  10, 85,  Date.UTC(2025, 2, 1));   // 850, absorbs 200
    const finalSell = trade(db, accountId, assetId, "sell", 10, 90, Date.UTC(2025, 10, 1)); // 900

    recompute(db, assetId);

    // Loss sale: 200 disallowed.
    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, lossSell)).all();
    expect(adj).toHaveLength(1);
    expect(adj[0].disallowedLossEur).toBeCloseTo(200, 2);

    // Final sale consumes basis 850 + 200 deferred = 1050 → declared loss −150,
    // which equals the TOTAL economic loss (1000 + 850 paid, 800 + 900 received).
    const cons = db.select().from(taxLotConsumptions).where(eq(taxLotConsumptions.saleTransactionId, finalSell)).all();
    const basis = cons.reduce((s, c) => s + c.costBasisEur, 0);
    expect(basis).toBeCloseTo(1050, 2);

    // No further repurchase → the final sale's loss has no adjustment.
    const adj2 = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, finalSell)).all();
    expect(adj2).toHaveLength(0);
  });

  it("recovers proportionally when the absorbing lot is partially sold", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "listed_security");
    trade(db, accountId, assetId, "buy",  10, 100, Date.UTC(2025, 0, 1));
    trade(db, accountId, assetId, "sell", 10, 80, Date.UTC(2025, 1, 1));   // loss 200 deferred
    trade(db, accountId, assetId, "buy",  10, 85,  Date.UTC(2025, 2, 1));  // absorbs 200
    const halfSell = trade(db, accountId, assetId, "sell", 5, 120, Date.UTC(2025, 10, 1)); // gain → no new deferral

    recompute(db, assetId);

    // Half the absorbing lot is sold: basis = (850 + 200)/2 = 525.
    const cons = db.select().from(taxLotConsumptions).where(eq(taxLotConsumptions.saleTransactionId, halfSell)).all();
    const basis = cons.reduce((s, c) => s + c.costBasisEur, 0);
    expect(basis).toBeCloseTo(525, 2);

    // The other half of the deferral stays in the lot.
    const lots = db.select().from(taxLots).where(eq(taxLots.assetId, assetId)).all();
    const absorbing = lots.find((l) => l.remainingQty > 0)!;
    expect(absorbing.deferredLossAddedEur).toBeCloseTo(100, 2);
  });

  it("a loss sale BEFORE an earlier surviving buy within the window defers onto it", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "listed_security");
    trade(db, accountId, assetId, "buy",  10, 100, Date.UTC(2025, 0, 1));
    trade(db, accountId, assetId, "buy",  10, 90,  Date.UTC(2025, 2, 10)); // within 2 months BEFORE the sale
    const sell = trade(db, accountId, assetId, "sell", 10, 80, Date.UTC(2025, 3, 1)); // FIFO drains the first lot → loss 200

    recompute(db, assetId);

    // The surviving second lot absorbs the full loss (acquired within window).
    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(1);
    expect(adj[0].disallowedLossEur).toBeCloseTo(200, 2);
    const absorbing = db.select().from(taxLots).where(eq(taxLots.id, adj[0].absorbingLotId)).get();
    expect(absorbing!.deferredLossAddedEur).toBeCloseTo(200, 2);
  });
});

describe("cent conservation in lot consumption", () => {
  // Audit F1: subtracting the EXACT share (instead of the rounded cost) from
  // the remainder silently dropped ~0.5¢ per partial consumption — 49 cents
  // on this adversarial case before the fix.
  it("100 partial sells of a 1000.49 € lot consume exactly 1000.49", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "listed_security");
    const t0 = Date.UTC(2025, 0, 1);
    // 100 units, gross 1000.49 total → unit price 10.0049.
    trade(db, accountId, assetId, "buy", 100, 10.0049, t0);
    for (let i = 0; i < 100; i++) {
      trade(db, accountId, assetId, "sell", 1, 20, t0 + (i + 1) * DAY);
    }

    recompute(db, assetId);

    const cons = db.select().from(taxLotConsumptions).all();
    expect(cons).toHaveLength(100);
    const total = cons.reduce((s, c) => s + c.costBasisEur, 0);
    expect(total).toBeCloseTo(1000.49, 6);
  });
});

describe("washSale helpers", () => {
  it("allocateLargestRemainder conserves the total exactly", () => {
    expect(allocateLargestRemainder(100.01, [1, 1, 1])).toEqual([33.34, 33.34, 33.33]);
    const parts = allocateLargestRemainder(199.99, [3, 2, 5]);
    expect(parts.reduce((s, p) => s + p, 0)).toBeCloseTo(199.99, 9);
    expect(allocateLargestRemainder(0, [1, 2])).toEqual([0, 0]);
  });

  it("washSaleWindowForAssetClass: 12 meses para no cotizados Y fondos, 2 para el resto", () => {
    // Auditoría 2026-07: las participaciones de IIC no cotizadas (fondos
    // tradicionales) NO están admitidas a negociación → art. 43.h: UN AÑO.
    expect(washSaleWindowForAssetClass("unlisted_security").months).toBe(12);
    expect(washSaleWindowForAssetClass("fund").months).toBe(12);
    expect(washSaleWindowForAssetClass("listed_security").months).toBe(2);
    expect(washSaleWindowForAssetClass("etf").months).toBe(2);
    expect(washSaleWindowForAssetClass("crypto").months).toBe(2);
    expect(washSaleWindowForAssetClass(null).months).toBe(2);
  });

  it("addCalendarMonths clamps month-end overflow", () => {
    // 31-Mar + 1 month → 30-Apr (not 1-May).
    expect(new Date(addCalendarMonths(Date.UTC(2025, 2, 31), 1)).toISOString().slice(0, 10)).toBe("2025-04-30");
    // 31-Jan − 2 months → 30-Nov of previous year.
    expect(new Date(addCalendarMonths(Date.UTC(2025, 0, 31), -2)).toISOString().slice(0, 10)).toBe("2024-11-30");
    // Plain case: 15-Mar + 2 months → 15-May.
    expect(new Date(addCalendarMonths(Date.UTC(2025, 2, 15), 2)).toISOString().slice(0, 10)).toBe("2025-05-15");
  });
});
