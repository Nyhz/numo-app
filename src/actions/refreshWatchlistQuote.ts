"use server";

import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { assets, watchlistQuotes } from "../db/schema";
import { providerForAsset } from "../lib/pricing";
import { withRetry } from "../lib/pricing/_net";
import { priceSymbolForAsset } from "../lib/price-sync";
import { type ActionResult, revalidateWatchlist } from "./_shared";

const schema = z.object({ assetId: z.string().min(1) });

// On-demand single-asset quote refresh. Fired right after an asset is starred so
// its card shows a price immediately instead of waiting for the next 5-min cron
// tick. Best-effort and network-bound: it lives outside the DB-only toggle action
// (and is not exercised by unit tests, per the no-network-in-tests rule). Like
// the cron, it writes ONLY the intraday cache — never `price_history`.
export async function refreshWatchlistQuote(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ refreshed: boolean }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Datos no válidos" } };
  }

  const { assetId } = parsed.data;
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) {
    return { ok: false, error: { code: "not_found", message: "activo no encontrado" } };
  }
  // Resolve the symbol under the asset's EFFECTIVE provider (priceSource
  // override or by-type default) — resolving with the default Yahoo-style
  // symbol and then fetching from a different provider (e.g. `tradingview`)
  // guarantees a miss, since e.g. a TV symbol like `BME:AMP` doesn't exist
  // in Yahoo's namespace and vice versa.
  const provider = providerForAsset(asset);
  const symbol = priceSymbolForAsset(asset);
  if (!symbol) {
    // Nothing to fetch (no provider symbol) — not an error, just no quote.
    return { ok: true, data: { refreshed: false } };
  }

  try {
    const quote = await withRetry(() => provider.fetchQuote(symbol));
    const now = Date.now();
    db.insert(watchlistQuotes)
      .values({
        id: ulid(),
        assetId,
        price: quote.price,
        currency: quote.currency,
        asOf: quote.asOf.getTime(),
        source: provider.name,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: watchlistQuotes.assetId,
        set: {
          prevPrice: sql`${watchlistQuotes.price}`,
          price: quote.price,
          currency: quote.currency,
          asOf: quote.asOf.getTime(),
          source: provider.name,
          updatedAt: now,
        },
      })
      .run();
    revalidateWatchlist();
    return { ok: true, data: { refreshed: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: { code: "db", message } };
  }
}
