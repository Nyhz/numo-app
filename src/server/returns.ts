// Rentabilidad de PRECIO por ventana (1m/3m/6m/YTD/1a) sobre la serie EUR
// canónica: asset_valuations.unitPriceEur, que el sync escribe ya convertida.
// No es money-weighted (los flujos intermedios no entran; para eso está el
// XIRR). La serie existe desde que se posee el activo ⇒ ventana sin baseline
// devuelve null y la UI pinta «—». Cálculo on-read: ~15 activos en SQLite
// local, no merece materialización.

import { asc, inArray } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { assetValuations } from "../db/schema";
import { backAdjustFactor, loadSplitEvents } from "./splitAdjust";
import { toIsoDate } from "../lib/time";

export const RETURN_PERIODS = ["1m", "3m", "6m", "ytd", "1y"] as const;
export type ReturnPeriod = (typeof RETURN_PERIODS)[number];
export type PeriodReturns = Record<ReturnPeriod, number | null>;

const MONTHS_BACK: Record<Exclude<ReturnPeriod, "ytd">, number> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "1y": 12,
};

/** Fecha de corte de la ventana. Baseline = última fila ≤ esta fecha, así los
 *  fines de semana/festivos caen solos al cierre anterior. */
export function periodStartIso(period: ReturnPeriod, todayIso: string): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  if (period === "ytd") return `${y - 1}-12-31`;
  return toIsoDate(new Date(Date.UTC(y, m - 1 - MONTHS_BACK[period], d)));
}

const EMPTY: PeriodReturns = { "1m": null, "3m": null, "6m": null, ytd: null, "1y": null };

export async function getPeriodReturns(
  assetIds: string[],
  db: DB = defaultDb,
  todayIso: string = toIsoDate(new Date()),
): Promise<Map<string, PeriodReturns>> {
  const out = new Map<string, PeriodReturns>();
  if (assetIds.length === 0) return out;
  for (const id of assetIds) out.set(id, { ...EMPTY });

  const rows = await db
    .select({
      assetId: assetValuations.assetId,
      valuationDate: assetValuations.valuationDate,
      unitPriceEur: assetValuations.unitPriceEur,
    })
    .from(assetValuations)
    .where(inArray(assetValuations.assetId, assetIds))
    .orderBy(asc(assetValuations.valuationDate))
    .all();

  // Retro-ajuste por splits: sin él, la ventana que cruza un canje mediría
  // el salto ×(M/N) del precio crudo como retorno.
  const splitsByAsset = loadSplitEvents(db, assetIds);

  const byAsset = new Map<string, { date: string; price: number }[]>();
  for (const r of rows) {
    if (r.valuationDate > todayIso) continue;
    const list = byAsset.get(r.assetId) ?? [];
    list.push({
      date: r.valuationDate,
      price:
        r.unitPriceEur *
        backAdjustFactor(splitsByAsset.get(r.assetId), r.valuationDate),
    });
    byAsset.set(r.assetId, list);
  }

  for (const [assetId, series] of byAsset) {
    if (series.length === 0) continue;
    const latest = series[series.length - 1];
    if (!(latest.price > 0)) continue;
    const returns = out.get(assetId)!;
    for (const period of RETURN_PERIODS) {
      const cutoff = periodStartIso(period, todayIso);
      // Última fila ≤ cutoff (serie ya ordenada asc; ISO ordena cronológico).
      let baseline: { date: string; price: number } | null = null;
      for (const point of series) {
        if (point.date > cutoff) break;
        baseline = point;
      }
      if (!baseline || !(baseline.price > 0) || baseline.date === latest.date) continue;
      returns[period] = latest.price / baseline.price - 1;
    }
  }
  return out;
}
