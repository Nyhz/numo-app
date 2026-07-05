import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";
import { properties } from "./properties";

export const RATE_TYPES = ["fixed", "variable", "mixed"] as const;
export type RateType = (typeof RATE_TYPES)[number];

/**
 * 0..1 hipoteca por inmueble (v1). El cuadro de amortización NUNCA se
 * persiste: se deriva de esta fila + mortgage_events (src/lib/mortgage.ts).
 * El tipo es TIN (nominal); la TAE queda fuera a propósito.
 */
export const mortgages = sqliteTable(
  "mortgages",
  {
    id: idCol(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    lender: text("lender"),
    principalEur: real("principal_eur").notNull(),
    rateType: text("rate_type").notNull().$type<RateType>(),
    nominalRatePct: real("nominal_rate_pct").notNull(),
    termMonths: integer("term_months", { mode: "number" }).notNull(),
    firstPaymentDate: text("first_payment_date").notNull(), // ISO yyyy-MM-dd
    spreadPct: real("spread_pct"),
    referenceIndex: text("reference_index"),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    propertyIdx: index("mortgages_property_idx").on(t.propertyId),
  }),
);

export type Mortgage = typeof mortgages.$inferSelect;
export type NewMortgage = typeof mortgages.$inferInsert;
