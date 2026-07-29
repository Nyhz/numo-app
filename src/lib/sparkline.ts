import { round } from "./money";

export const SPARKLINE_MAX_POINTS = 60;

// Una gráfica de página no gana nada por encima de ~1 punto/px: la serie
// diaria crece sin techo (~30 puntos/mes) y en rango ALL acabaría pesando
// cientos de KB en el payload RSC.
export const MAX_CHART_POINTS = 320;

/** Muestreo uniforme conservando primer y último punto. */
export function decimate<T>(points: T[], max: number = MAX_CHART_POINTS): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round(i * step)]);
  }
  return out;
}

/** Serie de precios cronológica → índice base 100 decimado: lo único que un
 *  sparkline de ~224px puede mostrar. Serializar las series completas con sus
 *  campos auxiliares multiplicaba el payload RSC sin efecto visual. */
export function buildSparkline(
  prices: number[],
  maxPoints: number = SPARKLINE_MAX_POINTS,
): number[] {
  const base = prices.find((p) => p > 0) ?? 0;
  if (base <= 0) return [];
  const indexed = prices.map((p) => round((p / base) * 100, 2));
  if (indexed.length <= maxPoints) return indexed;
  const step = (indexed.length - 1) / (maxPoints - 1);
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(indexed[Math.round(i * step)]);
  }
  return out;
}
