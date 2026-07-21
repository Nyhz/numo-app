import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { assetTransactions } from "../db/schema";
import { splitFactorOf } from "../lib/domain";
import { toIsoDate } from "../lib/time";

/**
 * Retro-ajuste de series de PRECIO unitario por splits/contra-splits.
 *
 * El valor de mercado (quantity × price) es continuo a través de un canje,
 * pero el precio unitario crudo salta ×(M/N) el día efectivo — cualquier
 * gráfica o retorno calculado sobre `unitPriceEur` sin ajustar muestra un
 * escalón irreal. La convención es la estándar de mercado (back-adjust):
 * los precios ANTERIORES al canje se expresan en unidades post-canje
 * multiplicando por M/N; los del día efectivo en adelante ya lo están.
 */
export type SplitEvent = {
  /** Día efectivo (ISO) — la fila split vive a las 00:00 UTC de ese día, así
   *  que la valoración de esa fecha ya es post-canje. */
  effectiveIso: string;
  numerator: number;
  denominator: number;
};

/** Canjes por activo en orden cronológico. Solo aparecen activos con splits. */
export function loadSplitEvents(
  db: DbOrTx,
  assetIds: string[],
): Map<string, SplitEvent[]> {
  const out = new Map<string, SplitEvent[]>();
  if (assetIds.length === 0) return out;
  const rows = db
    .select({
      assetId: assetTransactions.assetId,
      tradedAt: assetTransactions.tradedAt,
      splitNumerator: assetTransactions.splitNumerator,
      splitDenominator: assetTransactions.splitDenominator,
    })
    .from(assetTransactions)
    .where(
      and(
        inArray(assetTransactions.assetId, assetIds),
        eq(assetTransactions.transactionType, "split"),
      ),
    )
    .orderBy(asc(assetTransactions.tradedAt), asc(assetTransactions.id))
    .all();
  for (const r of rows) {
    const factor = splitFactorOf(r);
    if (!factor) continue;
    const list = out.get(r.assetId) ?? [];
    list.push({
      effectiveIso: toIsoDate(new Date(r.tradedAt)),
      numerator: factor.numerator,
      denominator: factor.denominator,
    });
    out.set(r.assetId, list);
  }
  return out;
}

/** Factor que convierte un precio unitario fechado en `dateIso` a unidades
 *  post-canje actuales: Π M/N de los canjes con día efectivo posterior a la
 *  fecha. 1 si no hay canjes posteriores (o no hay canjes). */
export function backAdjustFactor(
  splits: SplitEvent[] | undefined,
  dateIso: string,
): number {
  if (!splits || splits.length === 0) return 1;
  let factor = 1;
  for (const s of splits) {
    if (dateIso < s.effectiveIso) factor *= s.denominator / s.numerator;
  }
  return factor;
}
