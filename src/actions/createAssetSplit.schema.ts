import { z } from "zod";
import { isoDatePastSchema } from "./_schemas";

export const createAssetSplitSchema = z
  .object({
    accountId: z.string().min(1),
    assetId: z.string().min(1),
    /** Día en que el mercado empieza a cotizar el precio post-canje. La fila
     *  se inserta a las 00:00 UTC para preceder a cualquier operación
     *  intradía (las altas manuales van a las 12:00). */
    effectiveDate: isoDatePastSchema,
    /** Canje N nuevas por M antiguas: split 4:1 → newShares=4, oldShares=1;
     *  contra-split 25→1 → newShares=1, oldShares=25. */
    newShares: z.number().int().positive(),
    oldShares: z.number().int().positive(),
    notes: z.string().trim().max(500).optional(),
    /** El mismo canje (activo, fecha, factor) registrado dos veces se marca
     *  como duplicado; pásalo a true para insertarlo igualmente. */
    allowDuplicate: z.boolean().default(false),
  })
  .refine((d) => d.newShares !== d.oldShares, {
    message: "un canje 1:1 no cambia nada",
    path: ["newShares"],
  });
export type CreateAssetSplitInput = z.input<typeof createAssetSplitSchema>;
