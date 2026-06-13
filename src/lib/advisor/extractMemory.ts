import "server-only";
import { runAdvisorOnce, type AdvisorUsage } from "./client";
import { MEMORY_EXTRACT_SYSTEM } from "./prompts";
import { memoryOpsSchema, type MemoryOp, type MemoryProposal } from "./schemas";
import { appendChangelog, readProfile, writeProfile } from "./memory";
import { addProposals } from "./proposals";

/** Pull the first JSON object out of the model's reply and validate it. */
export function parseMemoryOps(text: string): MemoryOp[] {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = memoryOpsSchema.safeParse(JSON.parse(m[0]));
    return parsed.success ? parsed.data.ops : [];
  } catch {
    return [];
  }
}

function applyAdds(profile: string, adds: MemoryOp[]): string {
  const header = "## Notas del asesor";
  const bullets = adds.map((a) => `- ${a.field}: ${a.value}`).join("\n");
  if (profile.includes(header)) return `${profile.trimEnd()}\n${bullets}\n`;
  const base = profile.trim();
  return `${base ? `${base}\n\n` : ""}${header}\n${bullets}\n`;
}

/**
 * Hybrid memory policy: `add` ops are applied automatically (logged); `update`/
 * `remove` ops are queued as proposals for the Commander to confirm.
 */
export async function extractAndApplyMemory(opts: {
  userMessage: string;
  assistantMessage: string;
  model: string;
  now: Date;
}): Promise<{ added: number; pendingProposals: MemoryProposal[]; usage: AdvisorUsage }> {
  const profile = readProfile();
  const prompt = `Perfil actual:\n${profile || "(vacío)"}\n\nIntercambio:\nUsuario: ${opts.userMessage}\nAsesor: ${opts.assistantMessage}`;
  const res = await runAdvisorOnce({
    model: opts.model,
    systemPrompt: MEMORY_EXTRACT_SYSTEM,
    prompt,
    allowedTools: [],
    maxTurns: 1,
  });
  const { text: _text, ...usage } = res;
  void _text;

  const ops = parseMemoryOps(res.text);
  const adds = ops.filter((o) => o.op === "add" && o.value);
  const others = ops.filter((o) => o.op !== "add");

  let added = 0;
  if (adds.length) {
    try {
      writeProfile(applyAdds(profile, adds));
      for (const a of adds) appendChangelog(`add ${a.field}: ${a.value} (${a.reason})`, opts.now);
      added = adds.length;
    } catch {
      // Profile validation failed (e.g. byte budget) — skip adds, keep previous.
    }
  }
  const pendingProposals = addProposals(others, opts.now);
  return { added, pendingProposals, usage };
}
