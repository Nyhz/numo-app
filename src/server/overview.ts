import { cache } from "react";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  accounts,
  assetTransactions,
  assetValuations,
  assets,
  type Account,
} from "../db/schema";
import { getAccountsSummary } from "./accounts";
import { isCashBearingAccount } from "../lib/domain";
import { toIsoDate } from "../lib/time";
import { computeXirr, type CashFlow } from "../lib/xirr";
import { listPositions, type PositionRow } from "./positions";

export type OverviewRange = "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";

export const OVERVIEW_RANGES: OverviewRange[] = [
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "ALL",
];

export type OverviewFilters = {
  /** Empty array or null means "all accounts". */
  accountIds?: string[] | null;
  range: OverviewRange;
};

export type OverviewKpis = {
  totalNetWorthEur: number;
  cashEur: number;
  /** Cost basis of the positions (what was paid, fees included). */
  investedEur: number;
  /** Current market value of the positions. With cash it sums to net worth. */
  investedMarketValueEur: number;
  unrealizedPnlEur: number;
  unrealizedPnlPct: number | null;
  /** Money-weighted annual return (XIRR) over the selected window — the
   *  investor's own rate, entry dates and contribution sizes included. */
  xirrPct: number | null;
};

/** XIRR flows from the net-worth series: opening value counts as buying the
 *  whole portfolio on day one, each contribution delta is money in/out, and
 *  the closing value is the final payoff. Window-relative on purpose, so it
 *  follows the same range filter as everything else. */
export function xirrFromSeries(series: NetWorthPoint[]): number | null {
  if (series.length < 2) return null;
  const flows: CashFlow[] = [{ dateIso: series[0].date, amountEur: -series[0].valueEur }];
  for (let i = 1; i < series.length; i++) {
    const contribution = series[i].investedEur - series[i - 1].investedEur;
    if (contribution !== 0) {
      flows.push({ dateIso: series[i].date, amountEur: -contribution });
    }
  }
  const last = series[series.length - 1];
  flows.push({ dateIso: last.date, amountEur: last.valueEur });
  return computeXirr(flows);
}

function rangeStart(range: OverviewRange, now: Date = new Date()): Date | null {
  if (range === "ALL") return null;
  const d = new Date(now);
  if (range === "YTD") return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  if (range === "1M") d.setUTCMonth(d.getUTCMonth() - 1);
  else if (range === "3M") d.setUTCMonth(d.getUTCMonth() - 3);
  else if (range === "6M") d.setUTCMonth(d.getUTCMonth() - 6);
  else if (range === "1Y") d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d;
}

async function resolveAccountIds(
  filters: OverviewFilters,
  db: DB,
): Promise<{ ids: string[]; accounts: Account[] }> {
  const all = await db.select().from(accounts).all();
  const wanted = filters.accountIds && filters.accountIds.length > 0
    ? new Set(filters.accountIds)
    : null;
  if (wanted) {
    const match = all.filter((a) => wanted.has(a.id));
    return { ids: match.map((a) => a.id), accounts: match };
  }
  return { ids: all.map((a) => a.id), accounts: all };
}

async function assetIdsForAccounts(
  accountIds: string[],
  db: DB,
): Promise<Set<string>> {
  if (accountIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ assetId: assetTransactions.assetId })
    .from(assetTransactions)
    .where(inArray(assetTransactions.accountId, accountIds))
    .all();
  return new Set(rows.map((r) => r.assetId));
}

