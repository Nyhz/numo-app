/**
 * Norma antiaplicación de pérdidas (art. 43.g/h NF 13/2013 Bizkaia).
 *
 * Una pérdida por transmisión de valores homogéneos no se computa cuando se
 * adquieren valores homogéneos dentro de la ventana legal alrededor de la
 * venta — DOS MESES de calendario antes/después para valores cotizados y
 * criptoactivos fungibles, UN AÑO para valores no cotizados. La pérdida
 * diferida se integra "a medida que se transmitan los valores que permanezcan
 * en el patrimonio": aquí, sumándola a la base de coste del lote absorbente,
 * de modo que la venta definitiva de ese lote la recupera automáticamente.
 *
 * La detección y el diferimiento viven en el replay cronológico de
 * `recomputeLotsForAsset` (lots.ts). Este módulo aporta los helpers puros.
 */

export type WashSaleWindow = {
  /** Months on each side of the sale (calendar months, fecha-a-fecha). */
  months: number;
  /** Legacy label persisted in tax_wash_sale_adjustments.window_days. */
  daysLabel: number;
};

export function washSaleWindowForAssetClass(assetClassTax: string | null): WashSaleWindow {
  // Un año para valores NO admitidos a negociación (art. 43.h): además de los
  // no cotizados obvios, las participaciones de IIC no cotizadas (fondos de
  // inversión tradicionales, suscripción/reembolso a VL con la gestora) no
  // están admitidas a negociación — ventana de 12 meses, no 2. Los ETF sí
  // cotizan y conservan los 2 meses del art. 43.g.
  return assetClassTax === "unlisted_security" || assetClassTax === "fund"
    ? { months: 12, daysLabel: 365 }
    : { months: 2, daysLabel: 60 };
}

/**
 * Civil "de fecha a fecha" month arithmetic in UTC. When the target month is
 * shorter (31 Jan + 1 month), the day clamps to the month's last day instead
 * of spilling into the next month.
 */
export function addCalendarMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const target = new Date(ms);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.getTime();
}

/**
 * Split `totalEur` (cents-exact) across `weights` proportionally so the cent
 * shares sum EXACTLY to the total (largest-remainder method). Rounding each
 * share independently can drift the sum by a cent per participant — never
 * acceptable in a figure that reaches the tax report.
 */
export function allocateLargestRemainder(totalEur: number, weights: number[]): number[] {
  const totalCents = Math.round(totalEur * 100);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0 || totalCents === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (totalCents * w) / weightSum);
  const floored = exact.map((c) => Math.floor(c));
  let leftover = totalCents - floored.reduce((s, c) => s + c, 0);

  const order = exact
    .map((c, i) => ({ i, frac: c - Math.floor(c) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floored[i] += 1;
    leftover -= 1;
  }
  return floored.map((c) => c / 100);
}
