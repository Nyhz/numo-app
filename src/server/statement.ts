import { and, asc, eq, inArray, lte, max, or, sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  assets,
  assetTransactions,
  assetValuations,
  type Asset,
  type AssetValuation,
} from "../db/schema";
import { isCashBearingAccount } from "../lib/domain";
import { round, roundEur } from "../lib/money";
import { foldLedger } from "./recompute";
import { listAccounts } from "./accounts";
import { listPositions } from "./positions";
import { getStatementRealEstate, type StatementRealEstateLine } from "./realEstate";

export type { StatementRealEstateLine };

export type StatementAssetLine = {
  assetId: string;
  name: string;
  assetType: string;
  symbol: string | null;
  isin: string | null;
  logoUrl: string | null;
  currency: string;
  quantity: number;
  unitPriceEur: number | null;
  /** Valor: mercado si hay precio, COSTE si aún no lo hay (nunca null/0 —
   *  una posición sin precio conserva su valor de coste, como el Resumen). */
  marketValueEur: number | null;
  costEur: number;
  pnlEur: number | null;
  pnlPct: number | null;
  /** Share of total invested market value (0..1); null when unvalued. */
  weight: number | null;
  valuationDate: string | null;
  /** True cuando `marketValueEur` es el coste por no haber precio de mercado. */
  valuedAtCost: boolean;
};

export type StatementGroup = {
  assetType: string;
  lines: StatementAssetLine[];
  marketValueEur: number;
  costEur: number;
  pnlEur: number;
  weight: number;
};

export type StatementAccountLine = {
  accountId: string;
  name: string;
  accountType: string;
  currency: string;
  cashEur: number;
  investedEur: number;
  totalEur: number;
};

export type StatementTotals = {
  investedMarketValueEur: number;
  investedCostEur: number;
  unrealizedPnlEur: number;
  unrealizedPnlPct: number | null;
  cashEur: number;
  netWorthEur: number;
  positionsCount: number;
  accountsCount: number;
  realEstateEquityEur: number;
};

export type StatementReport = {
  generatedAt: number;
  /** Fecha de corte ISO cuando el extracto es reconstruido; null = actual. */
  asOf: string | null;
  /** Fecha ISO del cierre más reciente entre las posiciones valoradas; los
   *  precios del extracto corresponden a esta fecha, no a generatedAt. */
  pricesAsOf: string | null;
  totals: StatementTotals;
  groups: StatementGroup[];
  accounts: StatementAccountLine[];
  realEstate: StatementRealEstateLine[];
};

type LineInput = {
  asset: Asset;
  quantity: number;
  costEur: number;
  unitPriceEur: number | null;
  valuationDate: string | null;
};

function toLine(input: LineInput, totalMarketValueEur: number): StatementAssetLine {
  const priced = input.unitPriceEur != null;
  const costEur = input.costEur;
  // Sin precio ⇒ valor a coste (lo que pagaste), no null/0. Igual que el
  // Resumen: así el patrimonio del Extracto cuadra con la home y una posición
  // recién añadida no se lee como −100%.
  const marketValueEur = priced ? input.quantity * (input.unitPriceEur as number) : costEur;
  const pnlEur = priced ? marketValueEur - costEur : 0;
  return {
    assetId: input.asset.id,
    name: input.asset.name,
    assetType: input.asset.assetType,
    symbol: input.asset.ticker ?? input.asset.symbol,
    isin: input.asset.isin,
    logoUrl: input.asset.logoUrl,
    currency: input.asset.currency,
    quantity: input.quantity,
    unitPriceEur: input.unitPriceEur,
    marketValueEur,
    costEur,
    pnlEur,
    pnlPct: priced ? (costEur > 0 ? pnlEur / costEur : null) : 0,
    weight: totalMarketValueEur > 0 ? marketValueEur / totalMarketValueEur : null,
    valuationDate: input.valuationDate,
    valuedAtCost: !priced,
  };
}

/** Group asset lines by assetType, biggest group first, biggest line first. */
export function groupAssetLines(
  lines: StatementAssetLine[],
  totalMarketValueEur: number,
): StatementGroup[] {
  const byType = new Map<string, StatementAssetLine[]>();
  for (const line of lines) {
    const bucket = byType.get(line.assetType) ?? [];
    bucket.push(line);
    byType.set(line.assetType, bucket);
  }
  const groups = [...byType.entries()].map(([assetType, groupLines]) => {
    const marketValueEur = groupLines.reduce((acc, l) => acc + (l.marketValueEur ?? 0), 0);
    const costEur = groupLines.reduce((acc, l) => acc + l.costEur, 0);
    return {
      assetType,
      lines: [...groupLines].sort(
        (a, b) => (b.marketValueEur ?? 0) - (a.marketValueEur ?? 0),
      ),
      marketValueEur,
      costEur,
      pnlEur: groupLines.reduce((acc, l) => acc + (l.pnlEur ?? 0), 0),
      weight: totalMarketValueEur > 0 ? marketValueEur / totalMarketValueEur : 0,
    };
  });
  return groups.sort((a, b) => b.marketValueEur - a.marketValueEur);
}