export async function getOverviewKpis(
  filters: OverviewFilters = { range: "ALL" },
  db: DB = defaultDb,
): Promise<OverviewKpis> {
  const { accounts: filteredAccounts, ids: filteredAccountIds } =
    await resolveAccountIds(filters, db);
  const filteringAccounts = filters.accountIds != null && filters.accountIds.length > 0;

  let cashEur = 0;
  if (filteringAccounts) {
    cashEur = filteredAccounts
      .filter((a) => isCashBearingAccount(a.accountType))
      .reduce((s, a) => s + a.currentCashBalanceEur, 0);
  } else {
    const summary = await getAccountsSummary(db);
    cashEur = summary.totalEur;
  }

  let positions = await listPositions(db);
  if (filteringAccounts) {
    const assetIds = await assetIdsForAccounts(filteredAccountIds, db);
    positions = positions.filter((p) => assetIds.has(p.position.assetId));
  }

  let marketValueEur = 0;
  let investedEur = 0;
  for (const row of positions) {
    if (row.valuationEur != null) marketValueEur += row.valuationEur;
    // Stored cost pool, not quantity × pre-rounded average — keeps the KPI
    // in lockstep with the statement page's cost basis.
    investedEur += row.position.totalCostEur;
  }

  // Range-aware P/L across the filtered positions. For ALL, this reduces to
  // marketValue - costBasis. For a time range we subtract any contributions
  // (buys/sells) that happened inside the window so the pct reflects pure
  // market movement rather than cash inflow/outflow.
  let unrealizedPnlEur = marketValueEur - investedEur;
  let pctBase = investedEur;
  if (filters.range !== "ALL" && positions.length > 0) {
    const scopeAssetIds = positions.map((p) => p.position.assetId);
    const rangeStartDate = rangeStart(filters.range);
    const startIsoKpi = rangeStartDate ? toIsoDate(rangeStartDate) : null;
    const startMsKpi = rangeStartDate ? rangeStartDate.getTime() : null;

    // Value on range-start day (nearest <= start). If the position didn't
    // exist before the range, start value is 0 — otherwise we'd double-count
    // the opening buy (once as starting value, once as a contribution).
    let startValueTotal = 0;
    if (startIsoKpi) {
      for (const assetId of scopeAssetIds) {
        const onOrBefore = await db
          .select()
          .from(assetValuations)
          .where(
            and(
              eq(assetValuations.assetId, assetId),
              lte(assetValuations.valuationDate, startIsoKpi),
            ),
          )
          .orderBy(desc(assetValuations.valuationDate))
          .limit(1)
          .get();
        if (onOrBefore) startValueTotal += onOrBefore.marketValueEur;
      }
    }

    // Net contributions during the range: Σ -cashImpactEur for trades
    // belonging to the scope.
    let contributionsInRange = 0;
    if (startMsKpi !== null) {
      const txs = await db
        .select({
          assetId: assetTransactions.assetId,
          accountId: assetTransactions.accountId,
          tradedAt: assetTransactions.tradedAt,
          cashImpactEur: assetTransactions.cashImpactEur,
        })
        .from(assetTransactions)
        .where(inArray(assetTransactions.assetId, scopeAssetIds))
        .all();
      const accountFilter = filteringAccounts ? new Set(filteredAccountIds) : null;
      for (const t of txs) {
        if (t.tradedAt < startMsKpi) continue;
        if (accountFilter && !accountFilter.has(t.accountId)) continue;
        contributionsInRange -= t.cashImpactEur;
      }
    }

    unrealizedPnlEur = marketValueEur - startValueTotal - contributionsInRange;
    pctBase = startValueTotal + Math.max(contributionsInRange, 0);
  }

  // Align the KPI percent with the Portfolio-evolution chart: both use the
  // time-weighted return so deposits/withdrawals don't move the number. The
  // EUR figure stays as true unrealized P&L (market value vs. cost / range
  // baseline), so the card reads "€X gained, portfolio returned Y%".
  let unrealizedPnlPct: number | null =
    pctBase > 0 ? unrealizedPnlEur / pctBase : null;
  let xirrPct: number | null = null;
  if (positions.length > 0) {
    const series = await getNetWorthSeries(filters, db);
    const last = series.at(-1);
    if (last && Number.isFinite(last.performanceIndex)) {
      unrealizedPnlPct = last.performanceIndex / 100 - 1;
    }
    xirrPct = xirrFromSeries(series);
  }
  return {
    totalNetWorthEur: cashEur + marketValueEur,
    cashEur,
    investedEur,
    investedMarketValueEur: marketValueEur,
    unrealizedPnlEur,
    unrealizedPnlPct,
    xirrPct,
  };
}

export type NetWorthPoint = {
  date: string;
  valueEur: number;
  /** Cumulative EUR contributed into scope up to and including this date.
   *  Used to compute a P/L % that excludes fresh deposits. */
  investedEur: number;
  /** Time-weighted return index anchored at 100 on the first valued day.
   *  Chain-links daily market returns and strips out contributions, so a
   *  fresh deposit + buy does not move the line. */
  performanceIndex: number;
};

