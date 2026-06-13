"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "../lib/domain";
import { MemoryValidationError, appendChangelog, writeProfile } from "../lib/advisor/memory";

const schema = z.object({ content: z.string().trim().min(1).max(8000) });

/** Manual edit/seed of the personal profile (data/advisor/personal/profile.md). */
export async function saveAdvisorProfile(
  input: unknown,
): Promise<ActionResult<{ saved: true }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Datos no válidos",
        fieldErrors: { content: ["El perfil no puede estar vacío y debe caber en el presupuesto."] },
      },
    };
  }
  try {
    writeProfile(parsed.data.content);
    appendChangelog("perfil editado manualmente", new Date());
    revalidatePath("/asesor");
    revalidatePath("/settings");
    return { ok: true, data: { saved: true } };
  } catch (err) {
    if (err instanceof MemoryValidationError) {
      return {
        ok: false,
        error: { code: "validation", message: err.message, fieldErrors: { content: [err.message] } },
      };
    }
    return { ok: false, error: { code: "db", message: "No se pudo guardar el perfil." } };
  }
}
