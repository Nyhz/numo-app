import type { DB } from "../../db/client";
import { taxDeclaredBaselines, type TaxDeclaredBaseline } from "../../db/schema";

/** All manually-recorded filed declarations, newest ejercicio first. */
export function listDeclaredBaselines(db: DB): TaxDeclaredBaseline[] {
  const rows = db.select().from(taxDeclaredBaselines).all();
  rows.sort((a, b) => b.year - a.year || a.category.localeCompare(b.category));
  return rows;
}
