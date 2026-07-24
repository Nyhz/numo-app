import { asc, eq, inArray } from "drizzle-orm";
import { db as defaultDb, type DB } from "../../db/client";
import { taxLotConsumptions, taxLots, taxWashSaleAdjustments } from "../../db/schema";

/**
 * Lectura de lotes FIFO abiertos de un activo. Este módulo es READ-ONLY:
 * la escritura de lotes vive exclusivamente en `lots.ts`
 * (`recomputeLotsForAsset`, tx-scoped).
 */

export type OpenLotRow = {
  lotId: string;
  accountId: string;
  acquiredAt: number;
  /** Unidades en la fecha de adquisición (dato histórico, pre-splits). */
  originalQty: number;
  /** Unidades vivas actuales (post-splits). */
  remainingQty: number;
  /** Base fiscal restante exacta: gross + fees + pérdidas diferidas
   *  integradas − coste ya consumido por ventas parciales. */
  remainingCostEur: number;
  /** Porción de pérdida diferida (antiaplicación) aún viva en la base. */
  deferredLossAddedEur: number;
};

const EPS = 1e-9;

/**
 * Lotes abiertos en orden FIFO. La base restante NO puede derivarse con el
 * ratio `remainingQty/originalQty`: `remainingQty` está en unidades
 * post-split y `originalQty` en unidades históricas, así que un canje N:M
 * rompería el prorrateo. En su lugar se reconstruye exactamente como la
 * mantiene el motor: coste íntegro + diferidos totales − consumos rounded
 * (el residuo de redondeo permanece en el lote hasta el drenaje final).
 */
export async function getOpenLots(assetId: string, db: DB = defaultDb): Promise<OpenLotRow[]> {
  const lots = await db
    .select()
    .from(taxLots)
    .where(eq(taxLots.assetId, assetId))
    .orderBy(asc(taxLots.acquiredAt), asc(taxLots.id))
    .all();
  const open = lots.filter((l) => l.remainingQty > EPS);
  if (open.length === 0) return [];

  const lotIds = open.map((l) => l.id);
  const consumed = await db
    .select({ lotId: taxLotConsumptions.lotId, costBasisEur: taxLotConsumptions.costBasisEur })
    .from(taxLotConsumptions)
    .where(inArray(taxLotConsumptions.lotId, lotIds))
    .all();
  const deferred = await db
    .select({
      lotId: taxWashSaleAdjustments.absorbingLotId,
      disallowedLossEur: taxWashSaleAdjustments.disallowedLossEur,
    })
    .from(taxWashSaleAdjustments)
    .where(inArray(taxWashSaleAdjustments.absorbingLotId, lotIds))
    .all();

  const consumedByLot = new Map<string, number>();
  for (const c of consumed) {
    consumedByLot.set(c.lotId, (consumedByLot.get(c.lotId) ?? 0) + c.costBasisEur);
  }
  const deferredByLot = new Map<string, number>();
  for (const d of deferred) {
    deferredByLot.set(d.lotId, (deferredByLot.get(d.lotId) ?? 0) + d.disallowedLossEur);
  }

  return open.map((l) => ({
    lotId: l.id,
    accountId: l.accountId,
    acquiredAt: l.acquiredAt,
    originalQty: l.originalQty,
    remainingQty: l.remainingQty,
    remainingCostEur:
      l.grossCostEur +
      l.feesEur +
      (deferredByLot.get(l.id) ?? 0) -
      (consumedByLot.get(l.id) ?? 0),
    deferredLossAddedEur: l.deferredLossAddedEur,
  }));
}
