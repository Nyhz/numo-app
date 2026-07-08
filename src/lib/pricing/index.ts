import type { Asset } from "../../db/schema";
import * as yahoo from "./yahoo";
import * as coingecko from "./coingecko";
import * as ft from "./ft";
import * as justetf from "./justetf";
import * as tradingview from "./tradingview";
import type { HistoricalBar, Quote } from "./types";

export type {
  CoinCandidate,
  CountryWeight,
  HistoricalBar,
  Quote,
  SectorWeight,
} from "./types";

export type PricingProviderName = "yahoo" | "coingecko" | "ft" | "tradingview";

export type PricingProvider = {
  name: PricingProviderName;
  fetchQuote: (symbol: string) => Promise<Quote>;
  /** Batched quote — one provider request for many symbols. Skips symbols the
   *  provider can't price rather than failing the whole batch. */
  fetchQuotes: (symbols: string[]) => Promise<Quote[]>;
  fetchHistory: (symbol: string, from: Date, to: Date) => Promise<HistoricalBar[]>;
};

export const yahooProvider: PricingProvider = {
  name: "yahoo",
  fetchQuote: yahoo.fetchQuote,
  fetchQuotes: yahoo.fetchQuotes,
  fetchHistory: yahoo.fetchHistory,
};

export const coingeckoProvider: PricingProvider = {
  name: "coingecko",
  fetchQuote: coingecko.fetchQuote,
  fetchQuotes: coingecko.fetchQuotes,
  fetchHistory: coingecko.fetchHistory,
};

export const ftProvider: PricingProvider = {
  name: "ft",
  fetchQuote: ft.fetchQuote,
  fetchQuotes: ft.fetchQuotes,
  fetchHistory: ft.fetchHistory,
};

export const tradingviewProvider: PricingProvider = {
  name: "tradingview",
  fetchQuote: tradingview.fetchQuote,
  fetchQuotes: tradingview.fetchQuotes,
  fetchHistory: tradingview.fetchHistory,
};

export function providerForAsset(
  asset: Pick<Asset, "assetType" | "priceSource">,
): PricingProvider {
  // Explicit per-asset override wins (e.g. money-market funds → FT).
  if (asset.priceSource === "ft") return ftProvider;
  if (asset.priceSource === "coingecko") return coingeckoProvider;
  if (asset.priceSource === "yahoo") return yahooProvider;
  if (asset.priceSource === "tradingview") return tradingviewProvider;
  if (asset.assetType === "crypto") return coingeckoProvider;
  return yahooProvider;
}

// Backwards-compatible re-exports for call sites that were pointing at the old
// single-file `src/lib/pricing.ts`. New code should prefer `providerForAsset`.
export const fetchQuote = yahoo.fetchQuote;
export const fetchHistory = yahoo.fetchHistory;
export const fetchSectorWeightings = yahoo.fetchSectorWeightings;
export const fetchAssetSector = yahoo.fetchAssetSector;
export const fetchCountryWeightings = justetf.fetchCountryWeightings;

export { searchCoins } from "./coingecko";
