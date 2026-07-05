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
  accountCashMovements,
  accounts,
  assetPositions,
  assets,
  assetTransactions,
  taxLotConsumptions,
} from "../../db/schema";
import { createAssetWithdrawal } from "../createAssetWithdrawal";
import { rebuildValuationsForAsset } from "../../server/valuations";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seed(db: DB) {
  const accountId = ulid();
  const usdt = ulid();
  db.insert(accounts).values({ id: accountId, name: "BINANCE", currency: "EUR", accountType: "crypto", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
  db.insert(assets).values({ id: usdt, name: "USDT", assetType: "crypto", currency: "USDT", isActive: true, assetClassTax: "crypto" }).run();
  db.insert(assetTransactions).values({
    id: ulid(), accountId, assetId: usdt,
    transactionType: "buy", tradedAt: Date.UTC(2025, 5, 1),
    quantity: 10, unitPrice: 10,
    tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: 100, tradeGrossAmountEur: 100, cashImpactEur: -100,
    feesAmount: 0, feesAmountEur: 0, netAmountEur: -100,
    isListed: false, source: "manual",
  }).run();
  return { accountId, usdt };
}

const payload = (accountId: string, assetId: string) => ({
  accountId, assetId,
  tradeDate: "2025-08-01",
  quantity: 10,
  valueEur: 99.5,
});

describe("createAssetWithdrawal", () => {
  it("registra un transfer_out que vacía la posición sin rastro fiscal ni de caja", async () => {
    const db = makeDb();
    const { accountId, usdt } = seed(db);

    const result = await createAssetWithdrawal(payload(accountId, usdt), db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = db.select().from(assetTransactions).where(eq(assetTransactions.id, result.data.id)).get();
    expect(row?.transactionType).toBe("transfer_out");
    expect(row?.quantity).toBe(10);
    expect(row?.tradeGrossAmountEur).toBe(99.5);
    // Semántica de flujo (como la pata sell de un swap): valor que sale del
    // portfolio para el TWR, sin movimiento de caja real.
    expect(row?.cashImpactEur).toBe(99.5);
    expect(row?.tradeCurrency).toBe("EUR");
    expect(row?.rowFingerprint).toMatch(/^[0-9a-f]{64}$/);

    // Posición drenada a cero → fila eliminada.
    expect(db.select().from(assetPositions).where(eq(assetPositions.assetId, usdt)).all()).toHaveLength(0);
    // Ni par fiscal ni movimiento de caja.
    expect(db.select().from(taxLotConsumptions).all()).toHaveLength(0);
    expect(db.select().from(accountCashMovements).all()).toHaveLength(0);

    const audit = db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId, result.data.id)).get();
    expect(audit?.action).toBe("create-asset-withdrawal");
  });

  it("una retirada parcial deja la posición con cantidad y coste proporcionales", async () => {
    const db = makeDb();
    const { accountId, usdt } = seed(db);

    const result = await createAssetWithdrawal({ ...payload(accountId, usdt), quantity: 4, valueEur: 40 }, db);
    expect(result.ok).toBe(true);

    const position = db.select().from(assetPositions).where(eq(assetPositions.assetId, usdt)).get();
    expect(position?.quantity).toBe(6);
    expect(position?.totalCostEur).toBeCloseTo(60, 2);
  });

  it("rechaza retirar más unidades de las poseídas (comprobación FIFO)", async () => {
    const db = makeDb();
    const { accountId, usdt } = seed(db);

    const result = await createAssetWithdrawal({ ...payload(accountId, usdt), quantity: 11, valueEur: 110 }, db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
    expect(result.error.fieldErrors?.quantity?.[0]).toMatch(/FIFO/);
  });

  it("detecta duplicados y los admite con allowDuplicate (fingerprints salteados)", async () => {
    const db = makeDb();
    const { accountId, usdt } = seed(db);

    const first = await createAssetWithdrawal({ ...payload(accountId, usdt), quantity: 2, valueEur: 20 }, db);
    expect(first.ok).toBe(true);
    const second = await createAssetWithdrawal({ ...payload(accountId, usdt), quantity: 2, valueEur: 20 }, db);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("duplicate");

    const third = await createAssetWithdrawal({ ...payload(accountId, usdt), quantity: 2, valueEur: 20, allowDuplicate: true }, db);
    expect(third.ok).toBe(true);

    const rows = db.select().from(assetTransactions).all().filter((r) => r.transactionType === "transfer_out");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.rowFingerprint)).size).toBe(2);
  });

  it("las valoraciones diarias dejan de escribirse desde la fecha de retirada", async () => {
    const db = makeDb();
    const accountId = ulid();
    const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "BINANCE", currency: "EUR", accountType: "crypto", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    // Divisa EUR para que la curva FX sea trivial y el rebuild escriba filas.
    db.insert(assets).values({ id: assetId, name: "USDT", symbol: "USDT-T", assetType: "crypto", currency: "EUR", isActive: true, assetClassTax: "crypto" }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(2025, 5, 1, 12),
      quantity: 10, unitPrice: 10,
      tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 100, tradeGrossAmountEur: 100, cashImpactEur: -100,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -100,
      isListed: false, source: "manual",
    }).run();
    const now = Date.now();
    for (const iso of ["2025-06-02", "2025-08-02"]) {
      db.insert(schema.priceHistory).values({
        id: ulid(), symbol: "USDT-T", price: 1,
        pricedAt: new Date(`${iso}T00:00:00Z`).getTime(), pricedDateUtc: iso,
        source: "test", createdAt: now,
      }).run();
    }
    // Estado previo: la curva diaria existe antes de retirar.
    db.transaction((tx) => { rebuildValuationsForAsset(tx, assetId); });

    const result = await createAssetWithdrawal(payload(accountId, assetId), db);
    expect(result.ok).toBe(true);

    const valuations = db.select().from(schema.assetValuations).where(eq(schema.assetValuations.assetId, assetId)).all();
    const before = valuations.filter((v) => v.valuationDate < "2025-08-01");
    const onOrAfter = valuations.filter((v) => v.valuationDate >= "2025-08-01");
    expect(before.length).toBeGreaterThan(0);
    // Retirada total el 2025-08-01: la posición ya no existe, ninguna fila posterior.
    expect(onOrAfter).toHaveLength(0);
  });

  it("rechaza cuenta o activo inexistentes", async () => {
    const db = makeDb();
    const { accountId, usdt } = seed(db);
    const noAccount = await createAssetWithdrawal(payload("nope", usdt), db);
    expect(noAccount.ok).toBe(false);
    const noAsset = await createAssetWithdrawal(payload(accountId, "nope"), db);
    expect(noAsset.ok).toBe(false);
  });
});
