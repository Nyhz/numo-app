import { inArray } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { assetCountryWeightings, type AssetCountryWeighting } from "../db/schema";
import { COMMODITY_SUBTYPE } from "../lib/sectors";
import { OTHER_REGION, countryRegion } from "../lib/countries";
import { listPositions } from "./positions";

export type RegionSlice = {
  region: string;
  valueEur: number;
  /** Share of the geographically-classified total (0..1). */
  weight: number;
};

export type RegionAllocation = {
  slices: RegionSlice[];
  totalEur: number;
  classifiedEur: number;
  unclassifiedEur: number;
  /** Newest country-data fetch timestamp across contributing assets. */
  asOf: number | null;
};

const EMPTY: RegionAllocation = {
  slices: [],
  totalEur: 0,
  classifiedEur: 0,
  unclassifiedEur: 0,
  asOf: null,
};

/** Portfolio-level geographic composition, grouped by region/continent: each
 *  open position's EUR market value is spread across its fund's country
 *  weights, then those are folded into regions (Norteamérica, Europa, Asia…).
 *  Geography only — value with no country (crypto, gold, individual stocks, a
 *  fund's uncovered sleeve, or a fund we couldn't fetch) is omitted entirely,
 *  not bucketed. Slice weights are share of the geographically-classified
 *  total, so the donut sums to 100%. `classifiedEur` is that total;
 *  `unclassifiedEur` is the rest of the portfolio, reported but not charted. */
export async function getCountryAllocation(
  db: DB = defaultDb,
): Promise<RegionAllocation> {
  const positions = await listPositions(db);
  const open = positions.filter(
    (r) => r.position.quantity > 0 && r.valuationEur != null && r.valuationEur > 0,
  );
  if (open.length === 0) return EMPTY;

  const assetIds = open.map((r) => r.position.assetId);
  const weightRows = await db
    .select()
    .from(assetCountryWeightings)
    .where(inArray(assetCountryWeightings.assetId, assetIds))
    .all();

  const byAsset = new Map<string, AssetCountryWeighting[]>();
  let asOf: number | null = null;
  for (const w of weightRows) {
    const arr = byAsset.get(w.assetId) ?? [];
    arr.push(w);
    byAsset.set(w.assetId, arr);
    asOf = asOf == null ? w.fetchedAt : Math.max(asOf, w.fetchedAt);
  }

  const byRegion = new Map<string, number>();
  const add = (region: string, value: number) =>
    byRegion.set(region, (byRegion.get(region) ?? 0) + value);

  let totalEur = 0;
  let classifiedEur = 0;
  for (const row of open) {
    const valueEur = row.valuationEur as number;
    totalEur += valueEur;
    // Geography only: crypto and gold aren't countries — omit, don't bucket.
    if (row.asset.assetType === "crypto") continue;
    if (row.asset.subtype === COMMODITY_SUBTYPE) continue;
    const weights = byAsset.get(row.position.assetId);
    // No country data (stock, bond, or a fund we couldn't fetch) → omit.
    if (!weights || weights.length === 0) continue;
    for (const w of weights) {
      const portion = w.weight * valueEur;
      add(countryRegion(w.country), portion);
      classifiedEur += portion;
    }
    // The uncovered fraction of a fund isn't linked to a country → dropped.
  }

  const slices: RegionSlice[] = [...byRegion.entries()]
    .map(([region, valueEur]) => ({
      region,
      valueEur,
      // Share of the geographically-classified total, so the donut sums to 100%.
      weight: classifiedEur > 0 ? valueEur / classifiedEur : 0,
    }))
    // Biggest region first; the residual "Otros" bucket always sinks last.
    .sort((a, b) => {
      const ra = a.region === OTHER_REGION ? 1 : 0;
      const rb = b.region === OTHER_REGION ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return b.valueEur - a.valueEur;
    });

  return {
    slices,
    totalEur,
    classifiedEur,
    unclassifiedEur: totalEur - classifiedEur,
    asOf,
  };
}
