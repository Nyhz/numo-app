// Domain constants and result types shared by every layer (actions, server
// reads, client components). Client-safe: no server-only imports.

export const ACTOR = "commander";

export type ActionError = {
  code: "validation" | "db" | "not_found" | "conflict" | "duplicate" | "fx_deviation";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export const ASSET_TYPES = [
  "etf",
  "stock",
  "bond",
  "crypto",
  "fund",
  "cash-equivalent",
  "other",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

// Market-data provider the daily price sync uses for an asset. `null` on the
// asset row means "pick by type" (crypto → CoinGecko, else Yahoo); an explicit
// value overrides that. FT prices European mutual funds (NAV + history) by ISIN.
export const PRICE_SOURCES = ["yahoo", "coingecko", "ft", "tradingview"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  yahoo: "Yahoo Finance",
  coingecko: "CoinGecko",
  ft: "Financial Times (fondos, por ISIN)",
  tradingview: "TradingView (respaldo, acciones/ETFs)",
};

export const ACCOUNT_TYPES = [
  "broker",
  "crypto",
  "investment",
  "savings",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

// Only savings tracks a cash balance. Broker / crypto / investment are pure
// position containers — buys don't debit cash, sells don't credit it.
export const CASH_BEARING_ACCOUNT_TYPES = ["savings"] as const;

export function isCashBearingAccount(type: string): boolean {
  return (CASH_BEARING_ACCOUNT_TYPES as readonly string[]).includes(type);
}
