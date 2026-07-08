import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { DB } from "../db/client";
import {
  alertEvents,
  assets,
  priceAlerts,
  watchlistQuotes,
  type Asset,
  type PriceAlert,
} from "../db/schema";
import { resolveSymbol } from "./price-sync";
import type { Quote } from "./pricing/types";

// Intraday refresh for watchlisted assets. Runs every ~5 min from the
// `sync-watchlist` cron — a separate lane from the daily 23:00 close. It writes
// ONLY to `watchlist_quotes` (a last-write-wins cache) and the alert tables; it
// never touches `price_history` / `asset_valuations`, so the canonical daily
// history and all long-range charts are unaffected.

export type WatchlistClients = {
  // Batched quote fetchers — one call per provider regardless of asset count,
  // which keeps soft-ban risk near zero. Injected so tests can stub them.
  yahoo: { fetchQuotes: (symbols: string[]) => Promise<Quote[]> };
  coingecko: { fetchQuotes: (symbols: string[]) => Promise<Quote[]> };
  /** Fallback dormido para stocks/ETFs que el batch Yahoo no devolvió. */
  tradingview?: { fetchQuotes: (symbols: string[]) => Promise<Quote[]> };
  // Best-effort Telegram sender (the shared `sendTelegram`). Optional so the
  // sync can run without it; alerts still raise the in-app banner.
  sendTelegram?: (text: string) => Promise<{ ok: boolean; error?: string }>;
};

export type WatchlistSyncSummary = {
  assets: number;
  quoted: number;
  triggered: number;
  rearmed: number;
  telegramSent: number;
};

function conditionMet(kind: PriceAlert["kind"], price: number, threshold: number): boolean {
  return kind === "price_below" ? price < threshold : price > threshold;
}

function alertMessage(
  asset: Pick<Asset, "name" | "symbol">,
  alert: Pick<PriceAlert, "kind" | "threshold">,
  price: number,
  currency: string,
): string {
  const label = alert.kind === "price_below" ? "ha bajado de" : "ha subido a";
  const tag = asset.symbol ? ` (${asset.symbol})` : "";
  return `🔔 ${asset.name}${tag} ${label} ${alert.threshold} ${currency} — precio actual ${price} ${currency}`;
}

// Evaluate a single (freshly armed) alert against the last cached intraday price
// and fire it if the condition is already met — used by createAlert/updateAlert
// so a just-configured alert that's already true fires immediately instead of
// waiting for the next 5-min cron tick. DB-only (no network); returns the new
// event + message so the caller can send Telegram. Returns null if there's no
// cached quote yet or the condition isn't met.
export function fireAlertIfMet(
  db: DB,
  ctx: {
    alertId: string;
    assetId: string;
    kind: PriceAlert["kind"];
    threshold: number;
    status: PriceAlert["status"];
    assetName: string;
    assetSymbol: string | null;
  },
  now: number = Date.now(),
): { eventId: string; message: string } | null {
  if (ctx.status !== "armed") return null;
  const quote = db
    .select()
    .from(watchlistQuotes)
    .where(eq(watchlistQuotes.assetId, ctx.assetId))
    .get();
  if (!quote) return null;
  if (!conditionMet(ctx.kind, quote.price, ctx.threshold)) return null;

  const eventId = ulid();
  db.transaction((tx) => {
    tx.update(priceAlerts)
      .set({ status: "triggered", lastTriggeredAt: now, updatedAt: now })
      .where(eq(priceAlerts.id, ctx.alertId))
      .run();
    tx.insert(alertEvents)
      .values({
        id: eventId,
        alertId: ctx.alertId,
        assetId: ctx.assetId,
        kind: ctx.kind,
        threshold: ctx.threshold,
        priceAtTrigger: quote.price,
        currency: quote.currency,
        triggeredAt: now,
        telegramSent: false,
      })
      .run();
  });
  return {
    eventId,
    message: alertMessage(
      { name: ctx.assetName, symbol: ctx.assetSymbol },
      { kind: ctx.kind, threshold: ctx.threshold },
      quote.price,
      quote.currency,
    ),
  };
}

