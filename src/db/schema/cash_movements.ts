import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

export const accountCashMovements = sqliteTable(
  "account_cash_movements",
  {
    id: idCol(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    movementType: text("movement_type").notNull(),
    occurredAt: integer("occurred_at", { mode: "number" }).notNull(),
    valueDate: integer("value_date", { mode: "number" }),
    nativeAmount: real("native_amount").notNull(),
    currency: text("currency").notNull(),
    fxRateToEur: real("fx_rate_to_eur").notNull(),
    // Provenance of fxRateToEur — see asset_transactions.fxSource.
    fxSource: text("fx_source"),
    cashImpactEur: real("cash_impact_eur").notNull(),
    // Retención practicada en EUR (solo movimientos `interest`): el banco abona
    // el neto; el bruto fiscal (RCM) es cashImpactEur + withholdingTaxEur y la
    // retención cuenta como pago a cuenta en la cuota.
    withholdingTaxEur: real("withholding_tax_eur"),
    externalReference: text("external_reference"),
    rowFingerprint: text("row_fingerprint"),
    source: text("source").notNull().default("manual"),
    description: text("description"),
    affectsCashBalance: integer("affects_cash_balance", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    accountIdx: index("account_cash_movements_account_idx").on(t.accountId),
    occurredAtIdx: index("account_cash_movements_occurred_at_idx").on(t.occurredAt),
    fingerprintIdx: uniqueIndex("account_cash_movements_fingerprint_idx").on(t.rowFingerprint),
  }),
);

export type AccountCashMovement = typeof accountCashMovements.$inferSelect;
export type NewAccountCashMovement = typeof accountCashMovements.$inferInsert;
