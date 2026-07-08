import { and, desc, eq, lte } from "drizzle-orm";
import { ulid } from "ulid";
import type { DB } from "../db/client";
import {
  assetPositions,
  assetValuations,
  assets,
  fxRates,
  priceHistory,
  type Asset,
} from "../db/schema";
import { resolveFxRate, type FxLookup } from "./fx";
import { round, roundEur } from "./money";
import { toIsoDate } from "./time";
import type { PricingProviderName, Quote } from "./pricing";

export type PriceClient = {
  fetchQuote: (symbol: string) => Promise<Quote>;
};

export type PriceClients = {
  yahoo: PriceClient;
  coingecko: PriceClient;
  ft: PriceClient;
};

// The daily sync doesn't call TradingView yet (that's the fallback wired in a
// later task) — narrow the provider union here so `clients[provider]` stays
// exhaustive against `PriceClients` without a runtime branch that never runs.
type SyncProvider = Exclude<PricingProviderName, "tradingview">;

export type SyncError = {
  assetId?: string;
  symbol?: string;
  currency?: string;
  message: string;
};

export type SyncSummary = {
  date: string;
  fetched: number;
  skipped: number;
  fxFetched: number;
  fxSkipped: number;
  valuationsUpserted: number;
  errors: SyncError[];
};

function providerFor(
  asset: Pick<Asset, "assetType" | "priceSource">,
): SyncProvider {
  // An explicit per-asset override wins over the type-based default — this is
  // how a money-market fund Yahoo can't price gets routed to FT.
  if (
    asset.priceSource === "ft" ||
    asset.priceSource === "yahoo" ||
    asset.priceSource === "coingecko"
  ) {
    return asset.priceSource;
  }
  return asset.assetType === "crypto" ? "coingecko" : "yahoo";
}

export function resolveSymbol(
  asset: {
    providerSymbol: string | null;
    symbol: string | null;
    ticker: string | null;
    isin?: string | null;
    currency?: string | null;
  },
  provider?: PricingProviderName,
): string | null {
  // FT is keyed by its public `ISIN:CURRENCY` symbol (e.g. FR0000989626:EUR).
  if (provider === "ft") {
    const isin = asset.isin?.trim();
    if (!isin) return null;
    return `${isin}:${(asset.currency ?? "EUR").trim().toUpperCase()}`;
  }
  return (
    (asset.providerSymbol && asset.providerSymbol.trim()) ||
    (asset.symbol && asset.symbol.trim()) ||
    (asset.ticker && asset.ticker.trim()) ||
    null
  );
}

/**
 * The `price_history.symbol` an asset's prices live under — the single source
 * of truth shared by every writer (daily sync, backfill, manual price) and
 * reader (valuation rebuild). Routes by the asset's effective provider so FT
 * funds resolve to `ISIN:CURRENCY` while everything else keeps its ticker.
 */
export function priceSymbolForAsset(
  asset: Pick<
    Asset,
    "assetType" | "priceSource" | "providerSymbol" | "symbol" | "ticker" | "isin" | "currency"
  >,
): string | null {
  return resolveSymbol(asset, providerFor(asset));
}


