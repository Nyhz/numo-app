import { roundEur } from "./money";

/**
 * Pure compound-interest projection engine for the /simulador page.
 *
 * Everything here is deterministic and side-effect free so it can run on the
 * server (prefilled from real portfolio data) or the client (live as the user
 * drags inputs), and be unit-tested in isolation. Tax is injected as a callback
 * — the engine never imports the Bizkaia scale, keeping `lib` free of `server`
 * dependencies; the page wires in the real `applySavingsScale`.
 */

export type Scenario = "pessimistic" | "base" | "optimistic";

export type SimulatorInput = {
  /** Starting capital (prefilled from current net worth). */
  initialCapitalEur: number;
  /** Recurring monthly contribution at year 1. */
  monthlyContributionEur: number;
  /** Annual % the monthly contribution grows each year (e.g. 3 = +3%/yr). */
  contributionGrowthPct: number;
  /** Expected nominal annual return for the base scenario (e.g. 7). */
  annualReturnPct: number;
  /** Projection horizon in whole years. */
  years: number;
  /** Annual inflation used to deflate nominal values to today's money. */
  inflationPct: number;
  /** ± spread applied to the base return for the pessimistic/optimistic curves. */
  scenarioSpreadPct: number;
  /** Target yearly spending in retirement; 0 disables the FIRE block. */
  annualExpensesEur: number;
  /** Safe withdrawal rate for the FIRE number (e.g. 4 → 4% rule). */
  safeWithdrawalRatePct: number;
};

export type YearPoint = {
  /** Years from now (1..N). */
  year: number;
  /** Cumulative contributions including the initial capital. */
  contributedEur: number;
  /** Nominal portfolio value at year end. */
  valueEur: number;
  /** value − contributed. */
  gainEur: number;
  /** Nominal value deflated to today's purchasing power. */
  realValueEur: number;
  /** Contributions made during this year. */
  annualContributionEur: number;
  /** Market growth captured during this year. */
  annualInterestEur: number;
};

export type SimulatorResult = {
  input: SimulatorInput;
  base: YearPoint[];
  pessimistic: YearPoint[];
  optimistic: YearPoint[];
  summary: {
    finalValueEur: number;
    finalRealValueEur: number;
    totalContributedEur: number;
    totalGainEur: number;
    /** Tax due on the gain if liquidated at the horizon (via injected fn). */
    taxOnGainEur: number;
    netFinalValueEur: number;
    netFinalRealValueEur: number;
    effectiveTaxRatePct: number | null;
    /** First year where annual interest ≥ annual contribution; null if never / no contributions. */
    snowballYear: number | null;
    fire: {
      enabled: boolean;
      fireNumberEur: number | null;
      /** First year where real value ≥ FIRE number; null if not reached in horizon. */
      reachedYear: number | null;
    };
  };
};

