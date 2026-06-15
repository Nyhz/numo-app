import type { Asset } from "../../db/schema";
import * as yahoo from "./yahoo";
import * as coingecko from "./coingecko";
import * as justetf from "./justetf";
import type { HistoricalBar, Quote } from "./types";

export type {
  CoinCandidate,
  CountryWeight,
  HistoricalBar,
  Quote,
  SectorWeight,
} from "./types";

export type PricingProviderName = "yahoo" | "coingecko";

export type PricingProvider = {
  name: PricingProviderName;
  fetchQuote: (symbol: string) => Promise<Quote>;
  fetchHistory: (symbol: string, from: Date, to: Date) => Promise<HistoricalBar[]>;
};

export const yahooProvider: PricingProvider = {
  name: "yahoo",
  fetchQuote: yahoo.fetchQuote,
  fetchHistory: yahoo.fetchHistory,
};

export const coingeckoProvider: PricingProvider = {
  name: "coingecko",
  fetchQuote: coingecko.fetchQuote,
  fetchHistory: coingecko.fetchHistory,
};

export function providerForAsset(
  asset: Pick<Asset, "assetType">,
): PricingProvider {
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
