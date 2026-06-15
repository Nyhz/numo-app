import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol } from "./_shared";
import { assets } from "./assets";

/** Country composition snapshot per asset (ETFs/funds). One row per
 *  (asset, country); `weight` is a fraction 0..1 of the fund's holdings.
 *  Refreshed by the price-sync cron from JustETF's `etf-holdings_countries`
 *  table (keyed by ISIN). Slow-moving data — point-in-time snapshot, no
 *  history. The provider-reported "Other" tail is stored under the `other`
 *  key; value not covered lands in the read layer's unclassified bucket. */
export const assetCountryWeightings = sqliteTable(
  "asset_country_weightings",
  {
    id: idCol(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    country: text("country").notNull(),
    weight: real("weight").notNull(),
    source: text("source").notNull(),
    fetchedAt: integer("fetched_at", { mode: "number" }).notNull(),
    createdAt: createdAtCol(),
  },
  (t) => ({
    assetCountryIdx: uniqueIndex("asset_country_weightings_asset_country_idx").on(
      t.assetId,
      t.country,
    ),
  }),
);

export type AssetCountryWeighting = typeof assetCountryWeightings.$inferSelect;
export type NewAssetCountryWeighting = typeof assetCountryWeightings.$inferInsert;
