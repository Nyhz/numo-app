import { index, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol } from "./_shared";
import { mortgages } from "./mortgages";

export const MORTGAGE_EVENT_TYPES = ["early_repayment", "rate_change"] as const;
export type MortgageEventType = (typeof MORTGAGE_EVENT_TYPES)[number];

export const EARLY_REPAYMENT_MODES = ["reduce_term", "reduce_installment"] as const;
export type EarlyRepaymentMode = (typeof EARLY_REPAYMENT_MODES)[number];

/**
 * Historial auditable de la hipoteca. Cada evento recalcula el cuadro
 * desde su fecha. early_repayment exige amountEur+mode; rate_change
 * exige newRatePct (revisión Euríbor / novación).
 */
export const mortgageEvents = sqliteTable(
  "mortgage_events",
  {
    id: idCol(),
    mortgageId: text("mortgage_id")
      .notNull()
      .references(() => mortgages.id, { onDelete: "cascade" }),
    eventDate: text("event_date").notNull(), // ISO yyyy-MM-dd
    type: text("type").notNull().$type<MortgageEventType>(),
    amountEur: real("amount_eur"),
    mode: text("mode").$type<EarlyRepaymentMode>(),
    newRatePct: real("new_rate_pct"),
    note: text("note"),
    createdAt: createdAtCol(),
  },
  (t) => ({
    mortgageIdx: index("mortgage_events_mortgage_idx").on(t.mortgageId, t.eventDate),
  }),
);

export type MortgageEvent = typeof mortgageEvents.$inferSelect;
export type NewMortgageEvent = typeof mortgageEvents.$inferInsert;