/** Primary account per asset: the one with the most recent trade. SQLite's
 *  bare-column-with-max() semantics return the accountId of the max row. */
function primaryAccountByAsset(db: DB): Map<string, string> {
  const rows = db
    .select({
      assetId: assetTransactions.assetId,
      accountId: assetTransactions.accountId,
      latestTradedAt: max(assetTransactions.tradedAt),
    })
    .from(assetTransactions)
    .groupBy(assetTransactions.assetId)
    .all();
  return new Map(rows.map((r) => [r.assetId, r.accountId]));
}

type AssemblyInput = {
  asOf: string | null;
  lines: LineInput[]; // solo posiciones abiertas (quantity > 0)
  accounts: Array<Omit<StatementAccountLine, "investedEur" | "totalEur">>;
  investedByAccount: Map<string, number>;
  realEstate: { lines: StatementRealEstateLine[]; totalEquityEur: number };
};

/** Tramo común a ambos caminos (actual y as-of): misma matemática de líneas,
 *  grupos y totales ⇒ paridad al céntimo garantizada por construcción. */
function assembleReport(input: AssemblyInput): StatementReport {
  const investedMarketValueEur = input.lines.reduce(
    (acc, l) => acc + (l.unitPriceEur != null ? l.quantity * l.unitPriceEur : l.costEur),
    0,
  );
  const lines = input.lines.map((l) => toLine(l, investedMarketValueEur));
  const groups = groupAssetLines(lines, investedMarketValueEur);

  // ISO YYYY-MM-DD ordena lexicográficamente = cronológicamente.
  const pricesAsOf = lines.reduce<string | null>(
    (acc, l) =>
      l.valuationDate != null && (acc == null || l.valuationDate > acc)
        ? l.valuationDate
        : acc,
    null,
  );

  const accounts: StatementAccountLine[] = input.accounts
    .map((account) => {
      const investedEur = input.investedByAccount.get(account.accountId) ?? 0;
      return { ...account, investedEur, totalEur: account.cashEur + investedEur };
    })
    .sort((a, b) => b.totalEur - a.totalEur);

  // Toda posición aporta valor (mercado o coste), así que el coste computable
  // del P/L es el coste total — coherente con el Resumen (denominador = coste
  // invertido). Una posición a coste aporta P/L 0, no distorsiona.
  const investedCostEur = lines.reduce((acc, l) => acc + l.costEur, 0);
  const unrealizedPnlEur = investedMarketValueEur - investedCostEur;
  const cashEur = accounts.reduce((acc, a) => acc + a.cashEur, 0);

  return {
    generatedAt: Date.now(),
    asOf: input.asOf,
    pricesAsOf,
    totals: {
      investedMarketValueEur,
      investedCostEur,
      unrealizedPnlEur,
      unrealizedPnlPct: investedCostEur > 0 ? unrealizedPnlEur / investedCostEur : null,
      cashEur,
      netWorthEur: investedMarketValueEur + cashEur + input.realEstate.totalEquityEur,
      positionsCount: lines.length,
      accountsCount: accounts.length,
      realEstateEquityEur: input.realEstate.totalEquityEur,
    },
    groups,
    accounts,
    realEstate: input.realEstate.lines,
  };
}

export async function getStatementReport(
  db: DB = defaultDb,
  opts: { asOf?: string } = {},
): Promise<StatementReport> {
  if (opts.asOf) return statementReportAsOf(opts.asOf, db);

  const [positions, accountsList, realEstate] = await Promise.all([
    listPositions(db),
    listAccounts(db),
    getStatementRealEstate(db),
  ]);
  const assetAccount = primaryAccountByAsset(db);

  const open = positions.filter((row) => row.position.quantity > 0);
  const lineInputs: LineInput[] = open.map((row) => ({
    asset: row.asset,
    quantity: row.position.quantity,
    costEur: row.position.totalCostEur,
    unitPriceEur: row.valuation?.unitPriceEur ?? null,
    valuationDate: row.valuation?.valuationDate ?? null,
  }));

  const investedByAccount = new Map<string, number>();
  for (const row of open) {
    const accountId = assetAccount.get(row.position.assetId);
    if (!accountId) continue;
    // Valor a mercado o coste (posición sin precio) — coherente con el total.
    investedByAccount.set(
      accountId,
      (investedByAccount.get(accountId) ?? 0) + row.marketOrCostEur,
    );
  }

  return assembleReport({
    asOf: null,
    lines: lineInputs,
    accounts: accountsList.map((a) => ({
      accountId: a.id,
      name: a.name,
      accountType: a.accountType,
      currency: a.currency,
      cashEur: a.totalBalanceEur,
    })),
    investedByAccount,
    realEstate,
  });
}

/** Última valoración ≤ asOf por activo, mismo patrón de dos queries que
 *  latestValuationsFor en positions.ts pero acotado en fecha. */
