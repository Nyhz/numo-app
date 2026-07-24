import { z } from "zod";
import { EARLY_REPAYMENT_MODES, RATE_TYPES } from "../db/schema";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (yyyy-MM-dd)");

export const mortgageInputSchema = z.object({
  lender: z.string().trim().max(120).nullish(),
  principalEur: z.number().positive().max(100_000_000),
  rateType: z.enum(RATE_TYPES),
  nominalRatePct: z.number().min(0).max(30),
  termMonths: z.number().int().min(1).max(600),
  firstPaymentDate: isoDate,
  spreadPct: z.number().min(0).max(15).nullish(),
  referenceIndex: z.string().trim().max(40).nullish(),
  /** Total de intereses según la oferta del banco (dato de contraste). */
  expectedTotalInterestEur: z.number().min(0).max(100_000_000).nullish(),
});

export const createPropertySchema = z.object({
  name: z.string().trim().min(1, "Obligatorio").max(120),
  address: z.string().trim().max(200).nullish(),
  purchaseDate: isoDate,
  purchasePriceEur: z.number().positive().max(100_000_000),
  purchaseCostsEur: z.number().min(0).max(100_000_000).default(0),
  notes: z.string().trim().max(500).nullish(),
  mortgage: mortgageInputSchema.nullish(),
});

export const updatePropertySchema = createPropertySchema
  .omit({ mortgage: true })
  .extend({ id: z.string().min(1) });

export const deleteByIdSchema = z.object({ id: z.string().min(1) });

export const addValuationSchema = z.object({
  propertyId: z.string().min(1),
  valuationDate: isoDate,
  valueEur: z.number().positive().max(100_000_000),
  note: z.string().trim().max(200).nullish(),
});

export const addMortgageEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("early_repayment"),
    mortgageId: z.string().min(1),
    eventDate: isoDate,
    amountEur: z.number().positive().max(100_000_000),
    mode: z.enum(EARLY_REPAYMENT_MODES),
    note: z.string().trim().max(200).nullish(),
  }),
  z.object({
    type: z.literal("rate_change"),
    mortgageId: z.string().min(1),
    eventDate: isoDate,
    newRatePct: z.number().min(0).max(30),
    note: z.string().trim().max(200).nullish(),
  }),
  z.object({
    type: z.literal("payment_override"),
    mortgageId: z.string().min(1),
    eventDate: isoDate,
    /** Nueva cuota mensual (recibo real del banco). */
    amountEur: z.number().positive().max(1_000_000),
    note: z.string().trim().max(200).nullish(),
  }),
]);

export const setMortgageExpectedInterestSchema = z.object({
  mortgageId: z.string().min(1),
  expectedTotalInterestEur: z.number().min(0).max(100_000_000).nullable(),
});
