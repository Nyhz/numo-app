import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { syncWatchlistQuotes, type WatchlistClients } from "../watchlist-sync";
import type { Quote } from "../pricing/types";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedAsset(
  db: DB,
  opts: {
    name: string;
    assetType: string;
    symbol: string;
    watchlisted?: boolean;
    active?: boolean;
    tradingviewSymbol?: string;
  },
): string {
  const id = ulid();
  db.insert(schema.assets)
    .values({
      id,
      name: opts.name,
      assetType: opts.assetType,
      symbol: opts.symbol,
      providerSymbol: opts.symbol,
      tradingviewSymbol: opts.tradingviewSymbol,
      isWatchlisted: opts.watchlisted ?? true,
      isActive: opts.active ?? true,
    })
    .run();
  return id;
}

function seedAlert(
  db: DB,
  assetId: string,
  opts: { kind: "price_below" | "price_above"; threshold: number; status?: "armed" | "triggered"; telegram?: boolean },
): string {
  const id = ulid();
  db.insert(schema.priceAlerts)
    .values({
      id,
      assetId,
      kind: opts.kind,
      threshold: opts.threshold,
      notifyTelegram: opts.telegram ?? false,
      status: opts.status ?? "armed",
      isActive: true,
    })
    .run();
  return id;
}

function clients(quotes: Quote[], sendTelegram?: WatchlistClients["sendTelegram"]): WatchlistClients {
  // Route quotes to the right provider stub by currency (EUR → crypto/coingecko
  // in these tests; otherwise yahoo). Each stub returns the subset it owns.
  return {
    yahoo: { fetchQuotes: vi.fn(async (syms: string[]) => quotes.filter((q) => syms.map((s) => s.toUpperCase()).includes(q.symbol.toUpperCase()) && q.currency !== "EUR")) },
    coingecko: { fetchQuotes: vi.fn(async (syms: string[]) => quotes.filter((q) => syms.map((s) => s.toLowerCase()).includes(q.symbol.toLowerCase()) && q.currency === "EUR")) },
    sendTelegram,
  };
}

const NOW = 1_750_000_000_000;

