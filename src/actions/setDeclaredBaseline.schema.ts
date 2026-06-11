import { z } from "zod";
import { DECLARED_BASELINE_CATEGORIES } from "../db/schema/tax_declared_baselines";

export const setDeclaredBaselineSchema = z.object({
  /** Ejercicio the filed declaration referred to (not the filing year). */
  year: z.number().int().min(2000).max(2100),
  category: z.enum(DECLARED_BASELINE_CATEGORIES),
  amountEur: z.number().finite().nonnegative(),
  notes: z.string().trim().max(500).optional(),
});

export type SetDeclaredBaselineInput = z.input<typeof setDeclaredBaselineSchema>;

export const deleteDeclaredBaselineSchema = z.object({
  id: z.string().min(1),
});

export type DeleteDeclaredBaselineInput = z.input<typeof deleteDeclaredBaselineSchema>;
