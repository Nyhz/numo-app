import { and, asc, desc, eq, inArray, max, or } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  assetPositions,
  assets,
  priceHistory,
  type Asset,
  type AssetPosition,
} from "../db/schema";
import { priceSymbolForAsset } from "../lib/price-sync";

export type PriceFreshness = {
  pricedAt: number;
  /** Real `price_history.source` (e.g. "yahoo", "coingecko", "yahoo-backfill") or "manual" when an override is set; "stale" when the last fetched price is older than STALE_MS. */
  source: string;
} | null;

export type AssetListRow = Asset & {
  freshness: PriceFreshness;
};

const STALE_MS = 1000 * 60 * 60 * 24 * 3; // 3 days

export async function listAssetsWithFreshness(
  db: DB = defaultDb,
): Promise<AssetListRow[]> {
  const rows = await db.select().from(assets).orderBy(asc(assets.name)).all();
  const positions = await db.select().from(assetPositions).all();
  const posByAsset = new Map(positions.map((p) => [p.assetId, p]));
  const now = Date.now();

  // Latest price per symbol in two queries (audit P2) instead of one per asset.
  const symbols = [
    ...new Set(
      rows
        .map((a) => priceSymbolForAsset(a))
        .filter((sym): sym is string => !!sym),
    ),
  ];
  const latestBySymbol = new Map<string, { pricedAt: number; source: string }>();
  if (symbols.length > 0) {
    const latest = await db
      .select({ symbol: priceHistory.symbol, latestAt: max(priceHistory.pricedAt) })
      .from(priceHistory)
      .where(inArray(priceHistory.symbol, symbols))
      .groupBy(priceHistory.symbol)
      .all();
    const pairs = latest.filter(
      (r): r is { symbol: string; latestAt: number } => r.latestAt != null,
    );
    if (pairs.length > 0) {
      const lastRows = await db
        .select({
          symbol: priceHistory.symbol,
          pricedAt: priceHistory.pricedAt,
          source: priceHistory.source,
        })
        .from(priceHistory)
        .where(
          or(
            ...pairs.map((pair) =>
              and(
                eq(priceHistory.symbol, pair.symbol),
                eq(priceHistory.pricedAt, pair.latestAt),
              ),
            ),
          ),
        )
        .all();
      for (const r of lastRows) {
        if (!latestBySymbol.has(r.symbol)) {
          latestBySymbol.set(r.symbol, { pricedAt: r.pricedAt, source: r.source });
        }
      }
    }
  }

  return rows.map((asset) => {
    const pos = posByAsset.get(asset.id);
    let freshness: PriceFreshness = null;
    if (pos?.manualPrice != null && pos.manualPriceAsOf != null) {
      freshness = { pricedAt: pos.manualPriceAsOf, source: "manual" };
    } else {
      const symbol = priceSymbolForAsset(asset);
      const last = symbol ? latestBySymbol.get(symbol) : undefined;
      if (last) {
        const source = now - last.pricedAt > STALE_MS ? "stale" : last.source;
        freshness = { pricedAt: last.pricedAt, source };
      }
    }
    return { ...asset, freshness };
  });
}

export type AssetPriceStatus = {
  freshness: PriceFreshness;
  /** Variación entre los dos últimos cierres diarios (% en divisa nativa —
   *  nunca €, la divisa de cotización no está persistida). Null con precio
   *  manual, sin histórico suficiente, o fondos FT (solo NAV diario, la UI
   *  muestra «Último NAV» en su lugar). */
  dayChange: { pct: number; lastDate: string; prevDate: string } | null;
};

/** Estado de precio de UN activo: mismo criterio manual/stale que
 *  `listAssetsWithFreshness`, más la variación del último cierre. */
export async function getAssetPriceStatus(
  asset: Asset,
  position: AssetPosition | null,
  db: DB = defaultDb,
): Promise<AssetPriceStatus> {
  if (position?.manualPrice != null && position.manualPriceAsOf != null) {
    return {
      freshness: { pricedAt: position.manualPriceAsOf, source: "manual" },
      dayChange: null,
    };
  }
  const symbol = priceSymbolForAsset(asset);
  if (!symbol) return { freshness: null, dayChange: null };

  const last2 = await db
    .select({
      pricedAt: priceHistory.pricedAt,
      pricedDateUtc: priceHistory.pricedDateUtc,
      price: priceHistory.price,
      source: priceHistory.source,
    })
    .from(priceHistory)
    .where(eq(priceHistory.symbol, symbol))
    .orderBy(desc(priceHistory.pricedDateUtc))
    .limit(2)
    .all();
  if (last2.length === 0) return { freshness: null, dayChange: null };

  const [last, prev] = last2;
  const stale = Date.now() - last.pricedAt > STALE_MS;
  const freshness: PriceFreshness = {
    pricedAt: last.pricedAt,
    source: stale ? "stale" : last.source,
  };
  const dayChange =
    asset.priceSource !== "ft" && prev != null && prev.price > 0
      ? {
          pct: last.price / prev.price - 1,
          lastDate: last.pricedDateUtc,
          prevDate: prev.pricedDateUtc,
        }
      : null;
  return { freshness, dayChange };
}

export async function listAssets(db: DB = defaultDb): Promise<Asset[]> {
  return db.select().from(assets).orderBy(asc(assets.name)).all();
}

export async function getActiveAssets(db: DB = defaultDb): Promise<Asset[]> {
  return db.select().from(assets).where(eq(assets.isActive, true)).orderBy(asc(assets.name)).all();
}

export async function getAsset(id: string, db: DB = defaultDb): Promise<Asset | null> {
  const row = await db.select().from(assets).where(eq(assets.id, id)).get();
  return row ?? null;
}

export type AssetWithPosition = {
  asset: Asset;
  position: AssetPosition | null;
};

export async function getAssetWithPositions(
  id: string,
  db: DB = defaultDb,
): Promise<AssetWithPosition | null> {
  const asset = await getAsset(id, db);
  if (!asset) return null;
  const position =
    (await db.select().from(assetPositions).where(eq(assetPositions.assetId, id)).get()) ?? null;
  return { asset, position };
}
