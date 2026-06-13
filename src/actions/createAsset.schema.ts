import { z } from "zod";
import { ASSET_TYPES } from "./_shared";

const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, "La divisa debe ser un código ISO 4217 de 3 letras");

export const createAssetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  symbol: z.string().trim().min(1).max(32),
  isin: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i, "El ISIN debe tener 12 caracteres alfanuméricos")
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
  assetType: z.enum(ASSET_TYPES),
  currency: currencyCode,
  ter: z
    .number()
    .min(0, "El TER no puede ser negativo")
    .max(100, "El TER se expresa en % (p. ej. 0,22)")
    .nullable()
    .optional(),
  exchange: z.string().trim().max(32).nullable().optional(),
  providerSymbol: z.string().trim().max(64).nullable().optional(),
  isActive: z.boolean().default(true),
});

export type CreateAssetInput = z.input<typeof createAssetSchema>;
