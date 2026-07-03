import { roundEur } from "../../lib/money";
import { actualizationCoefficient } from "./coeficientes";
import { estimateSavingsCuota, type CuotaEstimate } from "./cuota";
import { ZERO_INTEREST, type TaxInterest } from "./interest";
import type { DeclarationRow, TaxReport } from "./report";

/**
 * Previsión foral — qué saldrá del programa de renta de la Hacienda Foral.
 *
 * La Declaración transcribe valores históricos; Rentanet aplica por su cuenta
 * los coeficientes de actualización (art. 45.Dos NF 13/2013), la exención de
 * dividendos y la compensación del art. 66. Esta capa reproduce ese cálculo
 * para que el report sirva de contraste del resultado final. Es una
 * ESTIMACIÓN: el cálculo vinculante es el del programa foral.
 */

export type PrevisionRow = DeclarationRow & {
  /** Coeficiente aplicado al valor de adquisición (null = tabla no publicada). */
  coeficiente: number | null;
  valorAdquisicionActualizadoEur: number;
  /** transmisión − gastos − adquisición actualizada. */
  resultadoForalEur: number;
};

export type Prevision = {
  /** False when no coefficient table is published for the year. */
  coefficientsAvailable: boolean;
  rows: PrevisionRow[];
  /** Saldo neto foral de G/P computables (coeficientes + antiaplicación). */
  saldoGananciasForalEur: number;
  perdidasNoComputablesEur: number;
  /** Ahorro fiscal de los coeficientes vs. el saldo histórico declarado. */
  coefficientReliefEur: number;
  cuota: CuotaEstimate;
};

export function buildPrevision(report: TaxReport, interest: TaxInterest = ZERO_INTEREST): Prevision {
  const declaration = report.declaration ?? [];
  const coefficientsAvailable =
    actualizationCoefficient(report.year, report.year) != null;

  const rows: PrevisionRow[] = declaration.map((d) => {
    const acquisitionYear = new Date(d.acquiredAt).getUTCFullYear();
    const coef = actualizationCoefficient(report.year, acquisitionYear);
    const updated = coef != null ? roundEur(d.valorAdquisicionEur * coef) : d.valorAdquisicionEur;
    return {
      ...d,
      coeficiente: coef,
      valorAdquisicionActualizadoEur: updated,
      resultadoForalEur: roundEur(d.valorTransmisionEur - d.gastosTransmisionEur - updated),
    };
  });

  // Per-sale foral result, re-applying the wash-sale disallowance on the
  // coefficient-adjusted loss (clamped: the disallowance can never turn a
  // loss into a gain).
  const nonComputableBySale = new Map(
    report.sales.map((s) => [s.transactionId, s.nonComputableLossEur]),
  );
  const foralBySale = new Map<string, number>();
  for (const r of rows) {
    foralBySale.set(
      r.saleTransactionId,
      (foralBySale.get(r.saleTransactionId) ?? 0) + r.resultadoForalEur,
    );
  }
  let saldoForal = 0;
  let perdidasNoComputables = 0;
  for (const [saleId, raw] of foralBySale) {
    const nonComputable = nonComputableBySale.get(saleId) ?? 0;
    if (raw < 0 && nonComputable > 0) {
      saldoForal += Math.min(0, raw + nonComputable);
      perdidasNoComputables += Math.min(nonComputable, -raw);
    } else {
      saldoForal += raw;
    }
  }
  saldoForal = roundEur(saldoForal);
  perdidasNoComputables = roundEur(perdidasNoComputables);

  // Cuota over the FORAL saldo: reuse the estimator, overriding the gains
  // saldo with the coefficient-adjusted one.
  const cuota = estimateSavingsCuota(
    {
      year: report.year,
      dividends: report.dividends,
      totals: {
        netComputableEur: saldoForal,
        dividendsGrossEur: report.totals.dividendsGrossEur,
        withholdingDestinoTotalEur: report.totals.withholdingDestinoTotalEur,
      },
    },
    interest,
  );

  return {
    coefficientsAvailable,
    rows,
    saldoGananciasForalEur: saldoForal,
    perdidasNoComputablesEur: perdidasNoComputables,
    coefficientReliefEur: roundEur(report.totals.netComputableEur - saldoForal),
    cuota,
  };
}
