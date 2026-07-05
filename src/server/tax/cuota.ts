import { roundEur } from "../../lib/money";
import { ddiTreatyRate } from "./countries";

/** Intereses de cuentas del ejercicio. Definido aquí (módulo puro, sin DB)
 *  porque cuota.ts lo consume también el simulador client-side. */
export type TaxInterest = {
  /** RCM bruto: neto abonado + retención practicada. */
  grossEur: number;
  /** Retención practicada (pago a cuenta) declarada en los movimientos. */
  withholdingEur: number;
};

export const ZERO_INTEREST: TaxInterest = { grossEur: 0, withholdingEur: 0 };

/**
 * Escala foral del ahorro (Bizkaia / Gipuzkoa / Álava, armonizada).
 *
 * La cuota que sale de aquí es una ESTIMACIÓN orientativa de la base del
 * ahorro aislada (sin mínimos personales, sin otras deducciones de cuota,
 * sin la base general). El cálculo vinculante lo hace el programa de renta
 * de la hacienda foral correspondiente.
 */

export type SavingsBracket = {
  /** Límite superior del tramo en EUR; null = sin límite (último tramo). */
  upToEur: number | null;
  /** Tipo marginal del tramo (0..1). */
  rate: number;
};

export type SavingsScale = {
  /** Etiqueta humana, p. ej. "Escala foral del ahorro 2026 (19%–28%)". */
  label: string;
  brackets: SavingsBracket[];
};

// Art. 76 NF 13/2013 (Bizkaia) y equivalentes en Gipuzkoa/Álava, redacción
// vigente hasta el ejercicio 2025.
const SCALE_THROUGH_2025: SavingsScale = {
  label: "Escala foral del ahorro hasta 2025 (20%–25%)",
  brackets: [
    { upToEur: 2_500, rate: 0.2 },
    { upToEur: 10_000, rate: 0.21 },
    { upToEur: 15_000, rate: 0.22 },
    { upToEur: 30_000, rate: 0.23 },
    { upToEur: null, rate: 0.25 },
  ],
};

// Nueva tarifa progresiva armonizada con efectos desde el ejercicio 2026
// (reforma NF IRPF 2026 de los tres territorios históricos).
const SCALE_FROM_2026: SavingsScale = {
  label: "Escala foral del ahorro desde 2026 (19%–28%)",
  brackets: [
    { upToEur: 7_500, rate: 0.19 },
    { upToEur: 15_000, rate: 0.2 },
    { upToEur: 30_000, rate: 0.22 },
    { upToEur: 50_000, rate: 0.24 },
    { upToEur: 90_000, rate: 0.255 },
    { upToEur: 120_000, rate: 0.26 },
    { upToEur: 240_000, rate: 0.265 },
    { upToEur: 300_000, rate: 0.27 },
    { upToEur: null, rate: 0.28 },
  ],
};

export function savingsScaleForYear(year: number): SavingsScale {
  return year >= 2026 ? SCALE_FROM_2026 : SCALE_THROUGH_2025;
}

/** Cuota íntegra de una base liquidable del ahorro positiva. */
export function applySavingsScale(baseEur: number, scale: SavingsScale): number {
  if (baseEur <= 0) return 0;
  let cuota = 0;
  let floor = 0;
  for (const bracket of scale.brackets) {
    const ceiling = bracket.upToEur ?? Number.POSITIVE_INFINITY;
    const slice = Math.min(baseEur, ceiling) - floor;
    if (slice <= 0) break;
    cuota += slice * bracket.rate;
    floor = ceiling;
  }
  return roundEur(cuota);
}

// Compensación foral en la base del ahorro (art. 66 NF 13/2013): los dos
// compartimentos — (a) rendimientos del capital mobiliario y (b) ganancias y
// pérdidas patrimoniales — se integran y compensan "EXCLUSIVAMENTE ENTRE SÍ".
// No existe en Bizkaia la compensación cruzada del 25% del territorio común
// (art. 49 LIRPF estatal): un saldo negativo de ganancias/pérdidas queda
// íntegramente pendiente para los 4 ejercicios siguientes, contra su propio
// compartimento.

// Exención foral de dividendos (NF 13/2013, vigente desde 2014; suprimida en
// territorio común en 2015 pero CONSERVADA en Bizkaia): los primeros 1.500 €
// anuales de dividendos están exentos. No aplica a dividendos de valores
// homogéneos comprados en los 2 meses previos al cobro y vendidos en los
// 2 meses posteriores — esa guarda no se modela aquí (estimación).
// LIMITACIÓN divulgada (auditoría 2026-07, decisión del Commander: documentar,
// no modelar): los repartos de IIC (fondos/ETF de distribución) están
// legalmente EXCLUIDOS de la exención y aquí se incluirían — revisar si algún
// día la cartera cobra dividendos desde una IIC.
export const DIVIDEND_EXEMPTION_EUR = 1_500;

