import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createAsset } from "../createAsset";
import { createAssetSchema } from "../createAsset.schema";
import { updateAsset } from "../updateAsset";
import { updateAssetSchema } from "../updateAsset.schema";
import { deactivateAsset } from "../deactivateAsset";
import { setManualPrice } from "../setManualPrice";
import { setManualPriceSchema } from "../setManualPrice.schema";
import { createAccount } from "../accounts";
import { createTransaction } from "../createTransaction";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("asset zod schemas", () => {
  it("createAssetSchema rejects empty name and bad currency", () => {
    const result = createAssetSchema.safeParse({
      name: "",
      symbol: "X",
      assetType: "stock",
      currency: "euro",
    });
    expect(result.success).toBe(false);
  });

  it("createAssetSchema accepts minimal valid input", () => {
    const result = createAssetSchema.safeParse({
      name: "Foo",
      symbol: "FOO",
      assetType: "stock",
      currency: "EUR",
    });
    expect(result.success).toBe(true);
  });

  it("updateAssetSchema requires id", () => {
    expect(updateAssetSchema.safeParse({}).success).toBe(false);
    expect(updateAssetSchema.safeParse({ id: "abc" }).success).toBe(true);
  });

  it("setManualPriceSchema rejects non-positive price", () => {
    expect(
      setManualPriceSchema.safeParse({ assetId: "a", priceNative: 0 }).success,
    ).toBe(false);
    expect(
      setManualPriceSchema.safeParse({ assetId: "a", priceNative: 1.5 }).success,
    ).toBe(true);
  });
});

describe("asset schemas: tradingview + logo", () => {
  it("createAssetSchema acepta priceSource tradingview y los campos nuevos", () => {
    const parsed = createAssetSchema.safeParse({
      name: "Vanguard FTSE All-World",
      symbol: "VWCE",
      assetType: "etf",
      currency: "EUR",
      priceSource: "tradingview",
      tradingviewSymbol: "XETR:VWCE",
      logoUrl: "https://s3-symbol-logo.tradingview.com/vanguard.svg",
    });
    expect(parsed.success).toBe(true);
  });

  it("updateAssetSchema acepta patch de tradingviewSymbol/logoUrl/priceSource", () => {
    const parsed = updateAssetSchema.safeParse({
      id: "ast_1",
      tradingviewSymbol: "BME:AMP",
      logoUrl: null,
      priceSource: "tradingview",
    });
    expect(parsed.success).toBe(true);
  });

  it("logoUrl inválida se rechaza", () => {
    const parsed = updateAssetSchema.safeParse({ id: "ast_1", logoUrl: "no-es-url" });
    expect(parsed.success).toBe(false);
  });

  it("createAssetSchema rechaza priceSource tradingview sin tradingviewSymbol", () => {
    const parsed = createAssetSchema.safeParse({
      name: "Amper",
      symbol: "AMP.MC",
      assetType: "stock",
      currency: "EUR",
      priceSource: "tradingview",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const flat = z.flattenError(parsed.error);
    expect(flat.fieldErrors.tradingviewSymbol).toBeDefined();
  });

  it("createAssetSchema acepta priceSource tradingview con tradingviewSymbol", () => {
    const parsed = createAssetSchema.safeParse({
      name: "Amper",
      symbol: "AMP.MC",
      assetType: "stock",
      currency: "EUR",
      priceSource: "tradingview",
      tradingviewSymbol: "BME:AMP",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("createAsset action", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("inserts asset and audit event", async () => {
    const result = await createAsset(
      {
        name: "Apple",
        symbol: "AAPL",
        assetType: "stock",
        currency: "USD",
        isin: "US0378331005",
      },
      db,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await db.select().from(schema.assets).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("AAPL");

    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, result.data.id))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("create");
  });
});

describe("updateAsset + deactivateAsset", () => {
  let db: DB;
  let id: string;
  beforeEach(async () => {
    db = makeDb();
    const created = await createAsset(
      { name: "Foo", symbol: "FOO", assetType: "stock", currency: "EUR" },
      db,
    );
    if (!created.ok) throw new Error("setup failed");
    id = created.data.id;
  });

  it("updateAsset patches fields and writes audit", async () => {
    const result = await updateAsset({ id, name: "Bar" }, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe("Bar");
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, id))
      .all();
    expect(events.map((e) => e.action)).toContain("update");
  });

  it("deactivateAsset flips isActive to false", async () => {
    const result = await deactivateAsset({ id }, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.isActive).toBe(false);
  });

  it("updateAsset re-infiere assetClassTax al cambiar el tipo de activo", async () => {
    // Alta como stock → listed_security (ventana 2 meses, bloque M720 valores).
    const before = await db.select().from(schema.assets).where(eq(schema.assets.id, id)).get();
    expect(before?.assetClassTax).toBe("listed_security");

    const result = await updateAsset({ id, assetType: "fund" }, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Corregirlo a fondo debe recalcular la clase fiscal, no dejarla congelada.
    expect(result.data.assetClassTax).toBe("fund");
  });

  it("updateAsset returns not_found for missing id", async () => {
    const result = await updateAsset({ id: "missing", name: "x" }, db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });
});

describe("setManualPrice", () => {
  let db: DB;
  let assetId: string;
  beforeEach(async () => {
    db = makeDb();
    const created = await createAsset(
      { name: "Foo", symbol: "FOO", assetType: "stock", currency: "EUR" },
      db,
    );
    if (!created.ok) throw new Error("setup failed");
    assetId = created.data.id;
  });

  it("inserts price_history row with source=manual", async () => {
    const result = await setManualPrice(
      { assetId, priceNative: 12.34, priceDate: "2026-01-15" },
      db,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.source).toBe("manual");
    expect(result.data.price).toBe(12.34);
    expect(result.data.pricedDateUtc).toBe("2026-01-15");
  });

  it("rebuilds the valuation series so the manual price reaches asset_valuations", async () => {
    // Audit M5: a manual price must create/refresh the valuation rows for a
    // held asset even when no valuation existed for that date yet.
    const acc = await createAccount(
      { name: "Broker", accountType: "savings", currency: "EUR", openingBalanceNative: 1000 },
      db,
    );
    if (!acc.ok) throw new Error("account setup");
    const bought = await createTransaction(
      {
        accountId: acc.data.id,
        assetId,
        tradeDate: "2026-01-12",
        side: "buy",
        quantity: 10,
        priceNative: 1,
        currency: "EUR",
      },
      db,
    );
    if (!bought.ok) throw new Error(`buy setup: ${bought.error.message}`);

    const result = await setManualPrice(
      { assetId, priceNative: 5, priceDate: "2026-01-15" },
      db,
    );
    expect(result.ok).toBe(true);

    const v = await db
      .select()
      .from(schema.assetValuations)
      .where(
        and(
          eq(schema.assetValuations.assetId, assetId),
          eq(schema.assetValuations.valuationDate, "2026-01-15"),
        ),
      )
      .get();
    expect(v?.quantity).toBe(10);
    expect(v?.unitPriceEur).toBe(5);
    expect(v?.marketValueEur).toBe(50);
  });
});
