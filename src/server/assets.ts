import { and, asc, eq, inArray, max, or } from "drizzle-orm";
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