/** Subconjunto estructural de TaxReport que necesita la estimación. */
export type CuotaEstimateInput = {
  year: number;
  dividends: ReadonlyArray<{
    grossEur: number;
    withholdingOrigenEur: number;
    sourceCountry: string | null;
  }>;
  totals: {
    netComputableEur: number;
    dividendsGrossEur: number;
    withholdingDestinoTotalEur: number;
  };
};

export type CuotaEstimate = {
  scaleLabel: string;
  /** Saldo de ganancias/pérdidas patrimoniales computables (puede ser negativo). */
  saldoGananciasEur: number;
  /** Saldo de rendimientos del capital mobiliario tras la exención de
   *  dividendos (dividendos brutos − exención + intereses). */
  saldoRcmEur: number;
  /** Exención foral de dividendos aplicada (hasta 1.500 €). */
  dividendExemptionAppliedEur: number;
  /** Saldo negativo de G/P pendiente para los 4 ejercicios siguientes —
   *  compartimentos estancos (art. 66): NUNCA compensa RCM. */
  lossCarryForwardEur: number;
  baseAhorroEur: number;
  cuotaIntegraEur: number;
  /** Deducción por doble imposición internacional (casilla 0588), por dividendo
   *  min(retención en origen, tipo de convenio × bruto), topada a la cuota. */
  ddiCreditEur: number;
  /** Retenciones ya practicadas en destino (pagos a cuenta). */
  withholdingDestinoEur: number;
  /** Retención practicada sobre intereses de cuentas (pago a cuenta). */
  interestWithholdingEur: number;
  /** Cuota íntegra − DDI − retenciones destino − retención de intereses.
   *  Negativo = a devolver. */
  resultadoEstimadoEur: number;
};

export function estimateSavingsCuota(
  report: CuotaEstimateInput,
  interest: TaxInterest = ZERO_INTEREST,
): CuotaEstimate {
  const scale = savingsScaleForYear(report.year);

  const saldoGanancias = roundEur(report.totals.netComputableEur);
  const dividendExemptionApplied = roundEur(
    Math.min(DIVIDEND_EXEMPTION_EUR, Math.max(0, report.totals.dividendsGrossEur)),
  );
  const saldoRcm = roundEur(
    report.totals.dividendsGrossEur - dividendExemptionApplied + interest.grossEur,
  );

  // Art. 66: compartimentos estancos. El saldo positivo de cada compartimento
  // suma a la base; un saldo negativo de G/P se arrastra íntegro 4 ejercicios.
  const lossCarryForward = saldoGanancias < 0 ? roundEur(-saldoGanancias) : 0;
  const baseAhorro = roundEur(
    Math.max(0, saldoGanancias) + Math.max(0, saldoRcm),
  );

  const cuotaIntegra = applySavingsScale(baseAhorro, scale);

  // La DDI compensa doble imposición solo sobre la renta integrada en la
  // base: la fracción cubierta por la exención de 1.500 € no tributa aquí y
  // no genera crédito. Prorrateo global (la exención es conjunta, no por
  // dividendo). Pendiente de contrastar con Rentanet en la campaña — si el
  // programa foral acredita el íntegro, revertir a fracción 1.
  const taxedFraction =
    report.totals.dividendsGrossEur > 0
      ? (report.totals.dividendsGrossEur - dividendExemptionApplied) /
        report.totals.dividendsGrossEur
      : 0;
  const ddiUncapped = report.dividends.reduce((sum, d) => {
    const cap = ddiTreatyRate(d.sourceCountry ?? "") * d.grossEur;
    return sum + Math.min(d.withholdingOrigenEur, cap) * taxedFraction;
  }, 0);
  const ddiCredit = roundEur(Math.min(ddiUncapped, cuotaIntegra));

  const withholdingDestino = roundEur(report.totals.withholdingDestinoTotalEur);
  const interestWithholding = roundEur(interest.withholdingEur);
  const resultado = roundEur(
    cuotaIntegra - ddiCredit - withholdingDestino - interestWithholding,
  );

  return {
    scaleLabel: scale.label,
    saldoGananciasEur: saldoGanancias,
    saldoRcmEur: saldoRcm,
    dividendExemptionAppliedEur: dividendExemptionApplied,
    lossCarryForwardEur: lossCarryForward,
    baseAhorroEur: baseAhorro,
    cuotaIntegraEur: cuotaIntegra,
    ddiCreditEur: ddiCredit,
    withholdingDestinoEur: withholdingDestino,
    interestWithholdingEur: interestWithholding,
    resultadoEstimadoEur: resultado,
  };
}
