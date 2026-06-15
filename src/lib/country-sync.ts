import { eq, and, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import type { DB } from "../db/client";
import { assetCountryWeightings, assets } from "../db/schema";
import { COMMODITY_SUBTYPE } from "./sectors";
import type { CountryWeight } from "./pricing";

export type CountryClient = {
  /** Full geographic breakdown for a fund, keyed by its ISIN. */
  fetchCountryWeightings: (isin: string) => Promise<CountryWeight[]>;
};

export type CountrySyncError = {
  assetId?: string;
  isin?: string;
  message: string;
};

export type CountrySyncSummary = {
  refreshed: number;
  skipped: number;
  errors: CountrySyncError[];
};

/** Only baskets carry a geographic breakdown. Individual stocks, crypto and
 *  bonds have no JustETF fund page — the read layer buckets them instead. */
const COUNTRY_ASSET_TYPES = ["etf", "fund"] as const;

/** Country composition barely moves and JustETF itself publishes it as a
 *  monthly snapshot; refresh every 30 days. The cron runs daily but this
 *  freshness gate keeps it idempotent within (and well beyond) a day. */
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export async function syncCountryWeightings(
  db: DB,
  client: CountryClient,
  now: number,
  opts: { staleAfterMs?: number } = {},
): Promise<CountrySyncSummary> {
  const staleAfterMs = opts.staleAfterMs ?? STALE_AFTER_MS;
  const summary: CountrySyncSummary = { refreshed: 0, skipped: 0, errors: [] };

  const targets = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.isActive, true),
        inArray(assets.assetType, COUNTRY_ASSET_TYPES as unknown as string[]),
      ),
    )
    .all();

  for (const asset of targets) {
    // Commodity ETPs (e.g. physical gold) have no equity geography — the read
    // layer buckets them as "Materias primas". Skip the doomed JustETF call.
    if (asset.subtype === COMMODITY_SUBTYPE) continue;

    const isin = asset.isin?.trim();
    if (!isin) {
      summary.errors.push({ assetId: asset.id, message: "no ISIN set" });
      continue;
    }

    const existing = await db
      .select()
      .from(assetCountryWeightings)
      .where(eq(assetCountryWeightings.assetId, asset.id))
      .all();
    const newestFetchedAt = existing.reduce((m, r) => Math.max(m, r.fetchedAt), 0);
    if (existing.length > 0 && now - newestFetchedAt < staleAfterMs) {
      summary.skipped++;
      continue;
    }

    try {
      const weights = await client.fetchCountryWeightings(isin);
      // Snapshot replace: drop the previous breakdown so a country that fell
      // out of the fund doesn't linger. Tiny per asset; not worth a tx.
      await db
        .delete(assetCountryWeightings)
        .where(eq(assetCountryWeightings.assetId, asset.id))
        .run();
      for (const w of weights) {
        if (!(w.weight > 0)) continue;
        await db
          .insert(assetCountryWeightings)
          .values({
            id: ulid(),
            assetId: asset.id,
            country: w.country,
            weight: w.weight,
            source: "justetf",
            fetchedAt: now,
            createdAt: now,
          })
          .run();
      }
      summary.refreshed++;
    } catch (err) {
      summary.errors.push({
        assetId: asset.id,
        isin,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
