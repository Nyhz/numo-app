import { revalidatePath } from "next/cache";
import { db } from "../../../../db/client";
import { yahooProvider, coingeckoProvider, tradingviewProvider } from "../../../../lib/pricing";
import { withRetry } from "../../../../lib/pricing/_net";
import { sendTelegram } from "../../../../lib/advisor/telegram";
import { syncWatchlistQuotes } from "../../../../lib/watchlist-sync";

// Intraday watchlist refresh — separate lane from the daily `sync-prices` cron.
// Triggered every ~15 min by launchd (`com.finances.watchlist-sync`). Writes
// only the intraday quote cache + alert tables; never the daily price history.

// Single-process in-flight guard, mirroring sync-prices (audit R3).
let running = false;

async function handle(req: Request): Promise<Response> {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || !secret || secret !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (process.env.WATCHLIST_SYNC_ENABLED === "false") {
    return Response.json({ ok: true, skipped: "watchlist sync desactivado" });
  }
  if (running) {
    return Response.json({ ok: false, error: "sync already running" }, { status: 409 });
  }
  running = true;
  try {
    const summary = await syncWatchlistQuotes(db, {
      yahoo: { fetchQuotes: (s) => withRetry(() => yahooProvider.fetchQuotes(s)) },
      coingecko: { fetchQuotes: (s) => withRetry(() => coingeckoProvider.fetchQuotes(s)) },
      tradingview: { fetchQuotes: (s) => withRetry(() => tradingviewProvider.fetchQuotes(s)) },
      sendTelegram,
    });
    // A fresh quote or a newly fired alert must surface without a manual reload.
    revalidatePath("/watchlist");
    revalidatePath("/");
    return Response.json({ ok: true, summary });
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
