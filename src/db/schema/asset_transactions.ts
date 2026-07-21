import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts";
import { assets } from "./assets";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

export const assetTransactions = sqliteTable(
  "asset_transactions",
  {
    id: idCol(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    transactionType: text("transaction_type").notNull(),
    tradedAt: integer("traded_at", { mode: "number" }).notNull(),
    settlementDate: integer("settlement_date", { mode: "number" }),
    quantity: real("quantity").notNull(),
    unitPrice: real("unit_price").notNull(),
    tradeCurrency: text("trade_currency").notNull(),
    fxRateToEur: real("fx_rate_to_eur").notNull(),
    // "market-fx" when the EUR value of this trade came from a market daily
    // close (crypto permuta legs) rather than user/broker input. Null = user data.
    valuationBasis: text("valuation_basis"),
    // Provenance of fxRateToEur: unit | explicit | historical | latest.
    // "latest" means a stale fallback rate — surfaced in the UI. Nullable for
    // rows that predate the column.
    fxSource: text("fx_source"),
    tradeGrossAmount: real("trade_gross_amount").notNull(),
    tradeGrossAmountEur: real("trade_gross_amount_eur").notNull(),
    cashImpactEur: real("cash_impact_eur").notNull(),
    feesAmount: real("fees_amount").notNull().default(0),
    feesAmountEur: real("fees_amount_eur").notNull().default(0),
    netAmountEur: real("net_amount_eur").notNull(),
    dividendGross: real("dividend_gross"),
    dividendNet: real("dividend_net"),
    withholdingTax: real("withholding_tax"),
    sourceCountry: text("source_country"),
    isListed: integer("is_listed", { mode: "boolean" }).notNull().default(true),
    // Withholding tax credited to Spanish treasury under a DDI treaty (destino). Counterpart of withholdingTax (origen).
    withholdingTaxDestination: real("withholding_tax_destination"),
    // Solo filas transactionType="split" (split / contra-split N:M):
    // newQty = oldQty × splitNumerator / splitDenominator. Enteros y división
    // al final para exactitud (2250 × 1 / 25 = 90 sin polvo flotante).
    splitNumerator: integer("split_numerator"),
    splitDenominator: integer("split_denominator"),
    linkedTransactionId: text("linked_transaction_id"),
    externalReference: text("external_reference"),
    rowFingerprint: text("row_fingerprint"),
    source: text("source").notNull().default("manual"),
    notes: text("notes"),
    rawPayload: text("raw_payload"),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    accountIdx: index("asset_transactions_account_idx").on(t.accountId),
    assetIdx: index("asset_transactions_asset_idx").on(t.assetId),
    tradedAtIdx: index("asset_transactions_traded_at_idx").on(t.tradedAt),
    fingerprintIdx: uniqueIndex("asset_transactions_fingerprint_idx").on(t.rowFingerprint),
  }),
);

export type AssetTransaction = typeof assetTransactions.$inferSelect;
export type NewAssetTransaction = typeof assetTransactions.$inferInsert;
