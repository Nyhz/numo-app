import { and, desc, eq, lt, lte } from "drizzle-orm";
import { roundEur } from "../../lib/money";
import { marketEur, type MarketEur } from "../../lib/money-types";
import type { DB } from "../../db/client";
// This module is the ONE sanctioned consumer of asset_valuations inside
// src/server/tax/ (see eslint.config.mjs): Modelo 720/721 declare market
// value at year-end by legal definition. Everything else in the tax engine is
// barred from market tables at lint level.
import { accounts, assets, assetTransactions, assetValuations } from "../../db/schema";

export type YearEndBalance = {
  accountId: string;
  accountName: string | null;
  accountCountry: string | null;
  accountType: string;
  assetId: string;
  assetName: string | null;
  isin: string | null;
  assetClassTax: string | null;
  quantity: number;
  /** Market value at year-end — null when no valuation exists (NEVER silently 0). */
  valueEur: MarketEur | null;
  /** Date of the valuation used, or null when unvalued. */
  valuationDate: string | null;
  priceSource: string | null;
  /** No valuation at all on or before Dec 31 — declared thresholds unreliable. */
  unvalued: boolean;
  /** Valuation exists but is older than YEAR_END_VALUATION_STALE_DAYS before Dec 31. */
  staleValuation: boolean;
};

// A year-end valuation older than this many days before Dec 31 is flagged
// stale on the balance row (audit T5) — the M720 value may be far off.
export const YEAR_END_VALUATION_STALE_DAYS = 10;

export function buildYearEndBalances(db: DB, end: number): YearEndBalance[] {
  const yearEndIso = new Date(end - 86_400_000).toISOString().slice(0, 10);
  const staleCutoffIso = new Date(
    end - (1 + YEAR_END_VALUATION_STALE_DAYS) * 86_400_000,
  ).toISOString().slice(0, 10);
  // An in-progress exercise has no Dec-31 yet — every live price is "older
  // than 10 days before year-end" by construction, so the stale flag would be
  // permanent noise. It only means something once the year has closed.
  const yearClosed = end <= Date.now();

  // Per-account holdings come from the transaction ledger, not residual lots
  // (audit T10): FIFO lot consumption is global across accounts (Spanish
  // homogeneous-values rule), so a sell at broker B can drain lots opened at
  // broker A — but the units still sit at broker A. Custody, which is what
  // M720 declares, is the per-account signed sum of trades.
  const ledgerRows = db
    .select()
    .from(assetTransactions)
    .where(lt(assetTransactions.tradedAt, end))
    .all();
  const byKey = new Map<string, { accountId: string; assetId: string; qty: number }>();
  for (const t of ledgerRows) {
    if (t.transactionType !== "buy" && t.transactionType !== "sell") continue;
    const key = `${t.accountId}::${t.assetId}`;
    const cur = byKey.get(key) ?? { accountId: t.accountId, assetId: t.assetId, qty: 0 };
    cur.qty += (t.transactionType === "buy" ? 1 : -1) * t.quantity;
    byKey.set(key, cur);
  }

  const yearEndBalances: YearEndBalance[] = [];
  for (const entry of byKey.values()) {
    if (entry.qty <= 1e-9) continue;
    const account = db.select().from(accounts).where(eq(accounts.id, entry.accountId)).get();
    const asset = db.select().from(assets).where(eq(assets.id, entry.assetId)).get();
    const valuation = db
      .select()
      .from(assetValuations)
      .where(and(eq(assetValuations.assetId, entry.assetId), lte(assetValuations.valuationDate, yearEndIso)))
      .orderBy(desc(assetValuations.valuationDate))
      .limit(1)
      .get();
    // Audit T4: a missing valuation must surface as unvalued, never as €0 —
    // a silent zero can suppress the 50k/20k M720 declaration triggers.
    yearEndBalances.push({
      accountId: entry.accountId,
      accountName: account?.name ?? null,
      accountCountry: account?.countryCode ?? null,
      accountType: account?.accountType ?? "unknown",
      assetId: entry.assetId,
      assetName: asset?.name ?? null,
      isin: asset?.isin ?? null,
      assetClassTax: asset?.assetClassTax ?? null,
      quantity: entry.qty,
      valueEur: valuation ? marketEur(roundEur(entry.qty * valuation.unitPriceEur)) : null,
      valuationDate: valuation?.valuationDate ?? null,
      priceSource: valuation?.priceSource ?? null,
      unvalued: !valuation,
      staleValuation: yearClosed && valuation != null && valuation.valuationDate < staleCutoffIso,
    });
  }
  return yearEndBalances;
}
