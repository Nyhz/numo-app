"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "../lib/domain";
import {
  MemoryValidationError,
  PROFILE_MAX_BYTES,
  appendChangelog,
  writeProfile,
} from "../lib/advisor/memory";

// Guard on the SAME byte budget writeProfile enforces (not a char count) so the
// UI rejects up-front with a coherent message instead of surprising the user at save.
const schema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "El perfil no puede quedar vacío.")
    .refine((s) => Buffer.byteLength(s, "utf8") <= PROFILE_MAX_BYTES, {
      message: `El perfil no puede superar ${PROFILE_MAX_BYTES} bytes.`,
    }),
});

/** Manual edit/seed of the personal profile (data/advisor/personal/profile.md). */
export async function saveAdvisorProfile(
  input: unknown,
): Promise<ActionResult<{ saved: true }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => i.message);
    return {
      ok: false,
      error: {
        code: "validation",
        // ProfileEditor surfaces error.message directly, so put the real reason there.
        message: messages.join(" ") || "Datos no válidos",
        fieldErrors: { content: messages },
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
