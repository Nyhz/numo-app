import { z } from "zod";
import { ASSET_TYPES } from "./_shared";
import { PRICE_SOURCES } from "../lib/domain";

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
  tradingviewSymbol: z.string().trim().max(64).nullable().optional(),
  logoUrl: z.string().trim().url("URL de logo inválida").max(300).nullable().optional(),
  // null = pick provider by type (crypto → CoinGecko, else Yahoo). Set
  // "ft" for funds priced by ISIN that Yahoo can't quote.
  priceSource: z.enum(PRICE_SOURCES).nullable().optional(),
  isActive: z.boolean().default(true),
}).superRefine((data, ctx) => {
  // FT is looked up by ISIN, so it's useless without one.
  if (data.priceSource === "ft" && !data.isin) {
    ctx.addIssue({
      code: "custom",
      path: ["isin"],
      message: "El ISIN es obligatorio para precios de Financial Times",
    });
  }
  // TradingView is looked up by its own EXCHANGE:TICKER symbol — without one
  // the sync can never resolve a quote for this asset (see price-sync.ts).
  if (data.priceSource === "tradingview" && !data.tradingviewSymbol) {
    ctx.addIssue({
      code: "custom",
      path: ["tradingviewSymbol"],
      message: "El símbolo TradingView es obligatorio para esa fuente de precio",
    });
  }
});

export type CreateAssetInput = z.input<typeof createAssetSchema>;
