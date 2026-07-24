// Motor puro de hipoteca francesa. Sin DB, sin red, sin Date.now():
// todo se deriva de los términos + eventos, para cualquier fecha pasada
// o futura. Importable desde cliente (cuota en vivo en formularios).
import { roundEur } from "./money";

export type MortgageTerms = {
  principalEur: number;
  /** TIN anual en %, p. ej. 2.5 */
  nominalRatePct: number;
  termMonths: number;
  /** ISO yyyy-MM-dd de la primera cuota */
  firstPaymentDate: string;
};

export type MortgageScheduleEvent =
  | {
      type: "early_repayment";
      eventDate: string;
      amountEur: number;
      mode: "reduce_term" | "reduce_installment";
    }
  | { type: "rate_change"; eventDate: string; newRatePct: number }
  /** Cuota forzada por el usuario (recibo real del banco): sustituye a la
   *  anualidad desde la cuota de `eventDate` (incluida) y se hereda hacia
   *  delante hasta el próximo evento que recalcule (otro override, un
   *  rate_change o una amortización reduce_installment). */
  | { type: "payment_override"; eventDate: string; paymentEur: number };

export type ScheduleRow = {
  index: number;
  date: string;
  kind: "payment" | "early_repayment";
  paymentEur: number;
  interestEur: number;
  principalEur: number;
  /** Capital vivo tras esta fila */
  remainingEur: number;
  /** TIN vigente en esta fila */
  ratePct: number;
  /** True cuando la cuota viene de un payment_override, no de la anualidad. */
  overridden?: boolean;
};

export type ScheduleSummary = {
  paymentsCount: number;
  endDate: string | null;
  totalInterestEur: number;
  totalPaidEur: number;
  totalLoanCostEur: number;
};

export function addMonthsIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export function annuityPayment(
  principalEur: number,
  annualRatePct: number,
  months: number,
): number {
  if (months <= 0) return principalEur;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return roundEur(principalEur / months);
  return roundEur((principalEur * r) / (1 - (1 + r) ** -months));
}

/** Tope duro anti-bucle (100 años de cuotas). */
const MAX_ROWS = 1200;

export function buildSchedule(
  terms: MortgageTerms,
  events: MortgageScheduleEvent[] = [],
): ScheduleRow[] {
  // Orden: por fecha; a igualdad, los payment_override PRIMERO — aplican A la
  // cuota de su fecha (segunda pasada del bucle), mientras que el resto de
  // eventos co-fechados aplican después de ella. Si fueran detrás en la cola,
  // el evento no-override co-fechado (que aún no toca procesar) los taparía.
  const pending = [...events].sort((a, b) => {
    const byDate = a.eventDate.localeCompare(b.eventDate);
    if (byDate !== 0) return byDate;
    return (a.type === "payment_override" ? 0 : 1) - (b.type === "payment_override" ? 0 : 1);
  });
  const rows: ScheduleRow[] = [];
  let remaining = roundEur(terms.principalEur);
  let ratePct = terms.nominalRatePct;
  let monthsLeft = terms.termMonths;
  let paymentEur = annuityPayment(remaining, ratePct, monthsLeft);
  // Cuota forzada vigente: sustituye a la anualidad hasta el próximo evento
  // recalculador (rate_change / reduce_installment / otro override).
  let overridden = false;
  let paymentNo = 0;
  let ev = 0;
  let index = 0;

  while (remaining > 0 && rows.length < MAX_ROWS) {
    const date = addMonthsIso(terms.firstPaymentDate, paymentNo);

    // Pasada 1 — eventos estrictamente anteriores a la cuota de este mes. Un
    // evento fechado el mismo día de una cuota aplica DESPUÉS de esa cuota.
    while (ev < pending.length && pending[ev].eventDate < date) {
      const e = pending[ev];
      ev += 1;
      if (e.type === "payment_override") {
        paymentEur = roundEur(e.paymentEur);
        overridden = true;
        continue;
      }
      if (e.type === "rate_change") {
        ratePct = e.newRatePct;
        // Con cuota forzada por el usuario, la revisión de TIN NO la pisa:
        // el TIN solo cambia el reparto interés/capital. La cuota real la
        // dicta el recibo del banco que el usuario registró — si la revisión
        // se la cambia, registrará el importe nuevo.
        if (!overridden) paymentEur = annuityPayment(remaining, ratePct, monthsLeft);
        continue;
      }
      const amount = roundEur(Math.min(e.amountEur, remaining));
      if (amount <= 0) continue;
      remaining = roundEur(remaining - amount);
      rows.push({
        index: ++index,
        date: e.eventDate,
        kind: "early_repayment",
        paymentEur: amount,
        interestEur: 0,
        principalEur: amount,
        remainingEur: remaining,
        ratePct,
      });
      if (remaining === 0) return rows;
      if (e.mode === "reduce_installment") {
        // El banco recalcula la cuota: la estimación de anualidad sustituye
        // al override hasta que el usuario registre el recibo nuevo.
        paymentEur = annuityPayment(remaining, ratePct, monthsLeft);
        overridden = false;
      }
      // reduce_term: misma cuota — el bucle termina antes por sí solo.
    }

    // Pasada 2 — overrides fechados EXACTAMENTE en la cuota de hoy: aplican a
    // esta cuota («la cuota del día 5 fue de X €»). El sort los deja delante
    // de cualquier otro evento co-fechado.
    while (
      ev < pending.length &&
      pending[ev].eventDate === date &&
      pending[ev].type === "payment_override"
    ) {
      const e = pending[ev] as Extract<MortgageScheduleEvent, { type: "payment_override" }>;
      ev += 1;
      paymentEur = roundEur(e.paymentEur);
      overridden = true;
    }

    const interestEur = roundEur(remaining * (ratePct / 100 / 12));
    let principalPart = roundEur(paymentEur - interestEur);
    if (monthsLeft <= 1 || principalPart >= remaining) principalPart = remaining;
    if (principalPart <= 0) {
      throw new Error("mortgage: la cuota no cubre los intereses");
    }
    remaining = roundEur(remaining - principalPart);
    rows.push({
      index: ++index,
      date,
      kind: "payment",
      paymentEur: roundEur(interestEur + principalPart),
      interestEur,
      principalEur: principalPart,
      remainingEur: remaining,
      ratePct,
      ...(overridden ? { overridden: true } : {}),
    });
    paymentNo += 1;
    monthsLeft -= 1;
  }
  return rows;
}

