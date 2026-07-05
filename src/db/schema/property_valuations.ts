import { real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol } from "./_shared";
import { properties } from "./properties";

/**
 * Valoraciones manuales fechadas (tasación, reforma). Valor vigente a
 * fecha F = última valoración ≤ F; sin ninguna ⇒ purchasePriceEur.
 */
export const propertyValuations = sqliteTable(
  "property_valuations",
  {
    id: idCol(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    valuationDate: text("valuation_date").notNull(), // ISO yyyy-MM-dd
    valueEur: real("value_eur").notNull(),
    note: text("note"),
    createdAt: createdAtCol(),
  },
  (t) => ({
    propertyDateIdx: uniqueIndex("property_valuations_property_date_idx").on(
      t.propertyId,
      t.valuationDate,
    ),
  }),
);

export type PropertyValuation = typeof propertyValuations.$inferSelect;
export type NewPropertyValuation = typeof propertyValuations.$inferInsert;
