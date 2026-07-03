import { z } from "zod";
import { isoDatePastSchema } from "./_schemas";

export const CASH_MOVEMENT_KINDS = [
  "deposit",
  "withdrawal",
  "interest",
  "fee",
  "dividend",
  "transfer-in",
  "transfer-out",
] as const;
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number];

export const createCashMovementSchema = z
  .object({
  accountId: z.string().min(1),
  kind: z.enum(CASH_MOVEMENT_KINDS),
  occurredAt: isoDatePastSchema,
  // Audit M3: direction comes from `kind` — a signed amount is a user mistake
  // (and 0 is a no-op row), so only strictly positive magnitudes are accepted.
  amountNative: z
    .number()
    .finite()
    .positive("El importe debe ser positivo — el tipo de movimiento decide el signo"),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "La divisa debe ser un código ISO 4217 de 3 letras"),
  /** Broker FX rate in the broker's direction: 1 EUR = X CCY. ALWAYS typed
   *  by hand for non-EUR movements — daily rates only act as a guard. */
  fxEurToCcy: z.number().finite().positive().optional(),
  /** Retención practicada en EUR — solo para movimientos `interest`: se
   *  registra el NETO abonado como importe y la retención aquí; el bruto
   *  fiscal (RCM) es neto + retención y la retención descuenta en cuota. */
  withholdingTaxEur: z.number().finite().nonnegative().optional(),
  description: z.string().trim().max(500).optional(),
  /** Audit M7: a second identical movement on the same day is flagged as a
   *  duplicate; pass true to record it anyway (salted fingerprint). */
  allowDuplicate: z.boolean().default(false),
  /** Audit H3: a manual FX rate >20% off the stored daily rate is rejected as
   *  a probable typo/inverse; pass true to use it anyway. */
  allowFxDeviation: z.boolean().default(false),
  })
  .refine((d) => d.currency === "EUR" || d.fxEurToCcy != null, {
    path: ["fxEurToCcy"],
    message: "Obligatorio en movimientos no-EUR: introduce el tipo 1 EUR = ? de tu broker.",
  })
  .refine((d) => d.withholdingTaxEur == null || d.kind === "interest", {
    path: ["withholdingTaxEur"],
    message: "La retención solo aplica a movimientos de interés.",
  });

export type CreateCashMovementInput = z.input<typeof createCashMovementSchema>;
