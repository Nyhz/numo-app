import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createAccount } from "../accounts";
import { createAsset } from "../createAsset";
import { createTransaction } from "../createTransaction";
import { createDividend } from "../createDividend";
import { createSwap } from "../createSwap";
import { createCashMovement } from "../createCashMovement";
import { createAssetWithdrawal } from "../createAssetWithdrawal";
import { deleteTransaction } from "../deleteTransaction";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

async function setup(db: DB, assetCurrency = "USD") {
  const acc = await createAccount(
    { name: "Broker", accountType: "savings", currency: "EUR", openingBalanceNative: 100000 },
    db,
  );
  if (!acc.ok) throw new Error("account setup");
  const ast = await createAsset(
    { name: "Acme Corp", symbol: "ACME", assetType: "stock", currency: assetCurrency },
    db,
  );
  if (!ast.ok) throw new Error("asset setup");
  return { accountId: acc.data.id, assetId: ast.data.id };
}

function seedFxRate(db: DB, currency: string, date: string, rateToEur: number) {
  db.insert(schema.fxRates).values({ id: ulid(), currency, date, rateToEur }).run();
}

describe("H4 — trade currency must match the asset's quote currency", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("rejects a trade entered in a different currency than the asset", async () => {
    const { accountId, assetId } = await setup(db, "USD");
    const result = await createTransaction(
      {
        accountId,
        assetId,
        tradeDate: "2026-01-15",
        side: "buy",
        quantity: 1,
        priceNative: 100,
        currency: "EUR",
      },
      db,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
    expect(result.error.fieldErrors?.currency?.[0]).toMatch(/cotiza en USD/);
  });

  it("accepts a trade in the asset's own currency", async () => {
    const { accountId, assetId } = await setup(db, "USD");
    seedFxRate(db, "USD", "2026-01-15", 0.92);
    const result = await createTransaction(
      {
        accountId,
        assetId,
        tradeDate: "2026-01-15",
        side: "buy",
        quantity: 2,
        priceNative: 100,
        currency: "USD",
        fxEurToCcy: 1 / 0.92,
      },
      db,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fxRateToEur).toBeCloseTo(0.92, 9);
    expect(result.data.fxSource).toBe("explicit");
  });
});

describe("H3 — explicit FX rates that deviate from the stored rate", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("rejects an inverse-looking manual rate with code fx_deviation", async () => {
    const { accountId, assetId } = await setup(db, "USD");
    seedFxRate(db, "USD", "2026-01-15", 0.92);
    const result = await createTransaction(
      {
        accountId,
        assetId,
        tradeDate: "2026-01-15",
        side: "buy",
        quantity: 1,
        priceNative: 100,
        currency: "USD",
        fxEurToCcy: 0.92, // USD→EUR typed by mistake (the field is EUR→USD)
      },
      db,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("fx_deviation");
    expect(result.error.message).toMatch(/inverso/);
  });

  it("accepts the deviant rate when explicitly confirmed", async () => {
    const { accountId, assetId } = await setup(db, "USD");
    seedFxRate(db, "USD", "2026-01-15", 0.92);
    const result = await createTransaction(
      {
        accountId,
        assetId,
        tradeDate: "2026-01-15",
        side: "buy",
        quantity: 1,
        priceNative: 100,
        currency: "USD",
        fxEurToCcy: 0.92,
        allowFxDeviation: true,
      },
      db,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fxRateToEur).toBeCloseTo(1 / 0.92, 9);
    expect(result.data.fxSource).toBe("explicit");
  });

  it("accepts a manual rate close to the daily reference without ceremony", async () => {
    const { accountId, assetId } = await setup(db, "USD");
    seedFxRate(db, "USD", "2026-01-15", 0.92);
    const result = await createTransaction(
      {
        accountId,
        assetId,
        tradeDate: "2026-01-15",
        side: "buy",
        quantity: 1,
        priceNative: 100,
        currency: "USD",
        fxEurToCcy: 1.081, // ≈ 1/0.925 — within tolerance of the 1/0.92 reference
      },
      db,
    );
    expect(result.ok).toBe(true);
  });
});