describe("syncWatchlistQuotes", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("caches the intraday quote without writing price_history", async () => {
    const id = seedAsset(db, { name: "Apple", assetType: "stock", symbol: "AAPL" });
    const summary = await syncWatchlistQuotes(
      db,
      clients([{ symbol: "AAPL", price: 190, currency: "USD", asOf: new Date(NOW) }]),
      NOW,
    );

    expect(summary.quoted).toBe(1);
    const cached = db.select().from(schema.watchlistQuotes).where(eq(schema.watchlistQuotes.assetId, id)).get();
    expect(cached?.price).toBe(190);
    expect(cached?.currency).toBe("USD");

    // The daily history lane is untouched.
    const history = db.select().from(schema.priceHistory).all();
    expect(history).toHaveLength(0);
  });

  it("keeps the previous price across refreshes for the tick indicator", async () => {
    const id = seedAsset(db, { name: "Apple", assetType: "stock", symbol: "AAPL" });

    await syncWatchlistQuotes(db, clients([{ symbol: "AAPL", price: 190, currency: "USD", asOf: new Date(NOW) }]), NOW);
    let cached = db.select().from(schema.watchlistQuotes).where(eq(schema.watchlistQuotes.assetId, id)).get();
    expect(cached?.price).toBe(190);
    expect(cached?.prevPrice).toBeNull(); // no previous on first quote

    await syncWatchlistQuotes(db, clients([{ symbol: "AAPL", price: 195, currency: "USD", asOf: new Date(NOW) }]), NOW);
    cached = db.select().from(schema.watchlistQuotes).where(eq(schema.watchlistQuotes.assetId, id)).get();
    expect(cached?.price).toBe(195);
    expect(cached?.prevPrice).toBe(190); // prior tick retained
  });

  it("fires a price_below alert, records an event and sends Telegram", async () => {
    const id = seedAsset(db, { name: "Apple", assetType: "stock", symbol: "AAPL" });
    seedAlert(db, id, { kind: "price_below", threshold: 200, telegram: true });
    const send = vi.fn(async () => ({ ok: true }));

    const summary = await syncWatchlistQuotes(
      db,
      clients([{ symbol: "AAPL", price: 190, currency: "USD", asOf: new Date(NOW) }], send),
      NOW,
    );

    expect(summary.triggered).toBe(1);
    expect(summary.telegramSent).toBe(1);
    expect(send).toHaveBeenCalledOnce();

    const alert = db.select().from(schema.priceAlerts).where(eq(schema.priceAlerts.assetId, id)).get();
    expect(alert?.status).toBe("triggered");
    const events = db.select().from(schema.alertEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0].priceAtTrigger).toBe(190);
    expect(events[0].telegramSent).toBe(true);
  });

  it("does not fire when the price is on the safe side", async () => {
    const id = seedAsset(db, { name: "Apple", assetType: "stock", symbol: "AAPL" });
    seedAlert(db, id, { kind: "price_below", threshold: 200 });

    const summary = await syncWatchlistQuotes(
      db,
      clients([{ symbol: "AAPL", price: 210, currency: "USD", asOf: new Date(NOW) }]),
      NOW,
    );

    expect(summary.triggered).toBe(0);
    expect(db.select().from(schema.alertEvents).all()).toHaveLength(0);
    const alert = db.select().from(schema.priceAlerts).where(eq(schema.priceAlerts.assetId, id)).get();
    expect(alert?.status).toBe("armed");
  });

  it("re-arms a triggered alert once the price crosses back (hysteresis)", async () => {
    const id = seedAsset(db, { name: "Apple", assetType: "stock", symbol: "AAPL" });
    seedAlert(db, id, { kind: "price_below", threshold: 200, status: "triggered" });

    const summary = await syncWatchlistQuotes(
      db,
      clients([{ symbol: "AAPL", price: 205, currency: "USD", asOf: new Date(NOW) }]),
      NOW,
    );

    expect(summary.rearmed).toBe(1);
    expect(summary.triggered).toBe(0);
    const alert = db.select().from(schema.priceAlerts).where(eq(schema.priceAlerts.assetId, id)).get();
    expect(alert?.status).toBe("armed");
    expect(db.select().from(schema.alertEvents).all()).toHaveLength(0);
  });

  it("routes crypto through the CoinGecko batch and fires price_above", async () => {
    const id = seedAsset(db, { name: "Bitcoin", assetType: "crypto", symbol: "bitcoin" });
    seedAlert(db, id, { kind: "price_above", threshold: 50_000 });

    const summary = await syncWatchlistQuotes(
      db,
      clients([{ symbol: "bitcoin", price: 60_000, currency: "EUR", asOf: new Date(NOW) }]),
      NOW,
    );

    expect(summary.quoted).toBe(1);
    expect(summary.triggered).toBe(1);
    const cached = db.select().from(schema.watchlistQuotes).where(eq(schema.watchlistQuotes.assetId, id)).get();
    expect(cached?.source).toBe("coingecko");
  });

  it("ignores assets that are not watchlisted", async () => {
    seedAsset(db, { name: "Apple", assetType: "stock", symbol: "AAPL", watchlisted: false });
    const summary = await syncWatchlistQuotes(
      db,
      clients([{ symbol: "AAPL", price: 190, currency: "USD", asOf: new Date(NOW) }]),
      NOW,
    );
    expect(summary.assets).toBe(0);
    expect(summary.quoted).toBe(0);
  });

  it("rescata por TradingView los watchlisted que Yahoo no devolvió", async () => {
    const id = seedAsset(db, {
      name: "UnitedHealth",
      assetType: "stock",
      symbol: "UNH",
      tradingviewSymbol: "NYSE:UNH",
    });
    const summary = await syncWatchlistQuotes(
      db,
      {
        yahoo: { fetchQuotes: async () => [] }, // Yahoo no devuelve nada
        coingecko: { fetchQuotes: async () => [] },
        tradingview: {
          fetchQuotes: async (symbols) =>
            symbols.map((s) => ({ symbol: s, price: 425.25, currency: "USD", asOf: new Date() })),
        },
      },
      NOW,
    );
    expect(summary.quoted).toBe(1);
    const q = db.select().from(schema.watchlistQuotes).where(eq(schema.watchlistQuotes.assetId, id)).get();
    expect(q?.source).toBe("tradingview");
    expect(q?.price).toBe(425.25);
  });
});
