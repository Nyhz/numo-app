import { eq } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { accountCashMovements, assetTransactions, accounts } from "../db/schema";
import { listPositions } from "./positions";

export type CostsByYear = { year: number; eur: number };
export type CostsByAccount = {
  accountId: string;
  name: string;
  accountType: string;
  eur: number;
};
export type TerLine = {
  assetId: string;
  name: string;
  /** TER as an annual percentage (0.22 = 0.22%/year). */
  terPct: number;
  marketValueEur: number;
  annualCostEur: number;
};

export type CostsSummary = {
  commissions: {
    /** Buy/sell commissions captured on asset transactions. */
    tradingEur: number;
    /** Custody / account fees logged as "fee" cash movements. */
    accountFeesEur: number;
    totalEur: number;
    byYear: CostsByYear[];
    byAccount: CostsByAccount[];
  };
  ter: {
    /** Estimated yearly drag = Σ marketValue × TER, over positions with a TER. */
    annualCostEur: number;
    /** Value-weighted TER across covered positions, or null when none priced. */
    weightedTerPct: number | null;
    /** Market value of positions that carry a TER. */
    coveredValueEur: number;
    /** Total valued positions — lets the UI flag uncovered exposure. */
    valuedEur: number;
    lines: TerLine[];
  };
};

/**
 * Aggregates everything the portfolio has cost in fees, plus the forward-looking
 * annual drag implied by each fund's TER. Commissions are historical (already in
 * EUR on every row); TER cost is an estimate over current market value.
 */
export async function getCostsSummary(db: DB = defaultDb): Promise<CostsSummary> {
  const txRows = await db
    .select({
      accountId: assetTransactions.accountId,
      tradedAt: assetTransactions.tradedAt,
      feesEur: assetTransactions.feesAmountEur,
    })
    .from(assetTransactions)
    .all();

  const feeRows = await db
    .select({
      accountId: accountCashMovements.accountId,
      occurredAt: accountCashMovements.occurredAt,
      cashImpactEur: accountCashMovements.cashImpactEur,
    })
    .from(accountCashMovements)
    .where(eq(accountCashMovements.movementType, "fee"))
    .all();

  const accountRows = await db.select().from(accounts).all();
  const accountById = new Map(accountRows.map((a) => [a.id, a]));

  const byYear = new Map<number, number>();
  const byAccount = new Map<string, number>();
  let tradingEur = 0;
  let accountFeesEur = 0;

  for (const r of txRows) {
    if (!r.feesEur) continue;
    tradingEur += r.feesEur;
    const year = new Date(r.tradedAt).getFullYear();
    byYear.set(year, (byYear.get(year) ?? 0) + r.feesEur);
    byAccount.set(r.accountId, (byAccount.get(r.accountId) ?? 0) + r.feesEur);
  }

  for (const r of feeRows) {
    // A fee movement reduces cash, so cashImpactEur is negative — the cost is its magnitude.
    const fee = Math.abs(r.cashImpactEur);
    if (!fee) continue;
    accountFeesEur += fee;
    const year = new Date(r.occurredAt).getFullYear();
    byYear.set(year, (byYear.get(year) ?? 0) + fee);
    byAccount.set(r.accountId, (byAccount.get(r.accountId) ?? 0) + fee);
  }

  const positions = await listPositions(db);
  let annualCostEur = 0;
  let coveredValueEur = 0;
  let valuedEur = 0;
  const lines: TerLine[] = [];
  for (const p of positions) {
    if (p.valuationEur == null || p.valuationEur <= 0) continue;
    valuedEur += p.valuationEur;
    if (p.asset.ter == null) continue;
    const cost = p.valuationEur * (p.asset.ter / 100);
    annualCostEur += cost;
    coveredValueEur += p.valuationEur;
    lines.push({
      assetId: p.asset.id,
      name: p.asset.name,
      terPct: p.asset.ter,
      marketValueEur: p.valuationEur,
      annualCostEur: cost,
    });
  }
  lines.sort((a, b) => b.annualCostEur - a.annualCostEur);

  return {
    commissions: {
      tradingEur,
      accountFeesEur,
      totalEur: tradingEur + accountFeesEur,
      byYear: [...byYear.entries()]
        .map(([year, eur]) => ({ year, eur }))
        .sort((a, b) => b.year - a.year),
      byAccount: [...byAccount.entries()]
        .map(([accountId, eur]) => {
          const acc = accountById.get(accountId);
          return {
            accountId,
            name: acc?.name ?? "—",
            accountType: acc?.accountType ?? "other",
            eur,
          };
        })
        .sort((a, b) => b.eur - a.eur),
    },
    ter: {
      annualCostEur,
      weightedTerPct: coveredValueEur > 0 ? (annualCostEur / coveredValueEur) * 100 : null,
      coveredValueEur,
      valuedEur,
      lines,
    },
  };
}