describe("H5 — oversell surfaces as a friendly quantity error", () => {
  it("reports the units actually held instead of a raw FIFO abort", async () => {
    const db = makeDb();
    const { accountId, assetId } = await setup(db, "EUR");
    const buy = await createTransaction(
      {
        accountId,
        assetId,
        tradeDate: "2026-01-10",
        side: "buy",
        quantity: 5,
        priceNative: 10,
        currency: "EUR",
      },
      db,
    );
    expect(buy.ok).toBe(true);
    const sell = await createTransaction(
      {
        accountId,
        assetId,
        tradeDate: "2026-01-20",
        side: "sell",
        quantity: 8,
        priceNative: 12,
        currency: "EUR",
      },
      db,
    );
    expect(sell.ok).toBe(false);
    if (sell.ok) return;
    expect(sell.error.code).toBe("validation");
    expect(sell.error.fieldErrors?.quantity?.[0]).toMatch(/Solo se poseen 5/);
  });

  it("una retirada previa (transfer_out) reduce las unidades disponibles para vender", async () => {
    const db = makeDb();
    const { accountId, assetId } = await setup(db, "EUR");
    const buy = await createTransaction(
      { accountId, assetId, tradeDate: "2026-01-10", side: "buy", quantity: 10, priceNative: 10, currency: "EUR" },
      db,
    );
    expect(buy.ok).toBe(true);
    const withdraw = await createAssetWithdrawal(
      { accountId, assetId, tradeDate: "2026-01-15", quantity: 8, valueEur: 96 },
      db,
    );
    expect(withdraw.ok).toBe(true);
    // Quedan 2 unidades; vender 5 debe fallar con el conteo real (10−8=2),
    // no colarse por el guard que ignoraba transfer_out.
    const sell = await createTransaction(
      { accountId, assetId, tradeDate: "2026-01-20", side: "sell", quantity: 5, priceNative: 12, currency: "EUR" },
      db,
    );
    expect(sell.ok).toBe(false);
    if (sell.ok) return;
    expect(sell.error.fieldErrors?.quantity?.[0]).toMatch(/Solo se poseen 2/);
  });
});

describe("M2 — dividend withholding sanity", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("rejects origin withholding above the gross (field error, not banner)", async () => {
    const { accountId, assetId } = await setup(db, "USD");
    const result = await createDividend(
      {
        accountId,
        assetId,
        tradeDate: "2026-01-15",
        grossNative: 10,
        currency: "USD",
        withholdingOrigenNative: 100,
      },
      db,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
    expect(result.error.fieldErrors?.withholdingOrigenNative?.[0]).toMatch(/no puede superar/);
  });

  it("rejects destination withholding that drives the net negative", async () => {
    const { accountId, assetId } = await setup(db, "USD");
    seedFxRate(db, "USD", "2026-01-15", 0.9);
    const result = await createDividend(
      {
        accountId,
        assetId,
        tradeDate: "2026-01-15",
        grossNative: 10, // 9 EUR gross
        currency: "USD",
        fxEurToCcy: 1 / 0.9,
        withholdingDestinoEur: 50,
      },
      db,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.fieldErrors?.withholdingDestinoEur?.[0]).toMatch(/supera el dividendo bruto/);
  });
});

describe("M3/M7 — cash movement sign and duplicates", () => {
  let db: DB;
  let accountId: string;
  beforeEach(async () => {
    db = makeDb();
    const acc = await createAccount(
      { name: "Bank", accountType: "savings", currency: "EUR", openingBalanceNative: 0 },
      db,
    );
    if (!acc.ok) throw new Error("setup");
    accountId = acc.data.id;
  });

  it("rejects zero and negative amounts (direction comes from kind)", async () => {
    for (const amountNative of [0, -500]) {
      const result = await createCashMovement(
        { accountId, kind: "deposit", occurredAt: "2026-01-15", amountNative, currency: "EUR" },
        db,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.fieldErrors?.amountNative?.[0]).toMatch(/positivo/);
    }
  });

  it("flags an identical same-day movement as duplicate and allows an override", async () => {
    const payload = {
      accountId,
      kind: "deposit" as const,
      occurredAt: "2026-01-15",
      amountNative: 100,
      currency: "EUR",
    };
    const first = await createCashMovement(payload, db);
    expect(first.ok).toBe(true);

    const second = await createCashMovement(payload, db);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("duplicate");

    const confirmed = await createCashMovement({ ...payload, allowDuplicate: true }, db);
    expect(confirmed.ok).toBe(true);

    const movements = await db
      .select()
      .from(schema.accountCashMovements)
      .where(eq(schema.accountCashMovements.accountId, accountId))
      .all();
    // opening balance + two deposits
    expect(movements.filter((m) => m.movementType === "deposit").length).toBe(2);
  });
});

