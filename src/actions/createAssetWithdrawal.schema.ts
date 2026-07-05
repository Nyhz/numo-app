import { z } from "zod";
import { isoDatePastSchema } from "./_schemas";

export const createAssetWithdrawalSchema = z.object({
  accountId: z.string().min(1),
  assetId: z.string().min(1),
  tradeDate: isoDatePastSchema,
  quantity: z.number().positive(),
  /** Valor EUR de mercado de las unidades retiradas en la fecha de salida.
   *  Alimenta la serie de patrimonio como flujo de salida (TWR neutro);
   *  nunca genera resultado fiscal. */
  valueEur: z.number().positive(),
  notes: z.string().trim().max(500).optional(),
  /** Una segunda retirada idéntica el mismo día se marca como duplicado;
   *  pásalo a true para registrarla igualmente (fingerprint salteado). */
  allowDuplicate: z.boolean().default(false),
});
export type CreateAssetWithdrawalInput = z.input<typeof createAssetWithdrawalSchema>;