async function valuationsAsOf(
  assetIds: string[],
  asOf: string,
  db: DB,
): Promise<Map<string, AssetValuation>> {
  if (assetIds.length === 0) return new Map();
  const latest = await db
    .select({
      assetId: assetValuations.assetId,
      latestDate: max(assetValuations.valuationDate),
    })
    .from(assetValuations)
    .where(
      and(
        inArray(assetValuations.assetId, assetIds),
        lte(assetValuations.valuationDate, asOf),
      ),
    )
    .groupBy(assetValuations.assetId)
    .all();
  const pairs = latest.filter(
    (r): r is { assetId: string; latestDate: string } => r.latestDate != null,
  );
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

/**
 * Extracto reconstruido a fin de día LOCAL de `asOf`: replay del ledger para
 * cantidades y coste (misma media ponderada que recomputeAssetPosition, vía
 * foldLedger), última valoración ≤ asOf como precio, y efectivo =
 * openingBalance + Σ movimientos ≤ corte (recomputeAccountCashBalance acotado).
 */
async function statementReportAsOf(asOf: string, db: DB): Promise<StatementReport> {
  const cutoffMs = new Date(`${asOf}T23:59:59.999`).getTime();
  const realEstate = await getStatementRealEstate(db, asOf);

  const trades = await db
    .select()
    .from(assetTransactions)
    .where(lte(assetTransactions.tradedAt, cutoffMs))
    .orderBy(asc(assetTransactions.tradedAt), asc(assetTransactions.id))
    .all();

  const tradesByAsset = new Map<string, typeof trades>();
  const lastAccountByAsset = new Map<string, string>();
  const tradedAccountIds = new Set<string>();
  for (const t of trades) {
    const bucket = tradesByAsset.get(t.assetId) ?? [];
    bucket.push(t);
    tradesByAsset.set(t.assetId, bucket);
    lastAccountByAsset.set(t.assetId, t.accountId); // cronológico → gana el último
    tradedAccountIds.add(t.accountId);
  }

  const held: Array<{ assetId: string; quantity: number; costEur: number }> = [];
  for (const [assetId, rows] of tradesByAsset) {
    const fold = foldLedger(rows);
    if (fold.qty <= 0) continue;
    // Mismo redondeo que persiste recomputeAssetPosition → paridad al céntimo.
    held.push({ assetId, quantity: fold.qty, costEur: round(fold.totalCostEur) });
  }

  const heldIds = held.map((h) => h.assetId);
  const [assetRows, valuationByAsset] = await Promise.all([
    heldIds.length > 0
      ? db.select().from(assets).where(inArray(assets.id, heldIds)).all()
      : Promise.resolve([] as Asset[]),
    valuationsAsOf(heldIds, asOf, db),
  ]);
  const assetById = new Map(assetRows.map((a) => [a.id, a]));

  const lineInputs: LineInput[] = [];
  const investedByAccount = new Map<string, number>();
  for (const h of held) {
    const asset = assetById.get(h.assetId);
    if (!asset) continue;
    const valuation = valuationByAsset.get(h.assetId) ?? null;
    lineInputs.push({
      asset,
      quantity: h.quantity,
      costEur: h.costEur,
      unitPriceEur: valuation?.unitPriceEur ?? null,
      valuationDate: valuation?.valuationDate ?? null,
    });
    const accountId = lastAccountByAsset.get(h.assetId);
    if (!accountId) continue;
    // Valor a mercado o coste (sin valoración ≤ corte) — coherente con el total.
    const valueEur = valuation ? h.quantity * valuation.unitPriceEur : h.costEur;
    investedByAccount.set(
      accountId,
      (investedByAccount.get(accountId) ?? 0) + valueEur,
    );
  }

  const movementSums = await db
    .select({
      accountId: accountCashMovements.accountId,
      total: sql<number>`coalesce(sum(case when ${accountCashMovements.affectsCashBalance} = 1 then ${accountCashMovements.cashImpactEur} else 0 end), 0)`,
    })
    .from(accountCashMovements)
    .where(lte(accountCashMovements.occurredAt, cutoffMs))
    .groupBy(accountCashMovements.accountId)
    .all();
  const sumByAccount = new Map(movementSums.map((r) => [r.accountId, r.total]));

  const accountRows = await db.select().from(accounts).orderBy(asc(accounts.name)).all();
  const accountLines = accountRows
    // Existía a la fecha, o tiene actividad ≤ corte (cubre backfills con
    // createdAt posterior a los hechos).
    .filter(
      (a) => a.createdAt <= cutoffMs || sumByAccount.has(a.id) || tradedAccountIds.has(a.id),
    )
    .map((a) => ({
      accountId: a.id,
      name: a.name,
      accountType: a.accountType,
      currency: a.currency,
      cashEur: isCashBearingAccount(a.accountType)
        ? roundEur(a.openingBalanceEur + (sumByAccount.get(a.id) ?? 0))
        : 0,
    }));

  return assembleReport({
    asOf,
    lines: lineInputs,
    accounts: accountLines,
    investedByAccount,
    realEstate,
  });
}