/**
 * Per-render memo for the series: the KPI card (last performanceIndex) and
 * the chart both need it, and the full computation is expensive. React's
 * cache() keys on argument identity, so the public wrapper serialises the
 * filters into a stable string — two call sites with equal-but-distinct
 * filter objects still share one entry. Outside a React render (tests,
 * scripts) cache() degrades to a plain call.
 */
const getNetWorthSeriesCached = cache(
  async (filtersKey: string, db: DB): Promise<NetWorthPoint[]> =>
    computeNetWorthSeries(JSON.parse(filtersKey) as OverviewFilters, db),
);

export async function getNetWorthSeries(
  filters: OverviewFilters,
  db: DB = defaultDb,
): Promise<NetWorthPoint[]> {
  const filtersKey = JSON.stringify({
    range: filters.range,
    accountIds: filters.accountIds ?? null,
  });
  return getNetWorthSeriesCached(filtersKey, db);
}

async function computeNetWorthSeries(
  filters: OverviewFilters,
  db: DB,
): Promise<NetWorthPoint[]> {
  const { ids } = await resolveAccountIds(filters, db);
  if (ids.length === 0) return [];

  const filteringAccounts =
    filters.accountIds != null && filters.accountIds.length > 0;

  // Always scope valuations to assets that currently have transactions.
  // `asset_valuations` is reference data and survives account/transaction
  // wipes; without this filter the chart would keep rendering orphaned
  // history from deleted accounts.
  const scopeAccountIds = filteringAccounts ? filters.accountIds! : ids;
  const scopeAssetIds = await assetIdsForAccounts(scopeAccountIds, db);
  if (scopeAssetIds.size === 0) return [];
  const scopeAssetIdList: string[] = [...scopeAssetIds];

  // Bound the chart's time window by the current transactions' range: start
  // at the oldest trade in scope, end at today (never extrapolate before the
  // first trade). This keeps the series honest after a wipe + partial
  // reimport — the line can't run across dates when the position didn't yet
  // exist.
  const tradeBoundsConds = [inArray(assetTransactions.assetId, scopeAssetIdList)];
  if (filteringAccounts) {
    tradeBoundsConds.push(inArray(assetTransactions.accountId, scopeAccountIds));
  }
  const tradeBoundsRow = await db
    .select({
      minTradedAt: sql<number | null>`min(${assetTransactions.tradedAt})`,
      maxTradedAt: sql<number | null>`max(${assetTransactions.tradedAt})`,
    })
    .from(assetTransactions)
    .where(and(...tradeBoundsConds))
    .get();
  const oldestTradeMs = tradeBoundsRow?.minTradedAt ?? null;
  if (oldestTradeMs === null) return [];

  const rangeStartDate = rangeStart(filters.range);
  const effectiveStart = rangeStartDate
    ? rangeStartDate.getTime() > oldestTradeMs
      ? rangeStartDate
      : new Date(oldestTradeMs)
    : new Date(oldestTradeMs);
  const end = new Date();

  const startIso = toIsoDate(effectiveStart);
  const conds = [
    lte(assetValuations.valuationDate, toIsoDate(end)),
    gte(assetValuations.valuationDate, startIso),
    inArray(assetValuations.assetId, scopeAssetIdList),
  ];

  const rows = await db
    .select()
    .from(assetValuations)
    .where(and(...conds))
    .orderBy(asc(assetValuations.valuationDate))
    .all();

  // Carry-in baseline: only seed when the chart is clamped by a user-selected
  // range that is *later* than the oldest trade — in that case assets bought
  // pre-window had a stable valuation we need to forward-fill from. When the
  // window starts exactly at the oldest trade, the position didn't exist
  // before and there's nothing to carry in.
  const carryIns: typeof rows = [];
  const seededByRange =
    rangeStartDate !== null && rangeStartDate.getTime() > oldestTradeMs;
  if (seededByRange) {
    const seedAssetIds = scopeAssetIdList;
    for (const assetId of seedAssetIds) {
      const earliestInRange = rows.find((r) => r.assetId === assetId);
      if (earliestInRange && earliestInRange.valuationDate === startIso) continue;
      const prior = await db
        .select()
        .from(assetValuations)
        .where(
          and(
            eq(assetValuations.assetId, assetId),
            lte(assetValuations.valuationDate, startIso),
          ),
        )
        .orderBy(desc(assetValuations.valuationDate))
        .limit(1)
        .get();
      if (prior) {
        carryIns.push({ ...prior, valuationDate: startIso });
      }
    }
  }
  const allRows = [...carryIns, ...rows];

  // Figure out whether any asset in scope trades weekends (crypto). If none
  // do, Sat/Sun dates in the series are noise — either forward-filled stock
  // values (flat) or empty gaps — and we drop them so the chart stays at one
  // point per trading day.
  const presentAssetIds = new Set(allRows.map((r) => r.assetId));
  let includeWeekends = false;
  if (presentAssetIds.size > 0) {
    const types = await db
      .select({ assetType: assets.assetType })
      .from(assets)
      .where(inArray(assets.id, [...presentAssetIds]))
      .all();
    includeWeekends = types.some((t) => t.assetType === "crypto");
  }

  function keepDate(iso: string): boolean {
    if (includeWeekends) return true;
    const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return day !== 0 && day !== 6;
  }

  // Group valuations per asset so we can forward-fill across gaps (typical
  // for stock/ETF weekends — Yahoo has no Sat/Sun close, but crypto does, so
  // without forward-fill the Sat/Sun totals collapse to crypto-only).
  const datesSet = new Set<string>();
  const perAsset = new Map<string, Array<{ date: string; valueEur: number }>>();
  for (const row of allRows) {
    if (!keepDate(row.valuationDate)) continue;
    datesSet.add(row.valuationDate);
    const list = perAsset.get(row.assetId) ?? [];
    list.push({ date: row.valuationDate, valueEur: row.marketValueEur });
    perAsset.set(row.assetId, list);
  }
  const orderedDates = [...datesSet].sort();

  // Quantity timeline per asset, with the same day-end cursor the valuation
  // rebuild uses: rows stop being written once the global quantity hits 0,
  // so the forward-fill must stop contributing on those days too. Without
  // this, a sold-out position carries its last value into every later date —
  // and the sale proceeds register as a fake TWR gain on top.
  const qtyTrades = await db
    .select({
      assetId: assetTransactions.assetId,
      transactionType: assetTransactions.transactionType,
      tradedAt: assetTransactions.tradedAt,
      quantity: assetTransactions.quantity,
    })
    .from(assetTransactions)
    .where(inArray(assetTransactions.assetId, scopeAssetIdList))
    .orderBy(asc(assetTransactions.tradedAt))
    .all();
  const tradesByAsset = new Map<string, Array<{ tradedAt: number; signedQty: number }>>();
  for (const t of qtyTrades) {
    if (t.transactionType !== "buy" && t.transactionType !== "sell") continue;
    const list = tradesByAsset.get(t.assetId) ?? [];
    list.push({
      tradedAt: t.tradedAt,
      signedQty: t.transactionType === "buy" ? t.quantity : -t.quantity,
    });
    tradesByAsset.set(t.assetId, list);
  }

  const byDate = new Map<string, number>();
  for (const [assetId, series] of perAsset) {
    series.sort((a, b) => a.date.localeCompare(b.date));
    const trades = tradesByAsset.get(assetId) ?? [];
    let idx = 0;
    let last = 0;
    let seen = false;
    let tradeIdx = 0;
    let qty = 0;
    for (const date of orderedDates) {
      while (idx < series.length && series[idx].date <= date) {
        last = series[idx].valueEur;
        seen = true;
        idx++;
      }
      const dayEnd = new Date(`${date}T23:59:59Z`).getTime();
      while (tradeIdx < trades.length && trades[tradeIdx].tradedAt <= dayEnd) {
        qty += trades[tradeIdx].signedQty;
        tradeIdx++;
      }
      if (!seen) continue; // asset hasn't had its first valuation yet
      if (qty <= 1e-9) continue; // position closed at day end — don't carry the stale value
      byDate.set(date, (byDate.get(date) ?? 0) + last);
    }
  }

  // Cumulative invested EUR per date. Invested_t = cost_basis_bought_up_to_t
  // - cost_basis_realised_from_sells_up_to_t. For simplicity we sum the
  // positive part of each trade's cash impact (buys = outflow = -cashImpact).
  const txConds = [];
  if (filteringAccounts) {
    txConds.push(inArray(assetTransactions.accountId, filters.accountIds!));
  }
  const txs = await db
    .select({
      tradedAt: assetTransactions.tradedAt,
      cashImpactEur: assetTransactions.cashImpactEur,
    })
    .from(assetTransactions)
    .where(txConds.length > 0 ? and(...txConds) : undefined)
    .orderBy(asc(assetTransactions.tradedAt))
    .all();
  // Date-keyed net-contribution delta (-cashImpact sums to positive for buys).
  const deltaByDate = new Map<string, number>();
  for (const t of txs) {
    const iso = toIsoDate(new Date(t.tradedAt));
    deltaByDate.set(iso, (deltaByDate.get(iso) ?? 0) - t.cashImpactEur);
  }

  const sortedDates = [...byDate.keys()].sort();
  let invested = 0;
  // Roll contributions that happened BEFORE our first date into the initial
  // invested baseline (otherwise we'd start the curve already below breakeven).
  if (sortedDates.length > 0) {
    const first = sortedDates[0];
    for (const [iso, delta] of deltaByDate) {
      if (iso < first) invested += delta;
    }
  }
  const out: NetWorthPoint[] = [];
  let performanceIndex = 100;
  let prevValue: number | null = null;
  for (const date of sortedDates) {
    const contribution = deltaByDate.get(date) ?? 0;
    invested += contribution;
    const value = byDate.get(date) ?? 0;
    // TWR: anchor the index at the first day with a positive value. For each
    // later day, period return = (V_t − C_t) / V_{t−1}, which subtracts the
    // day's contribution from the numerator so a deposit+buy doesn't register
    // as a gain or loss. prev_value tracks the previous day's ex-post value.
    if (prevValue !== null && prevValue > 0) {
      const r = (value - contribution) / prevValue;
      if (Number.isFinite(r) && r > 0) performanceIndex *= r;
    }
    if (prevValue === null && value > 0) {
      performanceIndex = 100;
    }
    if (value > 0) prevValue = value;
    out.push({
      date,
      valueEur: value,
      investedEur: invested,
      performanceIndex,
    });
  }
  return out;
}

