import { and, asc, eq, gte } from "drizzle-orm";
import { ulid } from "ulid";
import type { DbOrTx } from "../db/client";
import {
  assetTransactions,
  assetValuations,
  assets,
  fxRates,
  priceHistory,
} from "../db/schema";
import { applySplitFactor, splitFactorOf } from "../lib/domain";
import { round } from "../lib/money";
import { invalidateDailyBalancesFrom } from "./dailyBalances";
import { priceSymbolForAsset } from "../lib/price-sync";
import { DAY_MS, isWeekday, toIsoDate } from "../lib/time";


function iterDays(fromIso: string, toIso: string, everyDay: boolean): string[] {
  const out: string[] = [];
  const end = new Date(`${toIso}T12:00:00Z`).getTime();
  for (
    let t = new Date(`${fromIso}T12:00:00Z`).getTime();
    t <= end;
    t += DAY_MS
  ) {
    const iso = toIsoDate(new Date(t));
    if (everyDay || isWeekday(iso)) out.push(iso);
  }
  return out;
}

/**
 * Rebuild every `asset_valuations` row for a single asset from scratch,
 * using:
 *
 *  - `asset_transactions`  → per-day held quantity
 *  - `price_history`       → native unit price per day (Yahoo / CoinGecko)
 *  - `fx_rates`            → daily EUR conversion rate per currency (Yahoo)
 *
 * FX policy: the trade-time `fxRateToEur` stamped on each transaction is
 * authoritative for cost basis / tax (it's what the broker actually
 * charged you) but NOT used for valuation. For the daily portfolio curve
 * we want the market EUR/USD, which moves every day — so we read from
 * `fx_rates`. Weekends/holidays carry the last weekday's rate because the
 * FX market is closed; this is not a "prior transaction" fallback.
 *
 * The rebuild is idempotent — all existing rows for the asset are wiped
 * before repopulating.
 */
export function rebuildValuationsForAsset(
  tx: DbOrTx,
  assetId: string,
  fromIso?: string,
): void {
  // La curva diaria materializada deriva de estas valoraciones: invalidarla
  // (delete-forward) ANTES de reescribirlas. El lector de la home detecta el
  // hueco y computa en vivo hasta que el cron nocturno la reconstruya.
  invalidateDailyBalancesFrom(tx, fromIso ?? "0000-01-01");

  const asset = tx.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) return;

  const trades = tx
    .select()
    .from(assetTransactions)
    .where(eq(assetTransactions.assetId, assetId))
    .orderBy(asc(assetTransactions.tradedAt))
    .all();
  if (trades.length === 0) {
    // No trades left at all — wipe everything regardless of window.
    tx.delete(assetValuations).where(eq(assetValuations.assetId, assetId)).run();
    return;
  }

  // Audit P1: incremental rebuild. Rows before `fromIso` are untouched (the
  // trades that produced them did not change); only the window from the
  // earliest affected trade date onwards is wiped and recomputed.
  if (fromIso) {
    tx.delete(assetValuations)
      .where(and(eq(assetValuations.assetId, assetId), gte(assetValuations.valuationDate, fromIso)))
      .run();
  } else {
    tx.delete(assetValuations).where(eq(assetValuations.assetId, assetId)).run();
  }

  // Must match the symbol every price writer (sync, backfill, manual) uses —
  // for FT funds that's `ISIN:CURRENCY`, not the plain `symbol` label.
  const symbol = priceSymbolForAsset(asset);
  if (!symbol) return;

  const prices = tx
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.symbol, symbol))
    .orderBy(asc(priceHistory.pricedDateUtc))
    .all();
  if (prices.length === 0) return;

  // FX curve from the daily Yahoo feed (fx_rates). EUR assets need no FX.
  // Rows come sorted by date; weekends carry last-seen weekday rate below.
  const fxCurve: Array<{ iso: string; rate: number }> =
    asset.currency === "EUR"
      ? [{ iso: toIsoDate(new Date(trades[0].tradedAt)), rate: 1 }]
      : tx
          .select()
          .from(fxRates)
          .where(eq(fxRates.currency, asset.currency))
          .orderBy(asc(fxRates.date))
          .all()
          .map((r) => ({ iso: r.date, rate: r.rateToEur }));
  if (fxCurve.length === 0) return;

  const firstTradeIso = toIsoDate(new Date(trades[0].tradedAt));
  const startIso = fromIso && fromIso > firstTradeIso ? fromIso : firstTradeIso;
  const todayIso = toIsoDate(new Date());
  const everyDay = asset.assetType === "crypto";
  const days = iterDays(startIso, todayIso, everyDay);

  let priceIdx = 0;
  let lastPrice: number | null = null;
  let fxIdx = 0;
  let lastFx: number | null = asset.currency === "EUR" ? 1 : null;
  // Trade cursor (audit P1): one forward pass over the ledger instead of a
  // full rescan per day. Trades before the window seed the running quantity
  // when the first day's cursor advance absorbs them.
  let tradeIdx = 0;
  let runningQty = 0;

  const now = Date.now();
  for (const day of days) {
    while (priceIdx < prices.length && prices[priceIdx].pricedDateUtc <= day) {
      lastPrice = prices[priceIdx].price;
      priceIdx++;
    }
    while (fxIdx < fxCurve.length && fxCurve[fxIdx].iso <= day) {
      lastFx = fxCurve[fxIdx].rate;
      fxIdx++;
    }

    const dayEnd = new Date(`${day}T23:59:59Z`).getTime();
    while (tradeIdx < trades.length && trades[tradeIdx].tradedAt <= dayEnd) {
      const t = trades[tradeIdx];
      if (t.transactionType === "buy") runningQty += t.quantity;
      else if (t.transactionType === "sell" || t.transactionType === "transfer_out")
        runningQty -= t.quantity;
      else if (t.transactionType === "split") {
        const factor = splitFactorOf(t);
        if (factor)
          runningQty = applySplitFactor(runningQty, factor.numerator, factor.denominator);
      }
      tradeIdx++;
    }
    if (lastPrice == null || lastFx == null) continue;
    const qty = runningQty;
    if (qty <= 0) continue;

    const unitPriceEur = round(lastPrice * lastFx, 6);
    const marketValueEur = round(unitPriceEur * qty, 2);

    tx.insert(assetValuations)
      .values({
        id: ulid(),
        assetId,
        valuationDate: day,
        quantity: round(qty, 10),
        unitPriceEur,
        marketValueEur,
        priceSource: "rebuilt",
        createdAt: now,
      })
      .run();
  }
}

export function rebuildValuationsForAssets(
  tx: DbOrTx,
  assetIds: Iterable<string>,
  fromIso?: string,
): void {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return;
  for (const id of ids) rebuildValuationsForAsset(tx, id, fromIso);
}
