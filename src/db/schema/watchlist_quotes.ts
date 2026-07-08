import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { assets } from "./assets";
import { idCol, updatedAtCol } from "./_shared";

// Intraday quote cache for watchlisted assets — refreshed every ~15 min by the
// standalone `sync-watchlist` cron. This is a LAST-WRITE-WINS cache (one row per
// asset, upserted), NOT a time series. It deliberately never touches
// `price_history` / `asset_valuations`, whose only source of truth stays the
// daily 23:00 close. The Watchlist page reads `price` for the live quote and
// evaluates alerts against it; the long-range charts keep reading the daily
// history. `price`/`currency` are the asset's native quote units (e.g. USD for a
// US stock, EUR for crypto via CoinGecko) — i.e. the per-share price as quoted.
export const watchlistQuotes = sqliteTable(
  "watchlist_quotes",
  {
    id: idCol(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    price: real("price").notNull(),
    /** Price from the previous refresh (15 min earlier), kept so the card can
     *  show an up/down/flat tick indicator vs the prior intraday quote. Null on
     *  the first quote for an asset (no previous value to compare against). */
    prevPrice: real("prev_price"),
    currency: text("currency").notNull(),
    asOf: integer("as_of", { mode: "number" }).notNull(),
    source: text("source").notNull(), // "yahoo" | "coingecko" | "tradingview"
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    assetIdx: uniqueIndex("watchlist_quotes_asset_idx").on(t.assetId),
  }),
);

export type WatchlistQuote = typeof watchlistQuotes.$inferSelect;
export type NewWatchlistQuote = typeof watchlistQuotes.$inferInsert;
