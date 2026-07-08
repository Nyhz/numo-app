import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq, and } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { syncPrices, type PriceClient, type PriceClients } from "../price-sync";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function fakeClient(
  table: Record<string, { price: number; currency: string }>,
): PriceClient {
  return {
    fetchQuote: vi.fn(async (symbol: string) => {
      const row = table[symbol];
      if (!row) throw new Error(`no stub for ${symbol}`);
      return {
        symbol,
        price: row.price,
        currency: row.currency,
        asOf: new Date("2026-04-18T16:00:00Z"),
      };
    }),
  };
}

function asClients(
  yahoo: PriceClient,
  coingecko: PriceClient = fakeClient({}),
  ft: PriceClient = fakeClient({}),
): PriceClients {
  return { yahoo, coingecko, ft };
}

describe("syncPrices", () => {
  let db: DB;
  const today = "2026-04-18";

  beforeEach(() => {
    db = makeDb();
  });

  it("returns empty summary on a fresh DB (no active assets)", async () => {
    const client = fakeClient({});
    const summary = await syncPrices(db, asClients(client), today);
    expect(summary).toEqual({
      date: today,
      fetched: 0,
      skipped: 0,
      fxFetched: 0,
      fxSkipped: 0,
      valuationsUpserted: 0,
      errors: [],
    });
    expect(client.fetchQuote).not.toHaveBeenCalled();
  });

  it("routes a priceSource=ft asset to the ft client, keyed by ISIN:CURRENCY", async () => {
    await db.insert(schema.assets).values({
      id: "ast_ft",
      name: "Groupama Trésorerie IC",
      assetType: "fund",
      symbol: "GROUPAMA",
      isin: "FR0000989626",
      priceSource: "ft",
      currency: "EUR",
      isActive: true,
    }).run();
    await db.insert(schema.assetPositions).values({
      id: "pos_ft",
      assetId: "ast_ft",
      quantity: 2,
      averageCost: 44000,
    }).run();

    const yahoo = fakeClient({});
    const ft = fakeClient({
      "FR0000989626:EUR": { price: 44339.26, currency: "EUR" },
    });
    const summary = await syncPrices(
      db,
      asClients(yahoo, fakeClient({}), ft),
      today,
    );

    expect(summary.fetched).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(ft.fetchQuote).toHaveBeenCalledWith("FR0000989626:EUR");
    expect(yahoo.fetchQuote).not.toHaveBeenCalled();

    const priceRow = await db
      .select()
      .from(schema.priceHistory)
      .where(eq(schema.priceHistory.symbol, "FR0000989626:EUR"))
      .get();
    expect(priceRow?.source).toBe("ft");
    expect(priceRow?.price).toBe(44339.26);

    const valuation = await db
      .select()
      .from(schema.assetValuations)
      .where(eq(schema.assetValuations.assetId, "ast_ft"))
      .get();
    expect(valuation?.unitPriceEur).toBe(44339.26);
    expect(valuation?.priceSource).toBe("ft");
  });

  it("fetches prices, FX, and valuations; second call same day is idempotent", async () => {
    await db.insert(schema.assets).values({
      id: "ast_1",
      name: "Apple",
      assetType: "stock",
      providerSymbol: "AAPL",
      currency: "USD",
      isActive: true,
    }).run();
    await db.insert(schema.assetPositions).values({
      id: "pos_1",
      assetId: "ast_1",
      quantity: 10,
      averageCost: 150,
    }).run();

    const client = fakeClient({
      AAPL: { price: 200, currency: "USD" },
      "EURUSD=X": { price: 1.25, currency: "USD" }, // 1 EUR = 1.25 USD -> rateToEur = 0.8
    });

    const first = await syncPrices(db, asClients(client), today);
    expect(first.fetched).toBe(1);
    expect(first.fxFetched).toBe(1);
    expect(first.valuationsUpserted).toBe(1);
    expect(first.errors).toEqual([]);
    expect(client.fetchQuote).toHaveBeenCalledTimes(2);

    const priceRows = await db.select().from(schema.priceHistory).all();
    expect(priceRows).toHaveLength(1);
    expect(priceRows[0].price).toBe(200);
    expect(priceRows[0].source).toBe("yahoo");
    expect(priceRows[0].pricedDateUtc).toBe(today);

    const fxRows = await db.select().from(schema.fxRates).all();
    expect(fxRows).toHaveLength(1);
    expect(fxRows[0].currency).toBe("USD");
    expect(fxRows[0].rateToEur).toBeCloseTo(0.8, 8);

    const valRows = await db.select().from(schema.assetValuations).all();
    expect(valRows).toHaveLength(1);
    // unitPriceEur = 200 * 0.8 = 160; marketValueEur = 10 * 160 = 1600
    expect(valRows[0].unitPriceEur).toBeCloseTo(160, 6);
    expect(valRows[0].marketValueEur).toBeCloseTo(1600, 6);
    expect(valRows[0].quantity).toBe(10);

    // Second call: same day, should insert nothing new.
    const second = await syncPrices(db, asClients(client), today);
    expect(second.fetched).toBe(0);
    expect(second.fxFetched).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.fxSkipped).toBe(1);
    expect(second.errors).toEqual([]);

    const priceRowsAfter = await db.select().from(schema.priceHistory).all();
    expect(priceRowsAfter).toHaveLength(1);
    const fxRowsAfter = await db.select().from(schema.fxRates).all();
    expect(fxRowsAfter).toHaveLength(1);
    const valRowsAfter = await db.select().from(schema.assetValuations).all();
    expect(valRowsAfter).toHaveLength(1);
  });

  it("no escribe valoración para una posición cerrada (quantity 0) y limpia una fantasma previa", async () => {
    await db.insert(schema.assets).values({
      id: "ast_sold",
      name: "Vendida",
      assetType: "stock",
      providerSymbol: "SOLD",
      currency: "EUR",
      isActive: true,
    }).run();
    await db.insert(schema.assetPositions).values({
      id: "pos_sold",
      assetId: "ast_sold",
      quantity: 0,
      averageCost: 0,
    }).run();
    // Fila fantasma preexistente de un sync anterior.
    await db.insert(schema.assetValuations).values({
      id: "val_ghost",
      assetId: "ast_sold",
      valuationDate: today,
      quantity: 0,
      unitPriceEur: 50,
      marketValueEur: 0,
      priceSource: "yahoo",
    }).run();

    const client = fakeClient({ SOLD: { price: 50, currency: "EUR" } });
    const summary = await syncPrices(db, asClients(client), today);
    expect(summary.errors).toEqual([]);

    // La posición está cerrada → ninguna valoración debe sobrevivir para hoy.
    const valRows = await db
      .select()
      .from(schema.assetValuations)
      .where(eq(schema.assetValuations.assetId, "ast_sold"))
      .all();
    expect(valRows).toHaveLength(0);
  });

  it("uses the same-day fx_rates row to compute priceEur", async () => {
    await db.insert(schema.assets).values({
      id: "ast_2",
      name: "Example",
      assetType: "stock",
      providerSymbol: "X",
      currency: "USD",
      isActive: true,
    }).run();
    // Posición abierta: el cron solo valora posiciones con quantity > 0.
    await db.insert(schema.assetPositions).values({
      id: "pos_2",
      assetId: "ast_2",
      quantity: 3,
      averageCost: 40,
    }).run();

    const client = fakeClient({
      X: { price: 50, currency: "USD" },
      "EURUSD=X": { price: 2, currency: "USD" }, // rateToEur = 0.5
    });
    await syncPrices(db, asClients(client), today);

    const valRow = await db
      .select()
      .from(schema.assetValuations)
      .where(
        and(
          eq(schema.assetValuations.assetId, "ast_2"),
          eq(schema.assetValuations.valuationDate, today),
        ),
      )
      .get();
    expect(valRow).toBeTruthy();
    expect(valRow?.unitPriceEur).toBeCloseTo(25, 6); // 50 * 0.5
  });

  it("routes crypto assets to CoinGecko (EUR native, no FX step)", async () => {
    await db.insert(schema.assets).values({
      id: "ast_crypto",
      name: "BNB",
      assetType: "crypto",
      symbol: "BNB",
      providerSymbol: "binancecoin",
      currency: "EUR",
      isActive: true,
    }).run();
    await db.insert(schema.assetPositions).values({
      id: "pos_crypto",
      assetId: "ast_crypto",
      quantity: 0.5,
      averageCost: 600,
    }).run();

    const yahoo = fakeClient({});
    const coingecko = fakeClient({
      binancecoin: { price: 650, currency: "EUR" },
    });

    const summary = await syncPrices(db, { yahoo, coingecko, ft: fakeClient({}) }, today);
    expect(summary.fetched).toBe(1);
    expect(summary.fxFetched).toBe(0);
    expect(summary.valuationsUpserted).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(yahoo.fetchQuote).not.toHaveBeenCalled();
    expect(coingecko.fetchQuote).toHaveBeenCalledWith("binancecoin");

    const priceRows = await db.select().from(schema.priceHistory).all();
    expect(priceRows).toHaveLength(1);
    expect(priceRows[0].source).toBe("coingecko");
    expect(priceRows[0].price).toBe(650);

    const fxRows = await db.select().from(schema.fxRates).all();
    expect(fxRows).toHaveLength(0);

    const valRows = await db.select().from(schema.assetValuations).all();
    expect(valRows[0].unitPriceEur).toBeCloseTo(650, 6);
    expect(valRows[0].marketValueEur).toBeCloseTo(325, 2);
    expect(valRows[0].priceSource).toBe("coingecko");
  });

  it("reports an error when a crypto asset is missing its providerSymbol", async () => {
    await db.insert(schema.assets).values({
      id: "ast_crypto_bad",
      name: "Unknown crypto",
      assetType: "crypto",
      symbol: null,
      providerSymbol: null,
      currency: "EUR",
      isActive: true,
    }).run();
    const summary = await syncPrices(
      db,
      { yahoo: fakeClient({}), coingecko: fakeClient({}), ft: fakeClient({}) },
      today,
    );
    expect(summary.fetched).toBe(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].message).toMatch(/providerSymbol/);
  });

  it("skips inactive assets", async () => {
    await db.insert(schema.assets).values({
      id: "ast_3",
      name: "Old",
      assetType: "stock",
      providerSymbol: "OLD",
      currency: "EUR",
      isActive: false,
    }).run();
    const client = fakeClient({});
    const summary = await syncPrices(db, asClients(client), today);
    expect(summary.fetched).toBe(0);
    expect(client.fetchQuote).not.toHaveBeenCalled();
  });
});

