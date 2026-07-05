import { real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

/**
 * Inmuebles en propiedad (vivienda habitual, etc.). Vertical autónoma:
 * sin accountId — no toca caja ni posiciones. El coste de adquisición
 * fiscal (precio + costes) se deriva, no se guarda. Ver spec 2026-07-05.
 */
export const properties = sqliteTable("properties", {
  id: idCol(),
  name: text("name").notNull(),
  address: text("address"),
  purchaseDate: text("purchase_date").notNull(), // ISO yyyy-MM-dd
  purchasePriceEur: real("purchase_price_eur").notNull(),
  purchaseCostsEur: real("purchase_costs_eur").notNull().default(0),
  notes: text("notes"),
  createdAt: createdAtCol(),
  updatedAt: updatedAtCol(),
});

export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;
