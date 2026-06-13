import { describe, expect, it } from "vitest";
import {
  projectSeries,
  projectDecumulation,
  simulate,
  solveMonthlyContribution,
  solveYearsToTarget,
  type SimulatorInput,
} from "../simulator";

const baseInput: SimulatorInput = {
  initialCapitalEur: 10_000,
  monthlyContributionEur: 300,
  contributionGrowthPct: 0,
  annualReturnPct: 7,
  years: 20,
  inflationPct: 2,
  scenarioSpreadPct: 3,
  annualExpensesEur: 0,
  safeWithdrawalRatePct: 4,
};

describe("projectSeries", () => {
  it("pure capital with no contributions compounds at the annual rate", () => {
    const series = projectSeries(
      { ...baseInput, monthlyContributionEur: 0, years: 1, inflationPct: 0 },
      7,
    );
    // Monthly compounding to an effective 7% annual → ~10,700 after 1 year.
    expect(series).toHaveLength(1);
    expect(series[0].valueEur).toBeCloseTo(10_700, 0);
    expect(series[0].contributedEur).toBe(10_000);
    expect(series[0].gainEur).toBeCloseTo(700, 0);
  });

  it("a zero return keeps value equal to contributions", () => {
    const series = projectSeries(
      { ...baseInput, annualReturnPct: 0, years: 2, inflationPct: 0 },
      0,
    );
    const last = series[series.length - 1];
    expect(last.valueEur).toBeCloseTo(last.contributedEur, 6);
    expect(last.contributedEur).toBe(10_000 + 300 * 24);
    expect(last.gainEur).toBeCloseTo(0, 6);
  });

  it("deflates real value below nominal under positive inflation", () => {
    const series = projectSeries({ ...baseInput, years: 10 }, 7);
    const last = series[series.length - 1];
    expect(last.realValueEur).toBeLessThan(last.valueEur);
  });

  it("grows the yearly contribution when contributionGrowthPct > 0", () => {
    const series = projectSeries({ ...baseInput, contributionGrowthPct: 10, years: 2 }, 7);
    expect(series[1].annualContributionEur).toBeCloseTo(
      series[0].annualContributionEur * 1.1,
      4,
    );
  });
});

describe("simulate", () => {
  it("orders scenarios pessimistic < base < optimistic", () => {
    const r = simulate(baseInput);
    const pess = r.pessimistic.at(-1)!.valueEur;
    const base = r.base.at(-1)!.valueEur;
    const opt = r.optimistic.at(-1)!.valueEur;
    expect(pess).toBeLessThan(base);
    expect(base).toBeLessThan(opt);
  });

  it("applies the injected tax callback to the gain only", () => {
    const flat20 = (gain: number) => gain * 0.2;
    const r = simulate(baseInput, flat20);
    expect(r.summary.taxOnGainEur).toBeCloseTo(r.summary.totalGainEur * 0.2, 1);
    expect(r.summary.netFinalValueEur).toBeCloseTo(
      r.summary.finalValueEur - r.summary.taxOnGainEur,
      1,
    );
    expect(r.summary.effectiveTaxRatePct).toBeCloseTo(20, 1);
  });

  it("defaults to zero tax when no callback is given", () => {
    const r = simulate(baseInput);
    expect(r.summary.taxOnGainEur).toBe(0);
    expect(r.summary.netFinalValueEur).toBe(r.summary.finalValueEur);
  });

  it("finds the snowball year where interest overtakes contribution", () => {
    const r = simulate(baseInput);
    expect(r.summary.snowballYear).not.toBeNull();
    const y = r.summary.snowballYear!;
    const point = r.base.find((p) => p.year === y)!;
    expect(point.annualInterestEur).toBeGreaterThanOrEqual(point.annualContributionEur);
  });

  it("reports no snowball year without contributions", () => {
    const r = simulate({ ...baseInput, monthlyContributionEur: 0 });
    expect(r.summary.snowballYear).toBeNull();
  });

  it("computes the FIRE number from the safe withdrawal rate", () => {
    const r = simulate({ ...baseInput, annualExpensesEur: 24_000, safeWithdrawalRatePct: 4 });
    expect(r.summary.fire.enabled).toBe(true);
    expect(r.summary.fire.fireNumberEur).toBe(600_000); // 24,000 / 0.04
  });

  it("disables FIRE when no expenses are set", () => {
    const r = simulate(baseInput);
    expect(r.summary.fire.enabled).toBe(false);
    expect(r.summary.fire.fireNumberEur).toBeNull();
  });
});

