import { asc, eq } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  mortgageEvents,
  mortgages,
  properties,
  propertyValuations,
  type Mortgage,
  type MortgageEvent,
  type Property,
  type PropertyValuation,
} from "../db/schema";
import { todayIsoLocal } from "../lib/asof";
import { roundEur } from "../lib/money";
import {
  buildSchedule,
  currentValueAt,
  interestPaidUntil,
  nextPaymentAfter,
  outstandingAt,
  summarizeSchedule,
  type MortgageScheduleEvent,
  type MortgageTerms,
  type ScheduleRow,
} from "../lib/mortgage";

export type PropertySummary = {
  property: Property;
  mortgage: Mortgage | null;
  events: MortgageEvent[];
  valuations: PropertyValuation[];
  schedule: ScheduleRow[];
  currentValueEur: number;
  currentValueAsOf: string | null;
  outstandingEur: number;
  equityEur: number;
  ownedPct: number;
  loan: {
    paymentEur: number;
    nextPayment: ScheduleRow | null;
    endDate: string | null;
    totalInterestEur: number;
    totalLoanCostEur: number;
    interestPaidEur: number;
    interestRemainingEur: number;
  } | null;
};

export type RealEstateOverview = {
  totalValueEur: number;
  totalOutstandingEur: number;
  totalEquityEur: number;
  properties: PropertySummary[];
};

export type StatementRealEstateLine = {
  propertyId: string;
  name: string;
  valueEur: number;
  valuationAsOf: string | null;
  outstandingEur: number;
  equityEur: number;
};

function toTerms(m: Mortgage): MortgageTerms {
  return {
    principalEur: m.principalEur,
    nominalRatePct: m.nominalRatePct,
    termMonths: m.termMonths,
    firstPaymentDate: m.firstPaymentDate,
  };
}

function toScheduleEvents(rows: MortgageEvent[]): MortgageScheduleEvent[] {
  return rows.map((e) => {
    if (e.type === "early_repayment") {
      return {
        type: "early_repayment" as const,
        eventDate: e.eventDate,
        amountEur: e.amountEur ?? 0,
        mode: e.mode ?? "reduce_installment",
      };
    }
    if (e.type === "payment_override") {
      return {
        type: "payment_override" as const,
        eventDate: e.eventDate,
        paymentEur: e.amountEur ?? 0,
      };
    }
    return {
      type: "rate_change" as const,
      eventDate: e.eventDate,
      newRatePct: e.newRatePct ?? 0,
    };
  });
}

export async function getRealEstateOverview(
  db: DB = defaultDb,
  todayIso: string = todayIsoLocal(),
): Promise<RealEstateOverview> {
  const props = db.select().from(properties).orderBy(asc(properties.purchaseDate)).all();
  const out: PropertySummary[] = [];
  for (const property of props) {
    const mortgage =
      db.select().from(mortgages).where(eq(mortgages.propertyId, property.id)).get() ?? null;
    const events = mortgage
      ? db
          .select()
          .from(mortgageEvents)
          .where(eq(mortgageEvents.mortgageId, mortgage.id))
          .orderBy(asc(mortgageEvents.eventDate))
          .all()
      : [];
    const valuations = db
      .select()
      .from(propertyValuations)
      .where(eq(propertyValuations.propertyId, property.id))
      .orderBy(asc(propertyValuations.valuationDate))
      .all();
    const terms = mortgage ? toTerms(mortgage) : null;
    const schedule = terms ? buildSchedule(terms, toScheduleEvents(events)) : [];
    // Invariante histórica: un inmueble no computa antes de su purchaseDate.
    const gated = property.purchaseDate > todayIso;
    const { valueEur, asOf } = currentValueAt(property.purchasePriceEur, valuations, todayIso);
    const currentValueEur = gated ? 0 : valueEur;
    const outstandingEur = gated ? 0 : terms ? outstandingAt(terms, schedule, todayIso) : 0;
    const equityEur = roundEur(currentValueEur - outstandingEur);
    let loan: PropertySummary["loan"] = null;
    if (!gated && terms) {
      const summary = summarizeSchedule(terms, schedule);
      const interestPaidEur = interestPaidUntil(schedule, todayIso);
      const next = nextPaymentAfter(schedule, todayIso);
      loan = {
        paymentEur: next?.paymentEur ?? 0,
        nextPayment: next,
        endDate: summary.endDate,
        totalInterestEur: summary.totalInterestEur,
        totalLoanCostEur: summary.totalLoanCostEur,
        interestPaidEur,
        interestRemainingEur: roundEur(summary.totalInterestEur - interestPaidEur),
      };
    }
    out.push({
      property,
      mortgage,
      events,
      valuations,
      schedule,
      currentValueEur,
      currentValueAsOf: asOf,
      outstandingEur,
      equityEur,
      ownedPct: currentValueEur > 0 ? equityEur / currentValueEur : 0,
      loan,
    });
  }
  return {
    totalValueEur: roundEur(out.reduce((s, p) => s + p.currentValueEur, 0)),
    totalOutstandingEur: roundEur(out.reduce((s, p) => s + p.outstandingEur, 0)),
    totalEquityEur: roundEur(out.reduce((s, p) => s + p.equityEur, 0)),
    properties: out,
  };
}

function equityAtDate(p: PropertySummary, dateIso: string): number {
  if (p.property.purchaseDate > dateIso) return 0;
  const { valueEur } = currentValueAt(p.property.purchasePriceEur, p.valuations, dateIso);
  const pendingEur = p.mortgage
    ? outstandingAt(toTerms(p.mortgage), p.schedule, dateIso)
    : 0;
  return valueEur - pendingEur;
}

export async function getRealEstateEquityAt(
  dateIso: string,
  db: DB = defaultDb,
): Promise<number> {
  const overview = await getRealEstateOverview(db, dateIso);
  return roundEur(
    overview.properties.reduce((s, p) => s + equityAtDate(p, dateIso), 0),
  );
}

export async function getRealEstateEquityByDate(
  dates: string[],
  db: DB = defaultDb,
): Promise<Map<string, number>> {
  const overview = await getRealEstateOverview(db);
  const map = new Map<string, number>();
  for (const d of dates) {
    map.set(
      d,
      roundEur(overview.properties.reduce((s, p) => s + equityAtDate(p, d), 0)),
    );
  }
  return map;
}

export async function getStatementRealEstate(
  db: DB = defaultDb,
  asOf?: string | null,
): Promise<{ lines: StatementRealEstateLine[]; totalEquityEur: number }> {
  const dateIso = asOf ?? todayIsoLocal();
  const overview = await getRealEstateOverview(db, dateIso);
  const lines = overview.properties
    .filter((p) => p.property.purchaseDate <= dateIso)
    .map((p) => ({
      propertyId: p.property.id,
      name: p.property.name,
      valueEur: p.currentValueEur,
      valuationAsOf: p.currentValueAsOf,
      outstandingEur: p.outstandingEur,
      equityEur: p.equityEur,
    }));
  return {
    lines,
    totalEquityEur: roundEur(lines.reduce((s, l) => s + l.equityEur, 0)),
  };
}
