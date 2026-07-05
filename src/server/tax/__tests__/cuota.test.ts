import { describe, expect, it } from "vitest";
import {
  applySavingsScale,
  estimateSavingsCuota,
  savingsScaleForYear,
  type CuotaEstimateInput,
} from "../cuota";

function input(partial: {
  year?: number;
  netComputableEur?: number;
  dividendsGrossEur?: number;
  withholdingDestinoTotalEur?: number;
  dividends?: CuotaEstimateInput["dividends"];
}): CuotaEstimateInput {
  return {
    year: partial.year ?? 2025,
    dividends: partial.dividends ?? [],
    totals: {
      netComputableEur: partial.netComputableEur ?? 0,
      dividendsGrossEur: partial.dividendsGrossEur ?? 0,
      withholdingDestinoTotalEur: partial.withholdingDestinoTotalEur ?? 0,
    },
  };
}

describe("savingsScaleForYear", () => {
  it("uses the 20%–25% scale through 2025", () => {
    expect(savingsScaleForYear(2025).brackets[0].rate).toBe(0.2);
    expect(savingsScaleForYear(2014).brackets.at(-1)?.rate).toBe(0.25);
  });
  it("uses the 19%–28% scale from 2026", () => {
    expect(savingsScaleForYear(2026).brackets[0].rate).toBe(0.19);
    expect(savingsScaleForYear(2030).brackets.at(-1)?.rate).toBe(0.28);
  });
});

describe("applySavingsScale", () => {
  it("returns 0 for zero or negative base", () => {
    const scale = savingsScaleForYear(2025);
    expect(applySavingsScale(0, scale)).toBe(0);
    expect(applySavingsScale(-1000, scale)).toBe(0);
  });
  it("applies the 2025 scale marginally", () => {
    const scale = savingsScaleForYear(2025);
    // 2500×20% = 500
    expect(applySavingsScale(2_500, scale)).toBe(500);
    // 500 + 7500×21% + 5000×22% + 15000×23% = 500+1575+1100+3450 = 6625
    expect(applySavingsScale(30_000, scale)).toBe(6_625);
    // 6625 + 10000×25% = 9125
    expect(applySavingsScale(40_000, scale)).toBe(9_125);
  });
  it("matches the published cumulative quotas of the 2026 scale", () => {
    const scale = savingsScaleForYear(2026);
    // Cuotas íntegras publicadas por la DFB para la tarifa 2026.
    expect(applySavingsScale(7_500, scale)).toBe(1_425);
    expect(applySavingsScale(15_000, scale)).toBe(2_925);
    expect(applySavingsScale(30_000, scale)).toBe(6_225);
    expect(applySavingsScale(50_000, scale)).toBe(11_025);
    expect(applySavingsScale(90_000, scale)).toBe(21_225);
    expect(applySavingsScale(120_000, scale)).toBe(29_025);
    expect(applySavingsScale(240_000, scale)).toBe(60_825);
    expect(applySavingsScale(300_000, scale)).toBe(77_025);
    expect(applySavingsScale(400_000, scale)).toBe(77_025 + 100_000 * 0.28);
  });
});