export async function syncPrices(
  db: DB,
  clients: PriceClients,
  today: string = toIsoDate(new Date()),
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    date: today,
    fetched: 0,
    skipped: 0,
    fxFetched: 0,
    fxSkipped: 0,
    valuationsUpserted: 0,
    errors: [],
  };

  const activeAssets = await db
    .select()
    .from(assets)
    .where(eq(assets.isActive, true))
    .all();

  // Quote currency per asset, populated as we fetch. Authoritative source of
  // truth for FX conversion — the asset row's `currency` reflects trade
  // currency (as imported), which may differ from the Yahoo quote currency
  // for ADRs, dual-listed funds, etc. For crypto assets the CoinGecko path
  // always returns EUR.
  const quoteCurrencyByAsset = new Map<string, string>();
  const providerByAsset = new Map<string, SyncProvider>();

  // 1. Asset prices
  for (const asset of activeAssets) {
    const provider = providerFor(asset);
    providerByAsset.set(asset.id, provider);
    const symbol = resolveSymbol(asset, provider);
    if (!symbol) {
      summary.errors.push({
        assetId: asset.id,
        message:
          provider === "coingecko"
            ? "crypto asset missing providerSymbol (CoinGecko coin id)"
            : provider === "ft"
              ? "FT asset missing ISIN"
              : "no provider symbol / symbol / ticker set",
      });
      continue;
    }
    const existing = await db
      .select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.symbol, symbol),
          eq(priceHistory.pricedDateUtc, today),
          eq(priceHistory.source, provider),
        ),
      )
      .get();
    if (existing) {
      quoteCurrencyByAsset.set(
        asset.id,
        (provider === "coingecko" ? "EUR" : asset.currency ?? "EUR").toUpperCase(),
      );
      summary.skipped++;
      continue;
    }
    try {
      const quote = await clients[provider].fetchQuote(symbol);
      quoteCurrencyByAsset.set(asset.id, quote.currency.toUpperCase());
      // Skip the insert when the quote timestamp matches an existing bar —
      // Yahoo returns Friday's `regularMarketTime` on weekends/holidays, so
      // we'd otherwise clutter price_history with duplicate rows.
      const duplicate = await db
        .select({ id: priceHistory.id })
        .from(priceHistory)
        .where(
          and(
            eq(priceHistory.symbol, symbol),
            eq(priceHistory.source, provider),
            eq(priceHistory.pricedAt, quote.asOf.getTime()),
          ),
        )
        .get();
      if (duplicate) {
        summary.skipped++;
      } else {
        await db
          .insert(priceHistory)
          .values({
            id: ulid(),
            symbol,
            price: quote.price,
            pricedAt: quote.asOf.getTime(),
            pricedDateUtc: today,
            source: provider,
            createdAt: Date.now(),
          })
          .run();
        summary.fetched++;
      }
    } catch (err) {
      summary.errors.push({
        assetId: asset.id,
        symbol,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. FX rates — one row per non-EUR quote currency seen from the Yahoo path.
  // CoinGecko quotes are always EUR so they contribute nothing here.
  const currencySet = new Set<string>();
  for (const ccy of quoteCurrencyByAsset.values()) {
    if (ccy && ccy !== "EUR") currencySet.add(ccy);
  }
  for (const ccy of currencySet) {
    const existing = await db
      .select()
      .from(fxRates)
      .where(and(eq(fxRates.currency, ccy), eq(fxRates.date, today)))
      .get();
    if (existing) {
      summary.fxSkipped++;
      continue;
    }
    const pair = `EUR${ccy}=X`;
    try {
      const quote = await clients.yahoo.fetchQuote(pair);
      if (!quote.price || quote.price <= 0) {
        throw new Error(`invalid FX quote for ${pair}: ${quote.price}`);
      }
      const rateToEur = 1 / quote.price;
      await db
        .insert(fxRates)
        .values({
          id: ulid(),
          currency: ccy,
          date: today,
          rateToEur,
          source: "yahoo",
          createdAt: Date.now(),
        })
        .run();
      summary.fxFetched++;
    } catch (err) {
      summary.errors.push({
        currency: ccy,
        symbol: pair,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Recompute valuations for each asset that now has a price row today.
  const fxLookup: FxLookup = {
    findOnDate: async (currency, iso) =>
      (await db
        .select()
        .from(fxRates)
        .where(and(eq(fxRates.currency, currency), eq(fxRates.date, iso)))
        .get()) ?? null,
    // Audit P6: ORDER BY + LIMIT instead of loading the whole currency's
    // history and sorting in JS on every asset.
    findLatest: async (currency, onOrBefore) =>
      (await db
        .select()
        .from(fxRates)
        .where(
          onOrBefore
            ? and(eq(fxRates.currency, currency), lte(fxRates.date, onOrBefore))
            : eq(fxRates.currency, currency),
        )
        .orderBy(desc(fxRates.date))
        .limit(1)
        .get()) ?? null,
  };

  for (const asset of activeAssets) {
    const provider = providerByAsset.get(asset.id) ?? providerFor(asset);
    const symbol = resolveSymbol(asset, provider);
    if (!symbol) continue;
    const priceRow = await db
      .select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.symbol, symbol),
          eq(priceHistory.pricedDateUtc, today),
          eq(priceHistory.source, provider),
        ),
      )
      .get();
    if (!priceRow) continue;

    try {
      const quoteCurrency =
        quoteCurrencyByAsset.get(asset.id) ??
        (provider === "coingecko" ? "EUR" : asset.currency);
      const fx = await resolveFxRate(quoteCurrency, today, fxLookup);
      const unitPriceEur = round(priceRow.price * fx.rate, 6);
      const positionRow = await db
        .select()
        .from(assetPositions)
        .where(eq(assetPositions.assetId, asset.id))
        .get();
      const quantity = positionRow?.quantity ?? 0;
      const marketValueEur = roundEur(quantity * unitPriceEur);

      const existing = await db
        .select()
        .from(assetValuations)
        .where(
          and(
            eq(assetValuations.assetId, asset.id),
            eq(assetValuations.valuationDate, today),
          ),
        )
        .get();

      // Posición cerrada/inexistente: no mantener valoración. El motor de
      // rebuild nunca escribe filas con qty<=0, así que el cron tampoco debe —
      // evita filas fantasma qty=0 que divergen de la fuente única. Limpia
      // cualquier fila previa de hoy.
      if (quantity <= 0) {
        if (existing) {
          await db
            .delete(assetValuations)
            .where(eq(assetValuations.id, existing.id))
            .run();
        }
        continue;
      }

      if (existing) {
        await db
          .update(assetValuations)
          .set({
            quantity,
            unitPriceEur,
            marketValueEur,
            priceSource: priceRow.source,
          })
          .where(eq(assetValuations.id, existing.id))
          .run();
      } else {
        await db
          .insert(assetValuations)
          .values({
            id: ulid(),
            assetId: asset.id,
            valuationDate: today,
            quantity,
            unitPriceEur,
            marketValueEur,
            priceSource: priceRow.source,
            createdAt: Date.now(),
          })
          .run();
      }
      summary.valuationsUpserted++;
    } catch (err) {
      summary.errors.push({
        assetId: asset.id,
        symbol,
        currency: asset.currency,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