function monthlyRate(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

/** Project a single return scenario month-by-month, snapshotting each year. */
export function projectSeries(input: SimulatorInput, annualReturnPct: number): YearPoint[] {
  const points: YearPoint[] = [];
  const mRate = monthlyRate(annualReturnPct);
  const inflFactor = 1 + input.inflationPct / 100;
  const growth = 1 + input.contributionGrowthPct / 100;

  let balance = input.initialCapitalEur;
  let contributed = input.initialCapitalEur;

  for (let y = 1; y <= input.years; y++) {
    const monthly = input.monthlyContributionEur * Math.pow(growth, y - 1);
    const valueStart = balance;
    let yearContribution = 0;
    for (let m = 0; m < 12; m++) {
      balance = balance * (1 + mRate) + monthly;
      yearContribution += monthly;
    }
    contributed += yearContribution;
    points.push({
      year: y,
      contributedEur: roundEur(contributed),
      valueEur: roundEur(balance),
      gainEur: roundEur(balance - contributed),
      realValueEur: roundEur(balance / Math.pow(inflFactor, y)),
      annualContributionEur: roundEur(yearContribution),
      annualInterestEur: roundEur(balance - valueStart - yearContribution),
    });
  }
  return points;
}

/**
 * Full simulation: base + pessimistic + optimistic curves, plus summary metrics
 * (after-tax final value, snowball year, FIRE target). `taxOnGain` maps a gross
 * gain to the tax due — defaults to zero so the engine stays self-contained.
 */
export function simulate(
  input: SimulatorInput,
  taxOnGain: (gainEur: number) => number = () => 0,
): SimulatorResult {
  const base = projectSeries(input, input.annualReturnPct);
  const pessimistic = projectSeries(
    input,
    input.annualReturnPct - input.scenarioSpreadPct,
  );
  const optimistic = projectSeries(
    input,
    input.annualReturnPct + input.scenarioSpreadPct,
  );

  const last = base[base.length - 1];
  const finalValueEur = last?.valueEur ?? input.initialCapitalEur;
  const totalContributedEur = last?.contributedEur ?? input.initialCapitalEur;
  const finalRealValueEur = last?.realValueEur ?? input.initialCapitalEur;
  const totalGainEur = roundEur(finalValueEur - totalContributedEur);
  const taxOnGainEur = roundEur(Math.max(0, taxOnGain(Math.max(0, totalGainEur))));
  const netFinalValueEur = roundEur(finalValueEur - taxOnGainEur);
  const inflFactor = Math.pow(1 + input.inflationPct / 100, input.years);
  const netFinalRealValueEur = roundEur(netFinalValueEur / inflFactor);
  const effectiveTaxRatePct =
    totalGainEur > 0 ? roundEur((taxOnGainEur / totalGainEur) * 100) : null;

  let snowballYear: number | null = null;
  if (input.monthlyContributionEur > 0) {
    const hit = base.find(
      (p) => p.annualContributionEur > 0 && p.annualInterestEur >= p.annualContributionEur,
    );
    snowballYear = hit ? hit.year : null;
  }

  const fireEnabled = input.annualExpensesEur > 0 && input.safeWithdrawalRatePct > 0;
  const fireNumberEur = fireEnabled
    ? roundEur(input.annualExpensesEur / (input.safeWithdrawalRatePct / 100))
    : null;
  const fireHit =
    fireEnabled && fireNumberEur != null
      ? base.find((p) => p.realValueEur >= fireNumberEur)
      : undefined;

  return {
    input,
    base,
    pessimistic,
    optimistic,
    summary: {
      finalValueEur,
      finalRealValueEur,
      totalContributedEur,
      totalGainEur,
      taxOnGainEur,
      netFinalValueEur,
      netFinalRealValueEur,
      effectiveTaxRatePct,
      snowballYear,
      fire: {
        enabled: fireEnabled,
        fireNumberEur,
        reachedYear: fireHit ? fireHit.year : null,
      },
    },
  };
}

/**
 * Reverse mode A — required monthly contribution to reach `targetEur` within the
 * horizon, at the base return. Binary search (monotonic in the contribution).
 * `basis` decides whether the target is in nominal or real (today's) euros —
 * "real" keeps it consistent with the FIRE block and the "Valor real" KPI.
 * Returns 0 if the target is met with no contributions, or null if unreachable
 * even at a very high contribution.
 */
export function solveMonthlyContribution(
  input: Omit<SimulatorInput, "monthlyContributionEur">,
  targetEur: number,
  basis: "nominal" | "real" = "nominal",
): number | null {
  const valueFor = (monthly: number): number => {
    const series = projectSeries({ ...input, monthlyContributionEur: monthly }, input.annualReturnPct);
    const last = series[series.length - 1];
    if (!last) return input.initialCapitalEur;
    return basis === "real" ? last.realValueEur : last.valueEur;
  };

  if (valueFor(0) >= targetEur) return 0;
  let lo = 0;
  let hi = 1_000_000; // €1M/month ceiling — beyond any realistic plan
  if (valueFor(hi) < targetEur) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (valueFor(mid) >= targetEur) hi = mid;
    else lo = mid;
  }
  return roundEur(hi);
}

/**
 * Reverse mode B — fractional years to reach `targetEur` at the base return,
 * given the configured contribution. `basis` selects nominal or real (today's)
 * euros for the comparison. Capped at 100 years; null if not reached within the
 * cap. With "real", an unreachable target (return ≤ inflation) returns null.
 */
export function solveYearsToTarget(
  input: SimulatorInput,
  targetEur: number,
  basis: "nominal" | "real" = "nominal",
): number | null {
  const mRate = monthlyRate(input.annualReturnPct);
  const growth = 1 + input.contributionGrowthPct / 100;
  const inflFactor = 1 + input.inflationPct / 100;
  let balance = input.initialCapitalEur;
  if (balance >= targetEur) return 0;
  const maxMonths = 1200;
  for (let m = 0; m < maxMonths; m++) {
    const year = Math.floor(m / 12);
    const monthly = input.monthlyContributionEur * Math.pow(growth, year);
    balance = balance * (1 + mRate) + monthly;
    const elapsedYears = (m + 1) / 12;
    const compareValue =
      basis === "real" ? balance / Math.pow(inflFactor, elapsedYears) : balance;
    if (compareValue >= targetEur) {
      return roundEur(elapsedYears);
    }
  }
  return null;
}

export type DecumulationResult = {
  /** Whole years the pot sustains the (inflation-adjusted) withdrawal. */
  yearsLasting: number;
  /** True if the pot survives the full horizon without depleting. */
  sustainable: boolean;
  /** Real (today's money) value remaining at the end of the horizon. */
  endRealValueEur: number;
};

/**
 * Decumulation / FIRE drawdown — withdraw an inflation-adjusted income from a
 * starting pot earning `annualReturnPct`, and report how long it lasts.
 */
export function projectDecumulation(args: {
  startEur: number;
  annualWithdrawalEur: number;
  annualReturnPct: number;
  inflationPct: number;
  horizonYears: number;
}): DecumulationResult {
  const { startEur, annualWithdrawalEur, annualReturnPct, inflationPct, horizonYears } = args;
  let balance = startEur;
  let yearsLasting = 0;
  for (let y = 1; y <= horizonYears; y++) {
    const withdrawal = annualWithdrawalEur * Math.pow(1 + inflationPct / 100, y - 1);
    balance = balance * (1 + annualReturnPct / 100) - withdrawal;
    if (balance <= 0) {
      return { yearsLasting, sustainable: false, endRealValueEur: 0 };
    }
    yearsLasting = y;
  }
  const endReal = balance / Math.pow(1 + inflationPct / 100, horizonYears);
  return { yearsLasting, sustainable: true, endRealValueEur: roundEur(endReal) };
}
