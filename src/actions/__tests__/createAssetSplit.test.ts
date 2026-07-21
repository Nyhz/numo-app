import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import {
  accounts,
  assetPositions,
  assets,
  assetTransactions,
  taxLotConsumptions,
  taxLots,
} from "../../db/schema";
import { createAssetSplit } from "../createAssetSplit";
import { createTransaction } from "../createTransaction";
import { rebuildAfterTradeMutation } from "../../server/rebuild";
import { rebuildValuationsForAsset } from "../../server/valuations";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

const BUY_AT = Date.UTC(2025, 5, 2, 12); // 2025-06-02, 12:00 (alta manual)

function seed(db: DB) {
  const accountId = ulid();
  const amper = ulid();
  db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
  db.insert(assets).values({ id: amper, name: "AMPER SA", symbol: "AMP-T", assetType: "stock", currency: "EUR", isActive: true, assetClassTax: "listed_security" }).run();
  // 2500 uds a 0.10 € + 2.50 € de comisión → coste total 252.50 €.
  db.insert(assetTransactions).values({
    id: ulid(), accountId, assetId: amper,
    transactionType: "buy", tradedAt: BUY_AT,
    quantity: 2500, unitPrice: 0.1,
    tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: 250, tradeGrossAmountEur: 250, cashImpactEur: -252.5,
    feesAmount: 2.5, feesAmountEur: 2.5, netAmountEur: -252.5,
    isListed: true, source: "manual",
  }).run();
  // Estado derivado base (posición + lotes) antes del canje.
  db.transaction((tx) => { rebuildAfterTradeMutation(tx, accountId, amper); });
  return { accountId, amper };
}

const payload = (accountId: string, assetId: string) => ({
  accountId, assetId,
  effectiveDate: "2025-07-01",
  newShares: 1,
  oldShares: 25,
});

