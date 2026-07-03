import type { TaxReport } from "../../server/tax/report";
import { ZERO_INTEREST, type TaxInterest } from "../../server/tax/interest";

type Row = { casilla: string; label: string; valueEur: number };

/**
 * `ddiCreditEur` must be the CAPPED credit from `estimateSavingsCuota` /
 * `buildPrevision` — the DDI is a cuota deduction, legalmente limitada por la
 * cuota íntegra (art. 92 NF 13/2013). Computing it here uncapped made this
 * CSV disagree with the PDF in loss years (audit F3).
 *
 * Box numbers are the estado Modelo 100 numbering, kept as orientative
 * labels — the foral form numbering differs.
 */
export function buildCasillasCsv(
  report: TaxReport,
  ddiCreditEur: number,
  interest: TaxInterest = ZERO_INTEREST,
): string {
  const rows: Row[] = [];
  rows.push({ casilla: "0326", label: "Ganancias patrimoniales (transmisión)", valueEur: report.totals.realizedGainsEur });
  rows.push({ casilla: "0340", label: "Pérdidas computables", valueEur: Math.abs(report.totals.realizedLossesComputableEur) });
  rows.push({ casilla: "0343", label: "Saldo neto ganancias/pérdidas patrimoniales", valueEur: report.totals.netComputableEur });
  rows.push({ casilla: "0027", label: "Rendimientos del capital mobiliario (dividendos gross)", valueEur: report.totals.dividendsGrossEur });
  if (interest.grossEur !== 0) {
    // Sin número de casilla propio: el número foral difiere y no se inventa —
    // la etiqueta identifica el concepto (intereses de cuentas, RCM bruto).
    rows.push({ casilla: "—", label: "Intereses de cuentas (RCM bruto)", valueEur: interest.grossEur });
  }
  // Solo pagos a cuenta ESPAÑOLES: la retención en origen es impuesto
  // extranjero y se recupera exclusivamente vía DDI (0588) — sumarla aquí
  // además del 0588 la contaba dos veces (auditoría 2026-07).
  rows.push({
    casilla: "0029",
    label: "Retenciones e ingresos a cuenta",
    valueEur: report.totals.withholdingDestinoTotalEur + interest.withholdingEur,
  });
  rows.push({
    casilla: "0588",
    label: "Deducción doble imposición internacional (topada a cuota)",
    valueEur: ddiCreditEur,
  });

  const header = "casilla|etiqueta|valor_eur";
  // Audit T9: serialize money at exactly 2dp — raw doubles leak artifacts
  // like 1234.5600000000002 into the filed CSV.
  const body = rows.map((r) => `${r.casilla}|${r.label}|${r.valueEur.toFixed(2)}`).join("\n");
  return `\uFEFF${header}\n${body}\n`;
}
