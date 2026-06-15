import { db } from "../../../../db/client";
import { BENCHMARK_KEYS } from "../../../../lib/benchmarks";
import { refreshActiveBenchmarks } from "../../../../lib/benchmark-sync";
import {
  fetchHistory,
  fetchSectorWeightings,
  fetchAssetSector,
  fetchCountryWeightings,
  yahooProvider,
  coingeckoProvider,
} from "../../../../lib/pricing";
import { withRetry } from "../../../../lib/pricing/_net";
import { syncPrices } from "../../../../lib/price-sync";
import { syncSectorWeightings } from "../../../../lib/sector-sync";
import { syncCountryWeightings } from "../../../../lib/country-sync";

// Audit R3: single-process in-flight guard. Two overlapping cron hits would
// interleave at await points between existence checks and writes; the second
// caller gets a 409 instead.
let running = false;

async function handle(req: Request): Promise<Response> {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || !secret || secret !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (running) {
    return Response.json(
      { ok: false, error: "sync already running" },
      { status: 409 },
    );
  }
  running = true;
  try {
    const summary = await syncPrices(db, {
      // Cron path: transient provider failures retry with backoff (audit R1).
      yahoo: { fetchQuote: (s) => withRetry(() => yahooProvider.fetchQuote(s)) },
      coingecko: { fetchQuote: (s) => withRetry(() => coingeckoProvider.fetchQuote(s)) },
    });
    // Benchmarks the Commander has activated at least once keep their price
    // history fresh alongside the asset sync; never-activated ones are free.
    const benchmarks = await refreshActiveBenchmarks(db, BENCHMARK_KEYS, {
      fetchHistory: (s, from, to) => withRetry(() => fetchHistory(s, from, to)),
    });
    // Sector composition for ETFs/funds. Weekly-fresh (see sector-sync), so on
    // most daily runs every asset is skipped — cheap to call unconditionally.
    const sectors = await syncSectorWeightings(
      db,
      {
        fetchSectorWeightings: (s) =>
          withRetry(() => fetchSectorWeightings(s)),
        fetchAssetSector: (s) => withRetry(() => fetchAssetSector(s)),
      },
      Date.now(),
    );
    // Geographic composition for ETFs/funds (JustETF, keyed by ISIN).
    // Monthly-fresh (see country-sync), so most daily runs skip every asset.
    const countries = await syncCountryWeightings(
      db,
      {
        fetchCountryWeightings: (isin) =>
          withRetry(() => fetchCountryWeightings(isin)),
      },
      Date.now(),
    );
    return Response.json({ ok: true, summary, benchmarks, sectors, countries });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    running = false;
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