describe("cron sync-prices route", () => {
  it("rejects requests without the CRON_SECRET header", async () => {
    process.env.CRON_SECRET = "test-secret";
    const { GET, POST } = await import("../../app/api/cron/sync-prices/route");

    const bare = await GET(new Request("http://localhost/api/cron/sync-prices"));
    expect(bare.status).toBe(401);

    const wrong = await POST(
      new Request("http://localhost/api/cron/sync-prices", {
        method: "POST",
        headers: { "x-cron-secret": "nope" },
      }),
    );
    expect(wrong.status).toBe(401);
  });

  it("rejects when CRON_SECRET env var is unset (deny-by-default)", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("../../app/api/cron/sync-prices/route");
    const res = await GET(
      new Request("http://localhost/api/cron/sync-prices", {
        headers: { "x-cron-secret": "anything" },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("fallback TradingView", () => {
  it("rescata un stock cuyo fetch Yahoo falla, bajo el símbolo canónico y source tradingview", async () => {
    const db = makeDb();
    // seed: activo stock con providerSymbol AMP.MC y tradingviewSymbol BME:AMP
    db.insert(schema.assets).values({
      id: "ast_amp", name: "AMPER", assetType: "stock", currency: "EUR",
      symbol: "AMP", providerSymbol: "AMP.MC", tradingviewSymbol: "BME:AMP", isActive: true,
    }).run();
    const summary = await syncPrices(db, {
      yahoo: { fetchQuote: async () => { throw new Error("429"); } },
      coingecko: { fetchQuote: async () => { throw new Error("unused"); } },
      ft: { fetchQuote: async () => { throw new Error("unused"); } },
      tradingview: {
        fetchQuote: async () => { throw new Error("unused"); },
        fetchQuotes: async (symbols) => symbols.map((s) => ({
          symbol: s, price: 0.21, currency: "EUR", asOf: new Date("2026-07-08T16:00:00Z"),
        })),
      },
    }, "2026-07-08");
    expect(summary.fetched).toBe(1);
    expect(summary.errors).toHaveLength(0);
    const row = db.select().from(schema.priceHistory).all()[0];
    expect(row.symbol).toBe("AMP.MC");          // serie continua bajo el símbolo Yahoo
    expect(row.source).toBe("tradingview");
  });

  it("sin cliente tradingview el fallo Yahoo queda como error (comportamiento actual)", async () => {
    const db = makeDb();
    db.insert(schema.assets).values({
      id: "ast_amp", name: "AMPER", assetType: "stock", currency: "EUR",
      symbol: "AMP", providerSymbol: "AMP.MC", tradingviewSymbol: "BME:AMP", isActive: true,
    }).run();
    const summary = await syncPrices(db, {
      yahoo: { fetchQuote: async () => { throw new Error("429"); } },
      coingecko: { fetchQuote: async () => { throw new Error("unused"); } },
      ft: { fetchQuote: async () => { throw new Error("unused"); } },
    }, "2026-07-08");
    expect(summary.errors).toHaveLength(1);
  });

  it("override manual priceSource=tradingview usa el cliente TV como primario", async () => {
    const db = makeDb();
    db.insert(schema.assets).values({
      id: "ast_amp", name: "AMPER", assetType: "stock", currency: "EUR",
      symbol: "AMP", priceSource: "tradingview", tradingviewSymbol: "BME:AMP", isActive: true,
    }).run();
    const summary = await syncPrices(db, {
      yahoo: { fetchQuote: async () => { throw new Error("unused"); } },
      coingecko: { fetchQuote: async () => { throw new Error("unused"); } },
      ft: { fetchQuote: async () => { throw new Error("unused"); } },
      tradingview: {
        fetchQuote: async (s) => ({ symbol: s, price: 0.21, currency: "EUR", asOf: new Date() }),
        fetchQuotes: async () => [],
      },
    }, "2026-07-08");
    expect(summary.fetched).toBe(1);
    const row = db.select().from(schema.priceHistory).all()[0];
    expect(row.symbol).toBe("BME:AMP");          // override ⇒ serie bajo el símbolo TV
  });
});
