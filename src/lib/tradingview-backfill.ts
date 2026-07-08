// Resolución de listing TradingView por activo: symbol-search (por ISIN, si no
// por ticker) → ordenar candidatos (divisa del activo primero, EUR después) →
// validar contra el scanner en UN batch y quedarse con el primero que cotiza.
// La validación es necesaria: symbol-search lista venues (p. ej. GETTEX) que el
// scanner global no sirve. Puro + deps inyectadas para testear sin red.

import type { Asset } from "../db/schema";
import type { Quote } from "./pricing";
import type { TvSearchHit } from "./pricing/tradingview";

export type TvResolveDeps = {
  searchSymbols: (query: string) => Promise<TvSearchHit[]>;
  fetchQuotes: (symbols: string[]) => Promise<Quote[]>;
};

export type TvResolution = { tradingviewSymbol: string | null; logoUrl: string | null };

export function tvLogoUrl(logoid: string): string {
  return `https://s3-symbol-logo.tradingview.com/${logoid}.svg`;
}

// Tipos de instrumento que nos valen (equities, ADRs, ETFs/ETPs). Deja fuera
// spot cripto, bonos e índices que symbol-search también devuelve.
const USABLE_TYPES = new Set(["stock", "dr", "fund", "structured", "etf"]);

const MAX_PROBE = 5;

export async function resolveTvListing(
  asset: Pick<Asset, "isin" | "providerSymbol" | "symbol" | "ticker" | "currency">,
  deps: TvResolveDeps,
): Promise<TvResolution> {
  const query =
    asset.isin?.trim() || asset.providerSymbol?.trim() || asset.symbol?.trim() || asset.ticker?.trim();
  if (!query) return { tradingviewSymbol: null, logoUrl: null };

  let found: TvSearchHit[] = [];
  try {
    found = await deps.searchSymbols(query);
  } catch {
    // symbol-search caído/rate-limited: nulls en vez de propagar; otra pasada
    // del backfill (idempotente) lo reintenta sin abortar el resto del batch.
    return { tradingviewSymbol: null, logoUrl: null };
  }
  const hits = found.filter((h) => USABLE_TYPES.has(h.type));
  if (hits.length === 0) return { tradingviewSymbol: null, logoUrl: null };

  // El logoid es el mismo en todos los listings del instrumento; vale cualquiera.
  const logoid = hits.find((h) => h.logoid)?.logoid ?? null;

  const ccy = (asset.currency ?? "EUR").toUpperCase();
  const rank = (h: TvSearchHit): number =>
    h.currency?.toUpperCase() === ccy ? 0 : h.currency?.toUpperCase() === "EUR" ? 1 : 2;
  const ordered = [...hits].sort((a, b) => rank(a) - rank(b));
  const candidates = ordered.slice(0, MAX_PROBE).map((h) => `${h.exchange}:${h.symbol}`);

  let quoted: Quote[] = [];
  try {
    quoted = await deps.fetchQuotes(candidates);
  } catch {
    // Scanner caído: persistimos el logo igualmente; el símbolo puede
    // regenerarse en otra pasada.
  }
  const alive = new Set(quoted.map((q) => q.symbol.toUpperCase()));
  const chosen = candidates.find((c) => alive.has(c.toUpperCase())) ?? null;

  return { tradingviewSymbol: chosen, logoUrl: logoid ? tvLogoUrl(logoid) : null };
}
