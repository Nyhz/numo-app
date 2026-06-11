import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { DbOrTx } from "../db/client";
import { assetTransactions, priceHistory } from "../db/schema";
import { fetchHistory } from "./pricing";
import type { HistoricalBar } from "./pricing";
import { benchmarkByKey, type BenchmarkKey } from "./benchmarks";
import { toIsoDate } from "./time";

export type HistoryClient = {
  fetchHistory: typeof fetchHistory;
};

export type EnsureBenchmarkSummary = {
  key: BenchmarkKey;
  symbol: string;
  fetched: boolean;
  inserted: number;
  fromIso: string;
  toIso: string;
};

// Coverage slack: Xetra holiday bridges can leave the head a few sessions
// after the requested start, and the freshest close lags on weekends.
const HEAD_SLACK_DAYS = 7;
const TAIL_SLACK_DAYS = 4;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Earliest date the chart can ever need: the oldest trade in the ledger
 *  (the net-worth series never extends before it), with a head buffer so the
 *  anchor date always has a close on or before it. */
function backfillStartIso(db: DbOrTx): string {
  const row = db
    .select({ min: sql<number | null>`min(${assetTransactions.tradedAt})` })
    .from(assetTransactions)
    .get();
  const oldest = row?.min ?? Date.now();
  return addDays(toIsoDate(new Date(oldest)), -HEAD_SLACK_DAYS * 2);
}

/**
 * Make sure `price_history` covers a benchmark from before the first trade
 * up to today. One provider call for the full span when coverage is missing
 * or stale; no network at all when it is fresh — safe to run from the daily
 * cron and from the toggle action alike. Inserts are deduped on the
 * (symbol, date) unique index, so concurrent or repeated runs are idempotent.
 */
export async function ensureBenchmarkHistory(
  db: DbOrTx,
  key: BenchmarkKey,
  client: HistoryClient = { fetchHistory },
): Promise<EnsureBenchmarkSummary> {
  const bench = benchmarkByKey(key);
  if (!bench) throw new Error(`unknown benchmark: ${key}`);

  const fromIso = backfillStartIso(db);
  const todayIso = toIsoDate(new Date());

  const head = db
    .select({ date: priceHistory.pricedDateUtc })
    .from(priceHistory)
    .where(eq(priceHistory.symbol, bench.symbol))
    .orderBy(asc(priceHistory.pricedDateUtc))
    .limit(1)
    .get();
  const tail = db
    .select({ date: priceHistory.pricedDateUtc })
    .from(priceHistory)
    .where(eq(priceHistory.symbol, bench.symbol))
    .orderBy(desc(priceHistory.pricedDateUtc))
    .limit(1)
    .get();

  const headCovered = head != null && head.date <= addDays(fromIso, HEAD_SLACK_DAYS * 2);
  const tailCovered = tail != null && tail.date >= addDays(todayIso, -TAIL_SLACK_DAYS);
  if (headCovered && tailCovered) {
    return { key, symbol: bench.symbol, fetched: false, inserted: 0, fromIso, toIso: todayIso };
  }

  const bars: HistoricalBar[] = await client.fetchHistory(
    bench.symbol,
    new Date(`${fromIso}T00:00:00Z`),
    new Date(`${todayIso}T23:59:59Z`),
  );

  let inserted = 0;
  for (const bar of bars) {
    if (!Number.isFinite(bar.close) || bar.close <= 0) continue;
    const res = db
      .insert(priceHistory)
      .values({
        id: ulid(),
        symbol: bench.symbol,
        pricedAt: new Date(`${bar.date}T17:30:00Z`).getTime(),
        pricedDateUtc: bar.date,
        price: bar.close,
        source: "benchmark-backfill",
      })
      .onConflictDoNothing({
        target: [priceHistory.symbol, priceHistory.pricedDateUtc],
      })
      .run();
    inserted += res.changes;
  }

  return { key, symbol: bench.symbol, fetched: true, inserted, fromIso, toIso: todayIso };
}

/** Daily refresh for benchmarks that have ever been activated (i.e. already
 *  have rows). Never fetches for benchmarks the Commander has not used. */
export async function refreshActiveBenchmarks(
  db: DbOrTx,
  keys: readonly BenchmarkKey[],
  client: HistoryClient = { fetchHistory },
): Promise<EnsureBenchmarkSummary[]> {
  const out: EnsureBenchmarkSummary[] = [];
  for (const key of keys) {
    const bench = benchmarkByKey(key);
    if (!bench) continue;
    const existing = db
      .select({ id: priceHistory.id })
      .from(priceHistory)
      .where(and(eq(priceHistory.symbol, bench.symbol)))
      .limit(1)
      .get();
    if (!existing) continue;
    out.push(await ensureBenchmarkHistory(db, key, client));
  }
  return out;
}
