// TradingView client — batch snapshot quotes via the public scanner endpoint
// plus symbol-search (used by the backfill script to resolve `EXCHANGE:TICKER`
// listings and logo ids). Fallback lane only: the daily sync and the watchlist
// call this ONLY after Yahoo failed for an equity/ETF, so a healthy day makes
// zero requests here. No history endpoint exists — backfills stay on Yahoo/FT.
//
// Same isolation discipline as the other pricing clients: no action/component
// calls TradingView directly, and tests stub `fetch` — no real network.

import { withTimeout } from "./_net";
import type { HistoricalBar, Quote } from "./types";

const SCAN_URL = "https://scanner.tradingview.com/global/scan";
const SEARCH_URL = "https://symbol-search.tradingview.com/symbol_search/v3/";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type ScanRow = { s?: string; d?: [number | null, string | null] };

/** Batched snapshot: one scanner request for many `EXCHANGE:TICKER` symbols
 *  across markets. Symbols the scanner doesn't serve are simply absent from
 *  the response — the batch never fails because of one dead listing. */
export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const unique = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const run = fetch(SCAN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": BROWSER_UA },
    body: JSON.stringify({ symbols: { tickers: unique }, columns: ["close", "currency"] }),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`tradingview scan HTTP ${res.status}`);
    return (await res.json()) as { data?: ScanRow[] };
  });
  const raw = await withTimeout(run, undefined, `tradingview scan ${unique.length}`);
  // The scanner returns last-trade snapshots without a timestamp column we
  // trust across markets; the fetch moment is the honest asOf for a fallback.
  const asOf = new Date();
  const out: Quote[] = [];
  for (const row of raw.data ?? []) {
    const close = row.d?.[0];
    const currency = row.d?.[1];
    if (!row.s || close == null || !Number.isFinite(close) || close <= 0) continue;
    if (!currency || !/^[A-Za-z]{3}$/.test(currency)) continue;
    out.push({ symbol: row.s, price: close, currency: currency.toUpperCase(), asOf });
  }
  return out;
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  const wanted = symbol.trim().toUpperCase();
  const hit = (await fetchQuotes([symbol])).find((q) => q.symbol.toUpperCase() === wanted);
  if (!hit) throw new Error(`tradingview: no quote for ${symbol}`);
  return hit;
}

/** TV expone snapshot, no series. Mantiene la firma de PricingProvider. */
export async function fetchHistory(
  symbol: string,
  _from: Date,
  _to: Date,
): Promise<HistoricalBar[]> {
  throw new Error(`tradingview: history unsupported (${symbol})`);
}

export type TvSearchHit = {
  symbol: string;
  exchange: string;
  currency: string | null;
  type: string;
  logoid: string | null;
};

type SearchRow = {
  symbol?: string;
  exchange?: string;
  currency_code?: string;
  type?: string;
  logoid?: string;
};

/** Symbol search por ISIN o ticker. Devuelve candidatos crudos en el orden de
 *  TV; el llamador (backfill) reordena y valida contra el scanner. */
export async function searchSymbols(query: string): Promise<TvSearchHit[]> {
  const url = `${SEARCH_URL}?text=${encodeURIComponent(query)}&hl=0&lang=en&search_type=undefined&domain=production`;
  const run = fetch(url, {
    headers: {
      "user-agent": BROWSER_UA,
      origin: "https://www.tradingview.com",
      referer: "https://www.tradingview.com/",
    },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`tradingview search HTTP ${res.status}`);
    return (await res.json()) as { symbols?: SearchRow[] };
  });
  const raw = await withTimeout(run, undefined, `tradingview search ${query}`);
  return (raw.symbols ?? [])
    .filter((r): r is SearchRow & { symbol: string; exchange: string } => !!r.symbol && !!r.exchange)
    .map((r) => ({
      symbol: r.symbol.replace(/<\/?em>/g, ""),
      exchange: r.exchange,
      currency: r.currency_code ?? null,
      type: r.type ?? "",
      logoid: r.logoid ?? null,
    }));
}
