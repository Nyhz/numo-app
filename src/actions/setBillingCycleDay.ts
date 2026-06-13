"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "../lib/domain";
import { writeAdvisorConfig } from "../lib/advisor/config";

const schema = z.object({ day: z.number().int().min(1).max(31) });

/** Set the day of the month the Anthropic billing cycle / credit resets. */
export async function setBillingCycleDay(
  input: unknown,
): Promise<ActionResult<{ day: number }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Día no válido (1–31)" } };
  }
  const cfg = writeAdvisorConfig({ billingCycleDay: parsed.data.day });
  revalidatePath("/asesor");
  return { ok: true, data: { day: cfg.billingCycleDay } };
}
