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

// ---------------------------------------------------------------------------
// Splits / contra-splits (canje N nuevas por M antiguas)
// ---------------------------------------------------------------------------

/** Escala una cantidad por el factor de un split N:M. División al final para
 *  que los casos enteros salgan exactos (2250 × 1 / 25 = 90, sin polvo
 *  flotante de 0.04). Todo cursor de cantidad por tipo de transacción debe
 *  pasar por aquí — es la única matemática de split del sistema. */
export function applySplitFactor(
  qty: number,
  numerator: number,
  denominator: number,
): number {
  return (qty * numerator) / denominator;
}

/** Factor válido de una fila split; null si la fila está corrupta (un factor
 *  ausente o ≤ 0 debe tratarse como no-op, nunca como ×0). */
export function splitFactorOf(row: {
  splitNumerator: number | null;
  splitDenominator: number | null;
}): { numerator: number; denominator: number } | null {
  const { splitNumerator, splitDenominator } = row;
  if (!splitNumerator || !splitDenominator) return null;
  if (splitNumerator <= 0 || splitDenominator <= 0) return null;
  return { numerator: splitNumerator, denominator: splitDenominator };
}

/** Etiqueta canónica: «split 4:1» (multiplica) o «contra-split 1:25» (agrupa). */
export function splitLabel(numerator: number, denominator: number): string {
  return numerator >= denominator
    ? `split ${numerator}:${denominator}`
    : `contra-split ${numerator}:${denominator}`;
}