export function outstandingAt(
  terms: MortgageTerms,
  rows: ScheduleRow[],
  dateIso: string,
): number {
  let out = roundEur(terms.principalEur);
  for (const row of rows) {
    if (row.date > dateIso) break;
    out = row.remainingEur;
  }
  return out;
}

export function summarizeSchedule(
  terms: MortgageTerms,
  rows: ScheduleRow[],
): ScheduleSummary {
  const totalInterestEur = roundEur(rows.reduce((s, r) => s + r.interestEur, 0));
  const totalPaidEur = roundEur(rows.reduce((s, r) => s + r.paymentEur, 0));
  return {
    paymentsCount: rows.filter((r) => r.kind === "payment").length,
    endDate: rows.length ? rows[rows.length - 1].date : null,
    totalInterestEur,
    totalPaidEur,
    totalLoanCostEur: roundEur(terms.principalEur + totalInterestEur),
  };
}

export function interestPaidUntil(rows: ScheduleRow[], dateIso: string): number {
  return roundEur(
    rows.filter((r) => r.date <= dateIso).reduce((s, r) => s + r.interestEur, 0),
  );
}

export function nextPaymentAfter(rows: ScheduleRow[], dateIso: string): ScheduleRow | null {
  return rows.find((r) => r.kind === "payment" && r.date > dateIso) ?? null;
}

export type ValuationPoint = { valuationDate: string; valueEur: number };

export function currentValueAt(
  purchasePriceEur: number,
  valuations: ValuationPoint[],
  dateIso: string,
): { valueEur: number; asOf: string | null } {
  let best: ValuationPoint | null = null;
  for (const v of valuations) {
    if (v.valuationDate <= dateIso && (!best || v.valuationDate > best.valuationDate)) {
      best = v;
    }
  }
  return best
    ? { valueEur: best.valueEur, asOf: best.valuationDate }
    : { valueEur: purchasePriceEur, asOf: null };
}

export function equityAt(
  purchasePriceEur: number,
  valuations: ValuationPoint[],
  terms: MortgageTerms | null,
  rows: ScheduleRow[],
  dateIso: string,
): number {
  const { valueEur } = currentValueAt(purchasePriceEur, valuations, dateIso);
  const pendingEur = terms ? outstandingAt(terms, rows, dateIso) : 0;
  return roundEur(valueEur - pendingEur);
}
