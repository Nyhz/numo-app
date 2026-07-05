import { describe, expect, it } from "vitest";
import {
  addMonthsIso,
  annuityPayment,
  buildSchedule,
  currentValueAt,
  equityAt,
  interestPaidUntil,
  nextPaymentAfter,
  outstandingAt,
  summarizeSchedule,
  type MortgageScheduleEvent,
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

describe("buildSchedule — eventos", () => {
  it("early_repayment reduce_term: misma cuota, menos cuotas", () => {
    const ev: MortgageScheduleEvent[] = [
      { type: "early_repayment", eventDate: "2027-01-15", amountEur: 20_000, mode: "reduce_term" },
    ];
    const rows = buildSchedule(CANON, ev);
    const s = summarizeSchedule(CANON, rows);
    const base = summarizeSchedule(CANON, buildSchedule(CANON));
    const eventRow = rows.find((r) => r.kind === "early_repayment");
    expect(eventRow).toMatchObject({ date: "2027-01-15", principalEur: 20_000, interestEur: 0 });
    // Cuota intacta tras el evento…
    const after = rows.find((r) => r.kind === "payment" && r.date === "2027-02-01");
    expect(after?.paymentEur).toBe(672.93);
    // …pero el préstamo acaba antes y con menos intereses.
    expect(s.paymentsCount).toBeLessThan(300);
    expect(s.totalInterestEur).toBeLessThan(base.totalInterestEur);
    // El capital sigue cuadrando al céntimo (cuotas + amortización anticipada).
    const total = rows.reduce((sum, r) => sum + r.principalEur, 0);
    expect(Math.round(total * 100) / 100).toBe(150_000);
  });

  it("early_repayment reduce_installment: cuota menor, mismo vencimiento", () => {
    const ev: MortgageScheduleEvent[] = [
      { type: "early_repayment", eventDate: "2027-01-15", amountEur: 20_000, mode: "reduce_installment" },
    ];
    const rows = buildSchedule(CANON, ev);
    const s = summarizeSchedule(CANON, rows);
    const after = rows.find((r) => r.kind === "payment" && r.date === "2027-02-01");
    expect(after && after.paymentEur < 672.93).toBe(true);
    expect(s.paymentsCount).toBe(300);
    expect(s.endDate).toBe("2051-08-01");
  });

  it("rate_change recalcula la cuota sobre pendiente y meses restantes", () => {
    const ev: MortgageScheduleEvent[] = [
      { type: "rate_change", eventDate: "2028-09-15", newRatePct: 3.5 },
    ];
    const rows = buildSchedule(CANON, ev);
    const before = rows.find((r) => r.date === "2028-09-01");
    const after = rows.find((r) => r.date === "2028-10-01");
    expect(before?.ratePct).toBe(2.5);
    expect(after?.ratePct).toBe(3.5);
    expect(after && after.paymentEur > 672.93).toBe(true);
    expect(summarizeSchedule(CANON, rows).paymentsCount).toBe(300);
  });

  it("amortización total liquida el préstamo", () => {
    const rows = buildSchedule(CANON, [
      { type: "early_repayment", eventDate: "2027-01-15", amountEur: 999_999, mode: "reduce_term" },
    ]);
    expect(rows[rows.length - 1]).toMatchObject({ kind: "early_repayment", remainingEur: 0 });
  });
});

describe("valoraciones y equity", () => {
  const rows = buildSchedule(CANON);
  const vals = [
    { valuationDate: "2028-05-01", valueEur: 215_000 },
    { valuationDate: "2027-03-01", valueEur: 200_000 },
  ];

  it("currentValueAt: forward-fill con fallback al precio de compra", () => {
    expect(currentValueAt(193_000, vals, "2026-12-01")).toEqual({ valueEur: 193_000, asOf: null });
    expect(currentValueAt(193_000, vals, "2027-06-01")).toEqual({ valueEur: 200_000, asOf: "2027-03-01" });
    expect(currentValueAt(193_000, vals, "2030-01-01")).toEqual({ valueEur: 215_000, asOf: "2028-05-01" });
  });

  it("equityAt: día de compra = la entrada (caso canónico +43k)", () => {
    expect(equityAt(193_000, [], CANON, rows, "2026-08-20")).toBe(43_000);
  });

  it("equityAt sin hipoteca = valor vigente", () => {
    expect(equityAt(193_000, vals, null, [], "2027-06-01")).toBe(200_000);
  });

  it("interestPaidUntil y nextPaymentAfter", () => {
    expect(interestPaidUntil(rows, "2026-08-31")).toBe(0);
    expect(interestPaidUntil(rows, "2026-09-01")).toBe(312.5);
    expect(nextPaymentAfter(rows, "2026-09-01")?.date).toBe("2026-10-01");
    expect(nextPaymentAfter(rows, "2060-01-01")).toBeNull();
  });
});