export type TopPositionRow = {
  position: PositionRow;
  weight: number;
  pnlEur: number | null;
  pnlPct: number | null;
  unitPriceEur: number | null;
  averageCostEur: number;
  sparkline: Array<{
    date: string;
    valueEur: number;
    investedEur: number;
    unitPriceEur: number;
  }>;
};

export async function getTopPositions(
  filters: OverviewFilters,
  limit: number,
  db: DB = defaultDb,
): Promise<TopPositionRow[]> {
  const filteringAccounts = filters.accountIds != null && filters.accountIds.length > 0;
  let positions = await listPositions(db);
  if (filteringAccounts) {
    const assetIdsInScope = await assetIdsForAccounts(filters.accountIds!, db);
    positions = positions.filter((p) => assetIdsInScope.has(p.position.assetId));
  }

  const totalValue = positions.reduce(
    (acc, p) => acc + (p.valuationEur ?? 0),
    0,
  );

  const assetIds = positions.map((p) => p.position.assetId);
  const contribsInRangeByAsset = new Map<string, number>();
  // Per-asset map: ISO date → Σ -cashImpactEur of trades on that date.
  const contribDeltasByAsset = new Map<string, Map<string, number>>();
  // Per-asset: Σ -cashImpactEur of trades dated BEFORE the range start.
  const investedBeforeRangeByAsset = new Map<string, number>();

  // Bulk-load valuations within the range for sparkline + range P/L.
  const start = rangeStart(filters.range);
  const startIso = start ? toIsoDate(start) : null;
  const todayIso = toIsoDate(new Date());
  const startMs = start ? start.getTime() : null;

  if (assetIds.length > 0) {
    const txRows = await db
      .select({
        assetId: assetTransactions.assetId,
        tradedAt: assetTransactions.tradedAt,
        cashImpactEur: assetTransactions.cashImpactEur,
      })
      .from(assetTransactions)
      .where(inArray(assetTransactions.assetId, assetIds))
      .all();
    for (const r of txRows) {
      if (startMs !== null && r.tradedAt >= startMs) {
        contribsInRangeByAsset.set(
          r.assetId,
          (contribsInRangeByAsset.get(r.assetId) ?? 0) - r.cashImpactEur,
        );
      }
      // Accumulate per-day deltas and pre-range running invested.
      const tradedIso = toIsoDate(new Date(r.tradedAt));
      const deltas =
        contribDeltasByAsset.get(r.assetId) ?? new Map<string, number>();
      deltas.set(tradedIso, (deltas.get(tradedIso) ?? 0) - r.cashImpactEur);
      contribDeltasByAsset.set(r.assetId, deltas);
      if (startIso && tradedIso < startIso) {
        investedBeforeRangeByAsset.set(
          r.assetId,
          (investedBeforeRangeByAsset.get(r.assetId) ?? 0) - r.cashImpactEur,
        );
      }
    }
  }

  // Per-asset start value (nearest valuation <= startIso). If a position
  // didn't exist yet before the range began, start value is 0.
  const startValueByAsset = new Map<string, number>();
  if (startIso && assetIds.length > 0) {
    for (const assetId of assetIds) {
      const before = await db
        .select()
        .from(assetValuations)
        .where(
          and(
            eq(assetValuations.assetId, assetId),
            lte(assetValuations.valuationDate, startIso),
          ),
        )
        .orderBy(desc(assetValuations.valuationDate))
        .limit(1)
        .get();
      if (before) startValueByAsset.set(assetId, before.marketValueEur);
    }
  }

  const valuationsByAsset = new Map<
    string,
    Array<{
      date: string;
      valueEur: number;
      investedEur: number;
      unitPriceEur: number;
    }>
  >();
  if (assetIds.length > 0) {
    const conds = [
      inArray(assetValuations.assetId, assetIds),
      lte(assetValuations.valuationDate, todayIso),
    ];
    if (startIso) conds.push(gte(assetValuations.valuationDate, startIso));
    const vRows = await db
      .select()
      .from(assetValuations)
      .where(and(...conds))
      .orderBy(asc(assetValuations.valuationDate))
      .all();
    // Per-asset running invested: starts at the pre-range cumulative, and
    // picks up trade-day deltas as we walk ordered valuations.
    const runningInvestedByAsset = new Map<string, number>();
    for (const assetId of assetIds) {
      runningInvestedByAsset.set(
        assetId,
        investedBeforeRangeByAsset.get(assetId) ?? 0,
      );
    }
    for (const v of vRows) {
      const deltas = contribDeltasByAsset.get(v.assetId);
      if (deltas && deltas.has(v.valuationDate)) {
        runningInvestedByAsset.set(
          v.assetId,
          (runningInvestedByAsset.get(v.assetId) ?? 0) +
            (deltas.get(v.valuationDate) ?? 0),
        );
      }
      const list = valuationsByAsset.get(v.assetId) ?? [];
      list.push({
        date: v.valuationDate,
        valueEur: v.marketValueEur,
        investedEur: runningInvestedByAsset.get(v.assetId) ?? 0,
        unitPriceEur: v.unitPriceEur,
      });
      valuationsByAsset.set(v.assetId, list);
    }
  }

  const enriched: TopPositionRow[] = positions.map((p) => {
    const valuationEur = p.valuationEur ?? 0;
    const weight = totalValue > 0 ? valuationEur / totalValue : 0;
    const costBasisEur = p.position.totalCostEur;
    const sparkline = valuationsByAsset.get(p.position.assetId) ?? [];

    let pnlEur: number | null = null;
    let pnlPct: number | null = null;
    if (p.valuationEur != null) {
      if (filters.range === "ALL") {
        pnlEur = p.valuationEur - costBasisEur;
        pnlPct = costBasisEur > 0 ? pnlEur / costBasisEur : null;
      } else {
        const startValue = startValueByAsset.get(p.position.assetId) ?? 0;
        const contributions =
          contribsInRangeByAsset.get(p.position.assetId) ?? 0;
        pnlEur = p.valuationEur - startValue - contributions;
        const base = startValue + Math.max(contributions, 0);
        pnlPct = base > 0 ? pnlEur / base : null;
      }
    }

    return {
      position: p,
      weight,
      pnlEur,
      pnlPct,
      unitPriceEur: p.valuation?.unitPriceEur ?? null,
      averageCostEur: p.position.averageCost,
      sparkline,
    };
  });

  return enriched
    .filter((r) => r.position.position.quantity > 0)
    .sort((a, b) => (b.position.valuationEur ?? 0) - (a.position.valuationEur ?? 0))
    .slice(0, limit);
}


