"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "../lib/domain";
import { writeAdvisorConfig } from "../lib/advisor/config";

const schema = z.object({ enabled: z.boolean() });

/** Pause / resume market ingest (scans + weekly curation). */
export async function setMarketIngest(
  input: unknown,
): Promise<ActionResult<{ enabled: boolean }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Valor no válido" } };
  }
  const cfg = writeAdvisorConfig({ marketIngestEnabled: parsed.data.enabled });
  revalidatePath("/asesor");
  return { ok: true, data: { enabled: cfg.marketIngestEnabled } };
}
