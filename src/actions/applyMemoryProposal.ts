"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "../lib/domain";
import { findProposal, removeProposal } from "../lib/advisor/proposals";
import {
  MemoryValidationError,
  PROFILE_MAX_BYTES,
  appendChangelog,
  readProfile,
  writeProfile,
} from "../lib/advisor/memory";
import { AdvisorAuthError, AdvisorTimeoutError, runAdvisorOnce } from "../lib/advisor/client";
import { buildApplyProposalSystem } from "../lib/advisor/prompts";
import { recordAdvisorRun } from "../lib/advisor/runs";

const schema = z.object({
  id: z.string().min(1),
  decision: z.enum(["confirm", "discard"]),
});

/** Hard bound on the LLM apply round-trip — a hung subprocess must never leave
 *  the confirm button spinning forever. */
const APPLY_TIMEOUT_MS = 120_000;

/** Hybrid policy: confirming an update/remove applies it to the profile via an
 *  LLM edit (validated + atomic); discarding just drops the pending proposal. */
export async function applyMemoryProposal(
  input: unknown,
): Promise<ActionResult<{ applied: boolean }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Datos no válidos" } };
  }
  const { id, decision } = parsed.data;

  const proposal = findProposal(id);
  if (!proposal) {
    return { ok: false, error: { code: "not_found", message: "Propuesta no encontrada" } };
  }

  if (decision === "discard") {
    removeProposal(id);
    revalidatePath("/asesor");
    return { ok: true, data: { applied: false } };
  }

  const startedAt = Date.now();
  const model = process.env.ADVISOR_SCAN_MODEL ?? "claude-sonnet-4-6";
  const profile = readProfile();
  const change = `Operación: ${proposal.op}\nCampo: ${proposal.field}${proposal.value ? `\nNuevo valor: ${proposal.value}` : ""}\nMotivo: ${proposal.reason}`;
  const prompt = `Perfil actual:\n${profile || "(vacío)"}\n\nCambio confirmado a aplicar:\n${change}`;

  try {
    const res = await runAdvisorOnce({
      model,
      systemPrompt: buildApplyProposalSystem(PROFILE_MAX_BYTES),
      prompt,
      allowedTools: [],
      maxTurns: 1,
      timeoutMs: APPLY_TIMEOUT_MS,
    });
    writeProfile(res.text);
    appendChangelog(
      `${proposal.op} ${proposal.field}${proposal.value ? `: ${proposal.value}` : ""} (confirmado — ${proposal.reason})`,
      new Date(),
    );
    removeProposal(id);
    const { text: _t, ...usage } = res;
    void _t;
    recordAdvisorRun({
      kind: "memory",
      status: "ok",
      model,
      usage,
      summary: `apply ${proposal.op} ${proposal.field}`,
      startedAt,
    });
    revalidatePath("/asesor");
    return { ok: true, data: { applied: true } };
  } catch (err) {
    recordAdvisorRun({
      kind: "memory",
      status: "error",
      model,
      errorMessage: err instanceof Error ? err.message : String(err),
      startedAt,
    });
    if (err instanceof MemoryValidationError) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: `${err.message} Puedes compactar el perfil desde Ajustes y reintentar.`,
        },
      };
    }
    if (err instanceof AdvisorAuthError || err instanceof AdvisorTimeoutError) {
      return { ok: false, error: { code: "db", message: err.message } };
    }
    return { ok: false, error: { code: "db", message: "No se pudo aplicar el cambio." } };
  }
}