describe("estimateSavingsCuota (art. 66 foral — compartimentos estancos)", () => {
  it("adds gains and RCM after the 1.500 € dividend exemption", () => {
    const est = estimateSavingsCuota(
      input({ netComputableEur: 10_000, dividendsGrossEur: 2_000 }),
      { grossEur: 500, withholdingEur: 0 },
    );
    expect(est.dividendExemptionAppliedEur).toBe(1_500);
    // RCM = 2000 − 1500 exención + 500 intereses = 1000.
    expect(est.saldoRcmEur).toBe(1_000);
    expect(est.baseAhorroEur).toBe(11_000);
    expect(est.lossCarryForwardEur).toBe(0);
    // 2025 scale: 500 + 1575 + 1000×22% = 2295
    expect(est.cuotaIntegraEur).toBe(2_295);
  });

  it("never offsets a G/P loss against RCM — the full loss carries forward", () => {
    const est = estimateSavingsCuota(
      input({ netComputableEur: -5_000, dividendsGrossEur: 4_000 }),
    );
    // Bizkaia art. 66: exclusivamente entre sí — no 25% cross-compensation.
    expect(est.lossCarryForwardEur).toBe(5_000);
    // RCM = 4000 − 1500 exención = 2500; base = solo el compartimento RCM.
    expect(est.saldoRcmEur).toBe(2_500);
    expect(est.baseAhorroEur).toBe(2_500);
  });

  it("carries the full loss forward when there is no RCM", () => {
    const est = estimateSavingsCuota(input({ netComputableEur: -3_000 }));
    expect(est.baseAhorroEur).toBe(0);
    expect(est.cuotaIntegraEur).toBe(0);
    expect(est.lossCarryForwardEur).toBe(3_000);
    expect(est.resultadoEstimadoEur).toBe(0);
  });

  it("credits DDI per dividend capped at the treaty rate and prorated by the taxed fraction", () => {
    const est = estimateSavingsCuota(
      input({
        netComputableEur: 0,
        dividendsGrossEur: 5_000,
        dividends: [
          // US: 30% withheld but treaty caps the credit at 15% → 750.
          { grossEur: 5_000, withholdingOrigenEur: 1_500, sourceCountry: "US" },
        ],
      }),
    );
    // RCM = 5000 − 1500 = 3500 → cuota 2500×20% + 1000×21% = 710.
    expect(est.cuotaIntegraEur).toBe(710);
    // La DDI compensa doble imposición SOLO sobre la renta que Bizkaia grava:
    // la fracción exenta (1500/5000) no tributa aquí, así que no genera
    // crédito. Treaty cap 750 × fracción gravada 0,7 = 525.
    expect(est.ddiCreditEur).toBe(525);
    expect(est.resultadoEstimadoEur).toBe(185);
  });

  it("dividendos enteramente bajo la exención de 1.500 € no generan DDI", () => {
    const est = estimateSavingsCuota(
      input({
        netComputableEur: 0,
        dividendsGrossEur: 21.07,
        dividends: [
          // Retención USA de 0,86 € — pero Bizkaia no grava nada de este
          // dividendo (exento íntegro), luego no hay doble imposición.
          { grossEur: 21.07, withholdingOrigenEur: 0.86, sourceCountry: "US" },
        ],
      }),
    );
    expect(est.dividendExemptionAppliedEur).toBeCloseTo(21.07);
    expect(est.cuotaIntegraEur).toBe(0);
    expect(est.ddiCreditEur).toBe(0);
  });

  it("subtracts destination withholding as payment on account (can go negative)", () => {
    const est = estimateSavingsCuota(
      input({
        netComputableEur: 0,
        dividendsGrossEur: 1_000,
        withholdingDestinoTotalEur: 250,
        dividends: [{ grossEur: 1_000, withholdingOrigenEur: 0, sourceCountry: "ES" }],
      }),
    );
    // 1000 de dividendos quedan íntegramente bajo la exención de 1500.
    expect(est.dividendExemptionAppliedEur).toBe(1_000);
    expect(est.cuotaIntegraEur).toBe(0);
    expect(est.resultadoEstimadoEur).toBe(-250);
  });

  it("subtracts the interest withholding as payment on account and uses the gross for the base", () => {
    const est = estimateSavingsCuota(
      input({ netComputableEur: 0, dividendsGrossEur: 0 }),
      // €100 gross interest, of which the bank withheld €19.
      { grossEur: 100, withholdingEur: 19 },
    );
    expect(est.saldoRcmEur).toBe(100);
    expect(est.baseAhorroEur).toBe(100);
    expect(est.interestWithholdingEur).toBe(19);
    // 2025 scale: 100 × 20% = 20 de cuota − 19 retenido = 1 a pagar.
    expect(est.cuotaIntegraEur).toBe(20);
    expect(est.resultadoEstimadoEur).toBe(1);
  });
});