describe("reverse modes", () => {
  it("solves a monthly contribution that reaches the target", () => {
    const target = 200_000;
    const { monthlyContributionEur: _omit, ...rest } = baseInput;
    void _omit;
    const monthly = solveMonthlyContribution(rest, target);
    expect(monthly).not.toBeNull();
    const series = projectSeries(
      { ...baseInput, monthlyContributionEur: monthly! },
      baseInput.annualReturnPct,
    );
    expect(series.at(-1)!.valueEur).toBeCloseTo(target, -2); // within ~€100
  });

  it("returns 0 when the target is already met with no contributions", () => {
    const { monthlyContributionEur: _omit, ...rest } = baseInput;
    void _omit;
    const monthly = solveMonthlyContribution({ ...rest, initialCapitalEur: 500_000 }, 50_000);
    expect(monthly).toBe(0);
  });

  it("solves the years needed to reach a target", () => {
    const years = solveYearsToTarget(baseInput, 100_000);
    expect(years).not.toBeNull();
    expect(years!).toBeGreaterThan(0);
    expect(years!).toBeLessThan(baseInput.years);
  });

  it("returns null when a target is unreachable within the cap", () => {
    const years = solveYearsToTarget(
      { ...baseInput, monthlyContributionEur: 0, annualReturnPct: 0 },
      1_000_000,
    );
    expect(years).toBeNull();
  });
});

describe("reverse modes — real basis (today's euros)", () => {
  it("hits the target measured in real value", () => {
    const target = 200_000;
    const { monthlyContributionEur: _omit, ...rest } = baseInput;
    void _omit;
    const monthly = solveMonthlyContribution(rest, target, "real");
    expect(monthly).not.toBeNull();
    const series = projectSeries(
      { ...baseInput, monthlyContributionEur: monthly! },
      baseInput.annualReturnPct,
    );
    expect(series.at(-1)!.realValueEur).toBeCloseTo(target, -2);
  });

  it("a real target needs more contribution than the same nominal target", () => {
    const target = 200_000;
    const { monthlyContributionEur: _omit, ...rest } = baseInput;
    void _omit;
    const nominal = solveMonthlyContribution(rest, target, "nominal")!;
    const real = solveMonthlyContribution(rest, target, "real")!;
    expect(real).toBeGreaterThan(nominal);
  });

  it("years-to-target (real) is consistent with the FIRE reached year", () => {
    // A scenario large enough to actually reach the FIRE number within the horizon.
    const input = {
      ...baseInput,
      initialCapitalEur: 81_544,
      monthlyContributionEur: 1_200,
      annualReturnPct: 7.5,
      years: 25,
      inflationPct: 2.5,
      annualExpensesEur: 24_000,
      safeWithdrawalRatePct: 4,
    };
    const fire = simulate(input).summary.fire;
    expect(fire.reachedYear).not.toBeNull();
    const years = solveYearsToTarget(input, fire.fireNumberEur!, "real");
    expect(years).not.toBeNull();
    // FIRE uses yearly snapshots; the fractional crossing must land in that year.
    expect(years!).toBeLessThanOrEqual(fire.reachedYear!);
    expect(years!).toBeGreaterThan(fire.reachedYear! - 1);
  });
});

describe("projectDecumulation", () => {
  it("a sustainable withdrawal preserves the pot over the horizon", () => {
    const r = projectDecumulation({
      startEur: 1_000_000,
      annualWithdrawalEur: 30_000, // 3% of pot, below 7% growth
      annualReturnPct: 7,
      inflationPct: 2,
      horizonYears: 30,
    });
    expect(r.sustainable).toBe(true);
    expect(r.yearsLasting).toBe(30);
    expect(r.endRealValueEur).toBeGreaterThan(0);
  });

  it("an over-large withdrawal depletes the pot early", () => {
    const r = projectDecumulation({
      startEur: 100_000,
      annualWithdrawalEur: 30_000,
      annualReturnPct: 3,
      inflationPct: 2,
      horizonYears: 30,
    });
    expect(r.sustainable).toBe(false);
    expect(r.yearsLasting).toBeLessThan(30);
  });
});
