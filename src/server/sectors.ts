import { desc, eq, inArray } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { assetSectorWeightings, type AssetSectorWeighting } from "../db/schema";
import {
  COMMODITIES_CATEGORY,
  COMMODITY_SUBTYPE,
  CRYPTO_CATEGORY,
  UNCLASSIFIED_SECTOR,
} from "../lib/sectors";
import { listPositions } from "./positions";

export type SectorSlice = {
  sector: string;
  valueEur: number;
  /** Share of total valued portfolio (0..1). */
  weight: number;
};

export type SectorAllocation = {
  slices: SectorSlice[];
  totalEur: number;
  classifiedEur: number;
  unclassifiedEur: number;
  /** Newest sector-data fetch timestamp across contributing assets. */
  asOf: number | null;
};

/** Composición del propio activo (peso 0..1 del proveedor), sin ponderar por
 *  cartera. Alimenta los mini-donuts de la página de detalle. */
export type AssetWeightSlice = { label: string; weight: number };
export type AssetWeightings = { slices: AssetWeightSlice[]; asOf: number | null };

export const EMPTY_ASSET_WEIGHTINGS: AssetWeightings = { slices: [], asOf: null };

export async function getSectorWeightingsForAsset(
  assetId: string,
  db: DB = defaultDb,
): Promise<AssetWeightings> {
  const rows = await db
    .select()
    .from(assetSectorWeightings)
    .where(eq(assetSectorWeightings.assetId, assetId))
    .orderBy(desc(assetSectorWeightings.weight))
    .all();
  if (rows.length === 0) return EMPTY_ASSET_WEIGHTINGS;
  return {
    slices: rows.map((r) => ({ label: r.sector, weight: r.weight })),
    asOf: rows.reduce<number | null>(
      (m, r) => (m == null ? r.fetchedAt : Math.max(m, r.fetchedAt)),
      null,
    ),
  };
}

const EMPTY: SectorAllocation = {
  slices: [],
  totalEur: 0,
  classifiedEur: 0,
  unclassifiedEur: 0,
  asOf: null,
};

/** Portfolio-level sector composition: each open position's EUR market value is
 *  spread across its fund's sector weights. Value not covered by sector data
 *  (stocks, crypto, bonds, or a fund's non-equity sleeve) lands in
 *  "Sin clasificar" so the slices always reconcile to the valued total. */
export async function getSectorAllocation(
  db: DB = defaultDb,
): Promise<SectorAllocation> {
  const positions = await listPositions(db);
  const open = positions.filter(
    (r) => r.position.quantity > 0 && r.valuationEur != null && r.valuationEur > 0,
  );
  if (open.length === 0) return EMPTY;

  const assetIds = open.map((r) => r.position.assetId);
  const weightRows = await db
    .select()
    .from(assetSectorWeightings)
    .where(inArray(assetSectorWeightings.assetId, assetIds))
    .all();

  const byAsset = new Map<string, AssetSectorWeighting[]>();
  let asOf: number | null = null;
  for (const w of weightRows) {
    const arr = byAsset.get(w.assetId) ?? [];
    arr.push(w);
    byAsset.set(w.assetId, arr);
    asOf = asOf == null ? w.fetchedAt : Math.max(asOf, w.fetchedAt);
  }

  const bySector = new Map<string, number>();
  const add = (sector: string, value: number) =>
    bySector.set(sector, (bySector.get(sector) ?? 0) + value);

  let totalEur = 0;
  let unclassifiedEur = 0;
  for (const row of open) {
    const valueEur = row.valuationEur as number;
    totalEur += valueEur;
    // Non-equity classes get their own slice, not an equity sector.
    if (row.asset.assetType === "crypto") {
      add(CRYPTO_CATEGORY, valueEur);
      continue;
    }
    if (row.asset.subtype === COMMODITY_SUBTYPE) {
      add(COMMODITIES_CATEGORY, valueEur);
      continue;
    }
    const weights = byAsset.get(row.position.assetId);
    if (!weights || weights.length === 0) {
      unclassifiedEur += valueEur;
      add(UNCLASSIFIED_SECTOR, valueEur);
      continue;
    }
    let covered = 0;
    for (const w of weights) {
      const portion = w.weight * valueEur;
      add(w.sector, portion);
      covered += portion;
    }
    // Weights sum to ~1 for equity ETFs; any shortfall (a fund's bond/cash
    // sleeve) is the honest unclassified remainder. Ignore float noise.
    const leftover = valueEur - covered;
    if (leftover > 0.005) {
      unclassifiedEur += leftover;
      add(UNCLASSIFIED_SECTOR, leftover);
    }
  }

  const slices: SectorSlice[] = [...bySector.entries()]
    .map(([sector, valueEur]) => ({
      sector,
      valueEur,
      weight: totalEur > 0 ? valueEur / totalEur : 0,
    }))
    // Biggest sector first; the unclassified bucket always sinks to the bottom.
    .sort((a, b) => {
      if (a.sector === UNCLASSIFIED_SECTOR) return 1;
      if (b.sector === UNCLASSIFIED_SECTOR) return -1;
      return b.valueEur - a.valueEur;
    });

  return {
    slices,
    totalEur,
    classifiedEur: totalEur - unclassifiedEur,
    unclassifiedEur,
    asOf,
  };
}
