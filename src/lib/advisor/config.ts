import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { advisorPaths } from "./paths";
import { ensureDir, writeAtomic } from "./memory";

const CONFIG_PATH = resolve(advisorPaths.root, "config.json");

export const DEFAULT_MARKET_SOURCES = [
  "Reuters",
  "Associated Press",
  "Yahoo Finance",
  "CNBC",
  "MarketWatch",
  "Investing.com",
  "Expansión",
  "Cinco Días",
  "El Economista",
  "Bolsamanía",
  "comunicados del BCE y la Reserva Federal",
];

const configSchema = z.object({
  /** Day of the month the Anthropic billing cycle / credit resets (1–31). */
  billingCycleDay: z.number().int().min(1).max(31).default(1),
  /** Priority press the market scanner is steered toward (guided search). */
  marketSources: z.array(z.string().trim().min(1).max(80)).max(40).default(DEFAULT_MARKET_SOURCES),
  /** When false, market scans + weekly curation are paused (vacation / credit cap). */
  marketIngestEnabled: z.boolean().default(true),
});
export type AdvisorConfig = z.infer<typeof configSchema>;

export function readAdvisorConfig(): AdvisorConfig {
  try {
    return configSchema.parse(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
  } catch {
    return configSchema.parse({});
  }
}

export function writeAdvisorConfig(patch: Partial<AdvisorConfig>): AdvisorConfig {
  const next = configSchema.parse({ ...readAdvisorConfig(), ...patch });
  ensureDir(advisorPaths.root);
  writeAtomic(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}
