import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

/** Categories of the foral informational declarations: the two M720 asset
 *  categories plus crypto (M721). Values match `Model720Block["type"]`. */
export const DECLARED_BASELINE_CATEGORIES = [
  "broker-securities",
  "bank-accounts",
  "crypto",
] as const;

export type DeclaredBaselineCategory = (typeof DECLARED_BASELINE_CATEGORIES)[number];

/**
 * Manually-recorded filed declarations (M720/M721) made OUTSIDE the app's
 * seal flow — e.g. years filed before the app existed, or filed with a
 * different Hacienda. The amount is the joint category value declared, which
 * is the figure the art. 42 bis/ter €20k re-declaration delta is measured
 * against. One row per (ejercicio, category).
 */
export const taxDeclaredBaselines = sqliteTable(
  "tax_declared_baselines",
  {
    id: idCol(),
    /** Ejercicio the filed declaration referred to — NOT the filing year
     *  (the M720 for ejercicio 2025 is filed in Q1 2026 but stores 2025). */
    year: integer("year", { mode: "number" }).notNull(),
    category: text("category", { enum: DECLARED_BASELINE_CATEGORIES }).notNull(),
    /** Joint category value declared — the forms are EUR-denominated. */
    amountEur: real("amount_eur").notNull(),
    notes: text("notes"),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    yearCategoryIdx: uniqueIndex("tax_declared_baselines_year_category_idx").on(
      t.year,
      t.category,
    ),
  }),
);

export type TaxDeclaredBaseline = typeof taxDeclaredBaselines.$inferSelect;
export type NewTaxDeclaredBaseline = typeof taxDeclaredBaselines.$inferInsert;
