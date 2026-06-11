import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { priceHistory } from "../db/schema";
import { benchmarkByKey, type BenchmarkKey } from "../lib/benchmarks";

export type BenchmarkSeries = {
  key: BenchmarkKey;
  label: string;
  colorVar: string;
  /** Index anchored at 100 on the first portfolio date with a known close —
   *  same anchor as the portfolio's TWR line, so the lines are comparable.
   *  Dates before the benchmark's first close are absent. */
  indexByDate: Record<string, number>;
};

/** Read-only: assumes history is already backfilled (activateBenchmark runs
 *  on toggle, the cron refreshes nightly). Missing history just yields a
 *  shorter or empty line — never an error. */
export async function getBenchmarkSeries(
  keys: readonly BenchmarkKey[],
  dates: readonly string[],
  db: DB = defaultDb,
): Promise<BenchmarkSeries[]> {
  if (keys.length === 0 || dates.length === 0) return [];
  const firstIso = dates[0];
  const lastIso = dates[dates.length - 1];

  const out: BenchmarkSeries[] = [];
  for (const key of keys) {
    const bench = benchmarkByKey(key);
    if (!bench) continue;

    // Closes inside the window plus the nearest one before it (the anchor
    // when the window starts on a non-trading day).
    const prior = db
      .select()
      .from(priceHistory)
      .where(
        and(eq(priceHistory.symbol, bench.symbol), lte(priceHistory.pricedDateUtc, firstIso)),
      )
      .orderBy(asc(priceHistory.pricedDateUtc))
      .all()
      .at(-1);
    const rows = db
      .select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.symbol, bench.symbol),
          gte(priceHistory.pricedDateUtc, firstIso),
          lte(priceHistory.pricedDateUtc, lastIso),
        ),
      )
      .orderBy(asc(priceHistory.pricedDateUtc))
      .all();

    const closes = [...(prior ? [prior] : []), ...rows];
    if (closes.length === 0) continue;

    const indexByDate: Record<string, number> = {};
    let anchor: number | null = null;
    let idx = 0;
    let last: number | null = null;
    for (const date of dates) {
      while (idx < closes.length && closes[idx].pricedDateUtc <= date) {
        last = closes[idx].price;
        idx++;
      }
      if (last == null) continue; // before the benchmark's first close
      if (anchor == null) anchor = last;
      indexByDate[date] = (last / anchor) * 100;
    }

    out.push({ key, label: bench.label, colorVar: bench.colorVar, indexByDate });
  }
  return out;
}
