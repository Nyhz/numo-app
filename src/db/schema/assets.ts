import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";
import { objectives } from "./objectives";

export const assets = sqliteTable(
  "assets",
  {
    id: idCol(),
    name: text("name").notNull(),
    assetType: text("asset_type").notNull(),
    subtype: text("subtype"),
    symbol: text("symbol"),
    ticker: text("ticker"),
    isin: text("isin"),
    exchange: text("exchange"),
    providerSymbol: text("provider_symbol"),
    currency: text("currency").notNull().default("EUR"),
    /** Total Expense Ratio as an annual percentage (e.g. 0.22 = 0.22%/year).
     *  Manual entry per fund/ETF; null for instruments without a TER (stocks,
     *  crypto). Drives the estimated annual cost in the Costes card. */
    ter: real("ter"),
    assetClassTax: text("asset_class_tax"),
    /** Allocation bucket this asset's value counts toward (Objetivos page).
     *  Per-asset on purpose — aggregates the same exposure across brokers. */
    objectiveId: text("objective_id").references(() => objectives.id, {
      onDelete: "set null",
    }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    notes: text("notes"),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    isinIdx: uniqueIndex("assets_isin_idx").on(t.isin),
  }),
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
