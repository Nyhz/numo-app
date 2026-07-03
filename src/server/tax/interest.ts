import { and, eq, gte, lt } from "drizzle-orm";
import { db as defaultDb, type DB } from "../../db/client";
import { accountCashMovements } from "../../db/schema";

import type { TaxInterest } from "./cuota";

// El tipo y ZERO_INTEREST viven en cuota.ts (módulo puro, sin DB) para que los
// consumidores client-side no arrastren better-sqlite3; se re-exportan aquí.
export { ZERO_INTEREST, type TaxInterest } from "./cuota";

export function getInterestForYearSync(year: number, db: DB = defaultDb): TaxInterest {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const rows = db
    .select()
    .from(accountCashMovements)
    .where(
      and(
        eq(accountCashMovements.movementType, "interest"),
        gte(accountCashMovements.occurredAt, start),
        lt(accountCashMovements.occurredAt, end),
      ),
    )
    .all();
  // La banca abona el NETO (cashImpactEur); el bruto fiscal re-añade la
  // retención registrada en el movimiento. Sin retención registrada, el
  // importe abonado se trata como bruto (convención previa, sin retención).
  let gross = 0;
  let withholding = 0;
  for (const r of rows) {
    gross += r.cashImpactEur + (r.withholdingTaxEur ?? 0);
    withholding += r.withholdingTaxEur ?? 0;
  }
  return { grossEur: gross, withholdingEur: withholding };
}

export async function getInterestForYear(year: number, db: DB = defaultDb): Promise<TaxInterest> {
  return getInterestForYearSync(year, db);
}
