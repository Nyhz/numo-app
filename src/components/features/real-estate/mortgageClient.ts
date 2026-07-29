import type { MortgageScheduleEvent, MortgageTerms } from "@/src/lib/mortgage";
import type { PropertySummary } from "@/src/server/realEstate";

export function termsOf(summary: Pick<PropertySummary, "mortgage">): MortgageTerms | null {
  const m = summary.mortgage;
  if (!m) return null;
  return {
    principalEur: m.principalEur,
    nominalRatePct: m.nominalRatePct,
    termMonths: m.termMonths,
    firstPaymentDate: m.firstPaymentDate,
  };
}

export function scheduleEventsOf(summary: Pick<PropertySummary, "events">): MortgageScheduleEvent[] {
  return summary.events.map((e) => {
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
    return { type: "rate_change" as const, eventDate: e.eventDate, newRatePct: e.newRatePct ?? 0 };
  });
}