describe("createAssetSplit", () => {
  it("contra-split 1:25 — re-escala cantidad conservando coste y antigüedad FIFO", async () => {
    const db = makeDb();
    const { accountId, amper } = seed(db);

    const result = await createAssetSplit(payload(accountId, amper), db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = db.select().from(assetTransactions).where(eq(assetTransactions.id, result.data.id)).get();
    expect(row?.transactionType).toBe("split");
    expect(row?.splitNumerator).toBe(1);
    expect(row?.splitDenominator).toBe(25);
    // Fiscal y flujo-neutro: sin importe, sin caja, sin par fiscal.
    expect(row?.cashImpactEur).toBe(0);
    expect(row?.tradeGrossAmountEur).toBe(0);
    // 00:00 UTC: precede a cualquier operación intradía (altas a las 12:00).
    expect(new Date(row!.tradedAt).toISOString()).toBe("2025-07-01T00:00:00.000Z");

    // Posición: 2500 / 25 = 100 exactas; el coste total NO cambia y el medio ×25.
    const position = db.select().from(assetPositions).where(eq(assetPositions.assetId, amper)).get();
    expect(position?.quantity).toBe(100);
    expect(position?.totalCostEur).toBeCloseTo(252.5, 2);
    expect(position?.averageCost).toBeCloseTo(2.525, 4);

    // Lote FIFO: cantidad viva escalada; fecha de adquisición, coste bruto y
    // comisiones intactos. originalQty queda en unidades de su fecha.
    const lot = db.select().from(taxLots).where(eq(taxLots.assetId, amper)).get();
    expect(lot?.remainingQty).toBe(100);
    expect(lot?.originalQty).toBe(2500);
    expect(lot?.acquiredAt).toBe(BUY_AT);
    expect(lot?.grossCostEur).toBe(250);
    expect(lot?.feesEur).toBe(2.5);
    // Sin consumo fiscal: un canje no es transmisión.
    expect(db.select().from(taxLotConsumptions).all()).toHaveLength(0);

    const audit = db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId, result.data.id)).get();
    expect(audit?.action).toBe("create-asset-split");
    expect(audit?.summary).toContain("contra-split 1:25");
  });

  it("split 4:1 multiplica las unidades sin tocar el coste", async () => {
    const db = makeDb();
    const { accountId, amper } = seed(db);

    const result = await createAssetSplit({ ...payload(accountId, amper), newShares: 4, oldShares: 1 }, db);
    expect(result.ok).toBe(true);

    const position = db.select().from(assetPositions).where(eq(assetPositions.assetId, amper)).get();
    expect(position?.quantity).toBe(10000);
    expect(position?.totalCostEur).toBeCloseTo(252.5, 2);
  });

  it("una venta posterior al canje consume unidades post-split con la base íntegra", async () => {
    const db = makeDb();
    const { accountId, amper } = seed(db);
    await createAssetSplit(payload(accountId, amper), db);

    // Vender las 100 post-canje drena el lote entero: base = 252.50 €.
    const sell = await createTransaction({
      accountId, assetId: amper,
      side: "sell", tradeDate: "2025-07-10",
      quantity: 100, priceNative: 3, currency: "EUR", fees: 0,
    }, db);
    expect(sell.ok).toBe(true);

    const consumptions = db.select().from(taxLotConsumptions).all();
    expect(consumptions).toHaveLength(1);
    expect(consumptions[0].qtyConsumed).toBe(100);
    expect(consumptions[0].costBasisEur).toBeCloseTo(252.5, 2);
    expect(db.select().from(assetPositions).where(eq(assetPositions.assetId, amper)).all()).toHaveLength(0);
  });

  it("el pre-check de oversell ve la cantidad post-canje", async () => {
    const db = makeDb();
    const { accountId, amper } = seed(db);
    await createAssetSplit(payload(accountId, amper), db);

    const sell = await createTransaction({
      accountId, assetId: amper,
      side: "sell", tradeDate: "2025-07-10",
      quantity: 101, priceNative: 3, currency: "EUR", fees: 0,
    }, db);
    expect(sell.ok).toBe(false);
  });

  it("rechaza un canje sin unidades en cartera a la fecha efectiva", async () => {
    const db = makeDb();
    const { accountId, amper } = seed(db);

    const result = await createAssetSplit({ ...payload(accountId, amper), effectiveDate: "2025-05-01" }, db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
    expect(result.error.fieldErrors?.effectiveDate?.[0]).toMatch(/fecha efectiva/);
  });

  it("rechaza el canje 1:1 y factores no enteros", async () => {
    const db = makeDb();
    const { accountId, amper } = seed(db);

    const same = await createAssetSplit({ ...payload(accountId, amper), newShares: 5, oldShares: 5 }, db);
    expect(same.ok).toBe(false);
    const fractional = await createAssetSplit({ ...payload(accountId, amper), newShares: 1.5 }, db);
    expect(fractional.ok).toBe(false);
  });

  it("detecta el mismo canje duplicado y lo admite con allowDuplicate", async () => {
    const db = makeDb();
    const { accountId, amper } = seed(db);

    const first = await createAssetSplit(payload(accountId, amper), db);
    expect(first.ok).toBe(true);
    const second = await createAssetSplit(payload(accountId, amper), db);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("duplicate");

    const third = await createAssetSplit({ ...payload(accountId, amper), allowDuplicate: true }, db);
    expect(third.ok).toBe(true);
  });

  it("las valoraciones diarias usan la cantidad pre-canje antes y post-canje después", async () => {
    const db = makeDb();
    const { accountId, amper } = seed(db);

    const now = Date.now();
    // Precio pre-canje (0.20) y primer precio post-canje (5.00, ×25).
    for (const [iso, price] of [["2025-06-03", 0.2], ["2025-07-01", 5.0]] as const) {
      db.insert(schema.priceHistory).values({
        id: ulid(), symbol: "AMP-T", price,
        pricedAt: new Date(`${iso}T00:00:00Z`).getTime(), pricedDateUtc: iso,
        source: "test", createdAt: now,
      }).run();
    }
    db.transaction((tx) => { rebuildValuationsForAsset(tx, amper); });

    const result = await createAssetSplit(payload(accountId, amper), db);
    expect(result.ok).toBe(true);

    const valuations = db.select().from(schema.assetValuations).where(eq(schema.assetValuations.assetId, amper)).all();
    const before = valuations.find((v) => v.valuationDate === "2025-06-03");
    const after = valuations.find((v) => v.valuationDate === "2025-07-01");
    // Mismo valor de mercado a ambos lados del canje: 2500×0.20 = 100×5.00.
    expect(before?.quantity).toBe(2500);
    expect(before?.marketValueEur).toBeCloseTo(500, 2);
    expect(after?.quantity).toBe(100);
    expect(after?.marketValueEur).toBeCloseTo(500, 2);
  });
});
