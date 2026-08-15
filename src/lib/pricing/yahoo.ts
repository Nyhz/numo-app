import YahooFinance from "yahoo-finance2";
import { toIsoDate } from "../fx";
import { normalizeSectorKey } from "../sectors";
import { withTimeout } from "./_net";
import type { HistoricalBar, Quote, SectorWeight } from "./types";

const yahooFinance = new YahooFinance();

export async function fetchQuote(symbol: string): Promise<Quote> {
  const raw = (await withTimeout(
    yahooFinance.quote(symbol),
    undefined,
    `yahoo quote ${symbol}`,
  )) as {
    regularMarketPrice?: number;
    currency?: string;
    regularMarketTime?: Date | number;
  };
  const price = raw.regularMarketPrice;
  if (price == null || !Number.isFinite(price)) {
    throw new Error(`fetchQuote: no regularMarketPrice for ${symbol}`);
  }
  // Audit R2: never guess the quote currency. A silent "USD" default would
  // convert with the wrong FX and corrupt valuations.
  if (!raw.currency || !/^[A-Za-z]{3}$/.test(raw.currency)) {
    throw new Error(
      `fetchQuote: Yahoo returned no usable currency for ${symbol} (got ${JSON.stringify(raw.currency)})`,
    );
  }
  const currency = raw.currency.toUpperCase();
  const asOfRaw = raw.regularMarketTime;
  const asOf =
    asOfRaw instanceof Date
      ? asOfRaw
      : typeof asOfRaw === "number"
        ? new Date(asOfRaw * 1000)
        : new Date();
  return { symbol, price, currency, asOf };
}

/**
 * Batched quote: one Yahoo request for many symbols (used by the watchlist
 * intraday refresh so N assets cost a single call, not N). Skips any row Yahoo
 * returns without a usable price/currency rather than failing the whole batch —
 * a single dead symbol shouldn't blank the watchlist. Returned `symbol` mirrors
 * Yahoo's echo; callers match case-insensitively.
 */
export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const unique = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const raw = (await withTimeout(
    yahooFinance.quote(unique),
    undefined,
    `yahoo quotes ${unique.length}`,
  )) as Array<{
    symbol?: string;
    regularMarketPrice?: number;
    currency?: string;
    regularMarketTime?: Date | number;
  }>;
  const out: Quote[] = [];
  for (const row of Array.isArray(raw) ? raw : [raw]) {
    const price = row.regularMarketPrice;
    if (price == null || !Number.isFinite(price)) continue;
    if (!row.currency || !/^[A-Za-z]{3}$/.test(row.currency)) continue;
    const asOfRaw = row.regularMarketTime;
    const asOf =
      asOfRaw instanceof Date
        ? asOfRaw
        : typeof asOfRaw === "number"
          ? new Date(asOfRaw * 1000)
          : new Date();
    out.push({
      symbol: row.symbol ?? "",
      price,
      currency: row.currency.toUpperCase(),
      asOf,
    });
  }
  return out;
}

export async function fetchSectorWeightings(
  symbol: string,
): Promise<SectorWeight[]> {
  const raw = (await withTimeout(
    yahooFinance.quoteSummary(symbol, { modules: ["topHoldings"] }),
    undefined,
    `yahoo topHoldings ${symbol}`,
  )) as {
    topHoldings?: { sectorWeightings?: Array<Record<string, unknown>> };
  };
  // Yahoo returns one single-key object per sector, e.g. [{ technology: 0.29 }].
  // Flatten to a tidy list, dropping the `maxAge` bookkeeping key and any
  // non-finite values. Bond/cash funds legitimately return an empty list.
  const rows = raw.topHoldings?.sectorWeightings ?? [];
  const out: SectorWeight[] = [];
  for (const row of rows) {
    for (const [sector, value] of Object.entries(row)) {
      if (sector === "maxAge") continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        continue;
      }
      out.push({ sector, weight: value });
    }
  }
  return out;
}

export async function fetchAssetSector(
  symbol: string,
): Promise<string | null> {
  const raw = (await withTimeout(
    yahooFinance.quoteSummary(symbol, { modules: ["assetProfile"] }),
    undefined,
    `yahoo assetProfile ${symbol}`,
  )) as { assetProfile?: { sectorKey?: string; sector?: string } };
  const key = raw.assetProfile?.sectorKey ?? raw.assetProfile?.sector;
  return key ? normalizeSectorKey(key) : null;
}

export async function fetchHistory(
  symbol: string,
  from: Date,
  to: Date,
): Promise<HistoricalBar[]> {
  // NOTE: we call chart() and not historical(). Yahoo retired the endpoint
  // historical() wrapped, so it is now a shim over chart() that THROWS when a
  // bar has some-but-not-all null fields — and Xetra publishes exactly that
  // (open/high/low/volume, close: null) for the running session, which killed
  // the whole benchmark backfill with a single bad row. chart() hands us the
  // raw bars so we drop the incomplete ones ourselves.
  const res = (await withTimeout(
    yahooFinance.chart(symbol, {
      period1: from,
      period2: to,
      interval: "1d",
    }),
    undefined,
    `yahoo chart ${symbol}`,
  )) as {
    meta?: { currency?: string };
    quotes?: Array<{ date: Date; close: number | null }>;
  };
  // chart() reports the series currency in meta (historical() never did). It
  // is informational here — every consumer prices with the asset's own
  // currency — so an unusable value degrades to "" instead of throwing and
  // taking a whole backfill with it.
  const raw = res.meta?.currency;
  const currency = raw && /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : "";
  return (res.quotes ?? [])
    .filter(
      (r): r is { date: Date; close: number } =>
        r.close != null && Number.isFinite(r.close),
    )
    .map((r) => ({
      date: toIsoDate(r.date),
      close: r.close,
      currency,
    }));
}
