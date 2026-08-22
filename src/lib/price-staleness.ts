// Regla de frescura del catch-up de arranque (scripts/catchup-prices.ts).
// El cron diario de las 23:00 Madrid estampa price_history.pricedDateUtc con
// la fecha UTC del run, que a esa hora coincide siempre con la fecha Madrid —
// en un sistema sano max(pricedDateUtc) es hoy o ayer en días Madrid.
// Cualquier cosa anterior delata al menos un cron perdido (host caído).

import { DAY_MS, madridDateIso } from "./time";

/** True cuando el último cierre almacenado es anterior a ayer (Madrid), es
 *  decir, el host se saltó al menos un sync de las 23:00. `null` (BD sin
 *  precios) no es stale: no hay nada que recuperar y el arranque fresh-DB
 *  debe seguir silencioso, sin salir a red. */
export function isPriceHistoryStale(
  maxPricedDateUtc: string | null,
  nowMsUtc: number,
): boolean {
  if (maxPricedDateUtc == null) return false;
  return maxPricedDateUtc < madridDateIso(nowMsUtc - DAY_MS);
}
