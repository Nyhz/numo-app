import { cache } from "react";
import { and, eq, inArray, max, or } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  assetPositions,
  assetTransactions,
  assetValuations,
  assets,
  type Asset,
  type AssetPosition,
  type AssetValuation,
} from "../db/schema";

export type PositionRow = {
  position: AssetPosition;
  asset: Asset;
  valuation: AssetValuation | null;
  /** Market value of the holding (quantity × latest unit price), or null when
   *  no market valuation exists yet. Keep using this where "market price"
   *  semantics matter (tax, composition). */
  valuationEur: number | null;
  /** Net-worth value to display: the market valuation when present, otherwise
   *  the cost basis. A freshly bought holding is carried at cost (P/L 0) until
   *  a market price arrives — never shown as a 0 / -100% loss. */
  marketOrCostEur: number;
  /** True when `marketOrCostEur` is the cost basis (no market price yet). */
  valuedAtCost: boolean;
};

/** Latest valuation per asset in two queries (audit P2) instead of one
 *  query per position: max(valuationDate) grouped by asset, then the exact
 *  rows via the (assetId, valuationDate) unique index. */
async function latestValuationsFor(
  assetIds: string[],
  db: DB,
): Promise<Map<string, AssetValuation>> {
  if (assetIds.length === 0) return new Map();
  const latest = await db
    .select({
      assetId: assetValuations.assetId,
      latestDate: max(assetValuations.valuationDate),
    })
    .from(assetValuations)
    .where(inArray(assetValuations.assetId, assetIds))
    .groupBy(assetValuations.assetId)
    .all();
  const pairs = latest.filter((r): r is { assetId: string; latestDate: string } => r.latestDate != null);
  if (pairs.length === 0) return new Map();
  const rows = await db
    .select()
    .from(assetValuations)
    .where(
      or(
        ...pairs.map((pair) =>
          and(
            eq(assetValuations.assetId, pair.assetId),
            eq(assetValuations.valuationDate, pair.latestDate),
          ),
        ),
      ),
    )
    .all();
  return new Map(rows.map((v) => [v.assetId, v]));
}

/** Memoizada por request (mismo patrón que getNetWorthSeries): /statement y
 *  /objectives la invocan desde varios agregados en el mismo render y sin
 *  esto cada uno repetía las 3 queries. */
export const listPositions = cache(async (db: DB = defaultDb): Promise<PositionRow[]> => {
  const rows = await db
    .select({ position: assetPositions, asset: assets })
    .from(assetPositions)
    .innerJoin(assets, eq(assets.id, assetPositions.assetId))
    .all();

  const valuationByAsset = await latestValuationsFor(
    rows.map((r) => r.position.assetId),
    db,
  );
  return rows.map((row) => {
    const valuation = valuationByAsset.get(row.position.assetId) ?? null;
    const valuationEur = valuation
      ? row.position.quantity * valuation.unitPriceEur
      : null;
    return {
      position: row.position,
      asset: row.asset,
      valuation,
      valuationEur,
      marketOrCostEur: valuationEur ?? row.position.totalCostEur,
      valuedAtCost: valuationEur == null,
    };
  });
});

export async function getPositionsByAccount(
  accountId: string,
  db: DB = defaultDb,
): Promise<PositionRow[]> {
  // Positions aren't scoped to an account directly; infer asset coverage from transactions.
  const assetIdsRows = await db
    .selectDistinct({ assetId: assetTransactions.assetId })
    .from(assetTransactions)
    .where(eq(assetTransactions.accountId, accountId))
    .all();
  const assetIds = new Set(assetIdsRows.map((r) => r.assetId));
  if (assetIds.size === 0) return [];

  const all = await listPositions(db);
  return all.filter((row) => assetIds.has(row.position.assetId));
}

export const getPositionsForAccount = getPositionsByAccount;
