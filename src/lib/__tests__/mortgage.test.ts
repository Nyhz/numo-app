import { describe, expect, it } from "vitest";
import {
  addMonthsIso,
  annuityPayment,
  buildSchedule,
  outstandingAt,
  summarizeSchedule,
  type MortgageTerms,
} from "../mortgage";

// Caso canónico del spec: 150k, TIN 2,5 %, 25 años.
const CANON: MortgageTerms = {
  principalEur: 150_000,
  nominalRatePct: 2.5,
  termMonths: 300,
  firstPaymentDate: "2026-09-01",
};

describe("annuityPayment", () => {
  it("caso canónico ≈ 672,92 €", () => {
    expect(annuityPayment(150_000, 2.5, 300)).toBeCloseTo(672.93, 2);
  });
  it("tipo 0 % ⇒ principal / meses", () => {
    expect(annuityPayment(1200, 0, 12)).toBe(100);
  });
});

describe("addMonthsIso", () => {
  it("suma meses conservando el día", () => {
    expect(addMonthsIso("2026-09-01", 1)).toBe("2026-10-01");
    expect(addMonthsIso("2026-09-01", 299)).toBe("2051-08-01");
  });
  it("recorta al último día del mes", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("buildSchedule — sin eventos", () => {
  const rows = buildSchedule(CANON);

  it("300 cuotas y primera cuota exacta", () => {
    expect(rows).toHaveLength(300);
    expect(rows[0]).toMatchObject({
      index: 1,
      date: "2026-09-01",
      kind: "payment",
      paymentEur: 672.93,
      interestEur: 312.5,
      principalEur: 360.43,
      remainingEur: 149_639.57,
    });
  });

  it("el capital amortizado suma el principal al céntimo y acaba en 0", () => {
    const total = rows.reduce((s, r) => s + r.principalEur, 0);
    expect(Math.round(total * 100) / 100).toBe(150_000);
    expect(rows[rows.length - 1].remainingEur).toBe(0);
  });

  it("summarizeSchedule cuadra pagos = principal + intereses", () => {
    const s = summarizeSchedule(CANON, rows);
    expect(s.paymentsCount).toBe(300);
    expect(s.endDate).toBe("2051-08-01");
    expect(s.totalPaidEur).toBeCloseTo(150_000 + s.totalInterestEur, 1);
    expect(s.totalLoanCostEur).toBeCloseTo(150_000 + s.totalInterestEur, 2);
  });
});

describe("outstandingAt", () => {
  const rows = buildSchedule(CANON);
  it("antes de la primera cuota ⇒ principal íntegro", () => {
    expect(outstandingAt(CANON, rows, "2026-08-15")).toBe(150_000);
  });
  it("entre cuotas ⇒ pendiente de la última cuota pagada", () => {
    expect(outstandingAt(CANON, rows, "2026-09-15")).toBe(149_639.57);
  });
  it("después de la última ⇒ 0", () => {
    expect(outstandingAt(CANON, rows, "2060-01-01")).toBe(0);
  });
});