export async function syncWatchlistQuotes(
  db: DB,
  clients: WatchlistClients,
  now: number = Date.now(),
): Promise<WatchlistSyncSummary> {
  const watched = db
    .select()
    .from(assets)
    .where(and(eq(assets.isWatchlisted, true), eq(assets.isActive, true)))
    .all();

  if (watched.length === 0) {
    return { assets: 0, quoted: 0, triggered: 0, rearmed: 0, telegramSent: 0 };
  }

  // Group resolvable symbols by provider for a single batched call each.
  const yahooSymbols: string[] = [];
  const coingeckoSymbols: string[] = [];
  const symbolByAsset = new Map<string, string>();
  for (const asset of watched) {
    const symbol = resolveSymbol(asset);
    if (!symbol) continue;
    symbolByAsset.set(asset.id, symbol);
    if (asset.assetType === "crypto") coingeckoSymbols.push(symbol);
    else yahooSymbols.push(symbol);
  }

  const [yahooQuotes, coingeckoQuotes] = await Promise.all([
    yahooSymbols.length ? clients.yahoo.fetchQuotes(yahooSymbols) : Promise.resolve([]),
    coingeckoSymbols.length
      ? clients.coingecko.fetchQuotes(coingeckoSymbols)
      : Promise.resolve([]),
  ]);

  // Index quotes case-insensitively (Yahoo echoes uppercased, CoinGecko ids are
  // lower-cased) so we can match back to each asset's resolved symbol.
  const quoteBySymbol = new Map<string, { quote: Quote; source: string }>();
  for (const q of yahooQuotes) quoteBySymbol.set(q.symbol.toUpperCase(), { quote: q, source: "yahoo" });
  for (const q of coingeckoQuotes)
    quoteBySymbol.set(q.symbol.toUpperCase(), { quote: q, source: "coingecko" });

  // Fallback dormido: los no-cripto que Yahoo no devolvió y tienen símbolo TV
  // se piden en UN batch al scanner y se reinyectan bajo su símbolo Yahoo, así
  // el bucle de upsert no cambia.
  const tvMisses = watched.filter((a) => {
    if (a.assetType === "crypto" || !a.tradingviewSymbol?.trim()) return false;
    const symbol = symbolByAsset.get(a.id);
    return !!symbol && !quoteBySymbol.has(symbol.toUpperCase());
  });
  if (tvMisses.length > 0 && clients.tradingview) {
    let tvQuotes: Quote[] = [];
    try {
      tvQuotes = await clients.tradingview.fetchQuotes(
        tvMisses.map((a) => a.tradingviewSymbol!.trim()),
      );
    } catch {
      // TV caído: la watchlist simplemente no refresca esos activos este tick.
    }
    const byTv = new Map(tvQuotes.map((q) => [q.symbol.toUpperCase(), q]));
    for (const a of tvMisses) {
      const quote = byTv.get(a.tradingviewSymbol!.trim().toUpperCase());
      const symbol = symbolByAsset.get(a.id);
      if (quote && symbol) {
        quoteBySymbol.set(symbol.toUpperCase(), { quote, source: "tradingview" });
      }
    }
  }

  const assetIds = watched.map((a) => a.id);
  const alerts = db
    .select()
    .from(priceAlerts)
    .where(and(inArray(priceAlerts.assetId, assetIds), eq(priceAlerts.isActive, true)))
    .all();
  const alertsByAsset = new Map<string, PriceAlert[]>();
  for (const al of alerts) {
    const list = alertsByAsset.get(al.assetId) ?? [];
    list.push(al);
    alertsByAsset.set(al.assetId, list);
  }

  // Telegram sends happen outside the (synchronous) transaction. Collect what
  // fired and notify afterwards, then flag the events as sent.
  const pendingTelegram: { eventId: string; message: string }[] = [];

  const result = db.transaction((tx) => {
    let quoted = 0;
    let triggered = 0;
    let rearmed = 0;

    for (const asset of watched) {
      const symbol = symbolByAsset.get(asset.id);
      if (!symbol) continue;
      const hit = quoteBySymbol.get(symbol.toUpperCase());
      if (!hit) continue;
      const { quote, source } = hit;
      quoted++;

      // Upsert the intraday quote cache (one row per asset).
      tx
        .insert(watchlistQuotes)
        .values({
          id: ulid(),
          assetId: asset.id,
          price: quote.price,
          currency: quote.currency,
          asOf: quote.asOf.getTime(),
          source,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: watchlistQuotes.assetId,
          set: {
            // Keep the outgoing price as prevPrice for the card's tick indicator.
            prevPrice: sql`${watchlistQuotes.price}`,
            price: quote.price,
            currency: quote.currency,
            asOf: quote.asOf.getTime(),
            source,
            updatedAt: now,
          },
        })
        .run();

      // Evaluate this asset's alerts against the fresh price.
      for (const alert of alertsByAsset.get(asset.id) ?? []) {
        const met = conditionMet(alert.kind, quote.price, alert.threshold);
        if (alert.status === "armed" && met) {
          tx
            .update(priceAlerts)
            .set({ status: "triggered", lastTriggeredAt: now, updatedAt: now })
            .where(eq(priceAlerts.id, alert.id))
            .run();
          const eventId = ulid();
          tx
            .insert(alertEvents)
            .values({
              id: eventId,
              alertId: alert.id,
              assetId: asset.id,
              kind: alert.kind,
              threshold: alert.threshold,
              priceAtTrigger: quote.price,
              currency: quote.currency,
              triggeredAt: now,
              telegramSent: false,
            })
            .run();
          triggered++;
          if (alert.notifyTelegram) {
            pendingTelegram.push({
              eventId,
              message: alertMessage(asset, alert, quote.price, quote.currency),
            });
          }
        } else if (alert.status === "triggered" && !met) {
          // Hysteresis: the price crossed back to the safe side; re-arm so it
          // can fire again next time without re-firing every run in between.
          tx
            .update(priceAlerts)
            .set({ status: "armed", updatedAt: now })
            .where(eq(priceAlerts.id, alert.id))
            .run();
          rearmed++;
        }
      }
    }

    return { quoted, triggered, rearmed };
  });

  let telegramSent = 0;
  if (clients.sendTelegram && pendingTelegram.length > 0) {
    for (const { eventId, message } of pendingTelegram) {
      const res = await clients.sendTelegram(message);
      if (res.ok) {
        telegramSent++;
        db.update(alertEvents).set({ telegramSent: true }).where(eq(alertEvents.id, eventId)).run();
      }
    }
  }

  return {
    assets: watched.length,
    quoted: result.quoted,
    triggered: result.triggered,
    rearmed: result.rearmed,
    telegramSent,
  };
}