describe("H1/H2 — swap legs are honest about units and die together", () => {
  let db: DB;
  let accountId: string;
  let btcId: string;
  let ethId: string;
  beforeEach(async () => {
    db = makeDb();
    const acc = await createAccount(
      { name: "Binance", accountType: "savings", currency: "EUR", openingBalanceNative: 100000 },
      db,
    );
    if (!acc.ok) throw new Error("setup");
    accountId = acc.data.id;
    const btc = await createAsset(
      { name: "Bitcoin", symbol: "BTC", assetType: "crypto", currency: "BTC" },
      db,
    );
    const eth = await createAsset(
      { name: "Ethereum", symbol: "ETH", assetType: "crypto", currency: "ETH" },
      db,
    );
    if (!btc.ok || !eth.ok) throw new Error("asset setup");
    btcId = btc.data.id;
    ethId = eth.data.id;
    // Hold 1 BTC so the swap's outgoing sell has a lot to consume.
    seedFxRate(db, "BTC", "2026-01-02", 40000);
    const buy = await createTransaction(
      {
        accountId,
        assetId: btcId,
        tradeDate: "2026-01-02",
        side: "buy",
        quantity: 1,
        priceNative: 1,
        currency: "BTC",
        fxEurToCcy: 1 / 40000, // manual, broker direction: 1 EUR = 0.000025 BTC
      },
      db,
    );
    if (!buy.ok) throw new Error(`btc buy setup: ${buy.error.message}`);
  });

  it("stamps both legs as EUR-denominated (no fake native units at rate 1)", async () => {
    const result = await createSwap(
      {
        accountId,
        tradeDate: "2026-02-01",
        outgoingAssetId: btcId,
        outgoingQuantity: 0.5,
        incomingAssetId: ethId,
        incomingQuantity: 8,
        valueEur: 20000,
      },
      db,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const legs = await db
      .select()
      .from(schema.assetTransactions)
      .where(eq(schema.assetTransactions.linkedTransactionId, result.data.buyId))
      .all();
    const sellLeg = legs[0];
    expect(sellLeg.tradeCurrency).toBe("EUR");
    expect(sellLeg.fxRateToEur).toBe(1);
    expect(sellLeg.tradeGrossAmount).toBe(20000);
    expect(sellLeg.tradeGrossAmountEur).toBe(20000);
  });

  it("deleting one leg deletes the linked leg and rebuilds both positions", async () => {
    const created = await createSwap(
      {
        accountId,
        tradeDate: "2026-02-01",
        outgoingAssetId: btcId,
        outgoingQuantity: 0.5,
        incomingAssetId: ethId,
        incomingQuantity: 8,
        valueEur: 20000,
      },
      db,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const deleted = await deleteTransaction({ id: created.data.sellId }, db);
    expect(deleted.ok).toBe(true);

    const remaining = await db
      .select()
      .from(schema.assetTransactions)
      .where(eq(schema.assetTransactions.id, created.data.buyId))
      .get();
    expect(remaining).toBeUndefined();

    // The phantom ETH position is gone and the full BTC holding is restored.
    const ethPos = await db
      .select()
      .from(schema.assetPositions)
      .where(eq(schema.assetPositions.assetId, ethId))
      .get();
    expect(ethPos?.quantity ?? 0).toBe(0);
    const btcPos = await db
      .select()
      .from(schema.assetPositions)
      .where(eq(schema.assetPositions.assetId, btcId))
      .get();
    expect(btcPos?.quantity).toBe(1);
  });
});
