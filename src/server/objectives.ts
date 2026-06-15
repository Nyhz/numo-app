import { asc } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { objectives, type Objective } from "../db/schema";
import { listPositions } from "./positions";

export type ObjectiveBucket = {
  objective: Objective | null; // null = the "Sin objetivo" bucket
  valueEur: number;
  /** Share of the invested (valued) total, 0–100. */
  weightPct: number;
  /** weightPct − targetPct; null for the unassigned bucket. */
  driftPct: number | null;
  /** EUR needed to reach target at the current total (negative = overweight). */
  driftEur: number | null;
  assets: Array<{ assetId: string; name: string; symbol: string | null; valueEur: number }>;
};

export type ObjectivesAllocation = {
  buckets: ObjectiveBucket[];
  totalValuedEur: number;
  /** Sum of all targets — the page warns when it strays from 100. */
  targetSumPct: number;
  unassignedEur: number;
};

export type AssignableAsset = {
  assetId: string;
  name: string;
  symbol: string | null;
  assetType: string;
  valueEur: number | null;
  objectiveId: string | null;
  /** Left out of the objectives view entirely (non-discretionary holding). */
  excludedFromObjectives: boolean;
};

/** Open positions grouped by their asset's objective. Aggregation is by
 *  ASSET, so one exposure held at several brokers lands in one bucket. */
export async function getObjectivesAllocation(
  db: DB = defaultDb,
): Promise<ObjectivesAllocation> {
  const defs = db
    .select()
    .from(objectives)
    .orderBy(asc(objectives.sortOrder), asc(objectives.name))
    .all();
  const positions = (await listPositions(db)).filter((p) => p.position.quantity > 0);

  const byObjective = new Map<string | null, ObjectiveBucket["assets"]>();
  let totalValuedEur = 0;
  for (const p of positions) {
    if (p.valuationEur == null) continue;
    // Non-discretionary holdings (e.g. a fixed-contribution EPSV) are left out
    // of the plan entirely — not even «Sin objetivo» — and off the total.
    if (p.asset.excludeFromObjectives) continue;
    totalValuedEur += p.valuationEur;
    const key = p.asset.objectiveId ?? null;
    const list = byObjective.get(key) ?? [];
    list.push({
      assetId: p.asset.id,
      name: p.asset.name,
      symbol: p.asset.symbol ?? p.asset.providerSymbol ?? null,
      valueEur: p.valuationEur,
    });
    byObjective.set(key, list);
  }

  const buckets: ObjectiveBucket[] = [];
  for (const def of defs) {
    const assets = (byObjective.get(def.id) ?? []).sort((a, b) => b.valueEur - a.valueEur);
    const valueEur = assets.reduce((s, a) => s + a.valueEur, 0);
    const weightPct = totalValuedEur > 0 ? (valueEur / totalValuedEur) * 100 : 0;
    buckets.push({
      objective: def,
      valueEur,
      weightPct,
      driftPct: weightPct - def.targetPct,
      driftEur: (def.targetPct / 100) * totalValuedEur - valueEur,
      assets,
    });
  }

  const unassigned = (byObjective.get(null) ?? []).sort((a, b) => b.valueEur - a.valueEur);
  const unassignedEur = unassigned.reduce((s, a) => s + a.valueEur, 0);
  if (unassigned.length > 0) {
    buckets.push({
      objective: null,
      valueEur: unassignedEur,
      weightPct: totalValuedEur > 0 ? (unassignedEur / totalValuedEur) * 100 : 0,
      driftPct: null,
      driftEur: null,
      assets: unassigned,
    });
  }

  return {
    buckets,
    totalValuedEur,
    targetSumPct: defs.reduce((s, d) => s + d.targetPct, 0),
    unassignedEur,
  };
}

/** Assets relevant for assignment: anything with an open position, plus
 *  inactive leftovers are omitted — sold-out assets carry no weight. */
export async function listAssignableAssets(db: DB = defaultDb): Promise<AssignableAsset[]> {
  const positions = (await listPositions(db)).filter((p) => p.position.quantity > 0);
  return positions
    .map((p) => ({
      assetId: p.asset.id,
      name: p.asset.name,
      symbol: p.asset.symbol ?? p.asset.providerSymbol ?? null,
      assetType: p.asset.assetType,
      valueEur: p.valuationEur,
      objectiveId: p.asset.objectiveId ?? null,
      excludedFromObjectives: p.asset.excludeFromObjectives ?? false,
    }))
    .sort((a, b) => (b.valueEur ?? 0) - (a.valueEur ?? 0));
}
