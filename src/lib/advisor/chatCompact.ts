import "server-only";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runAdvisorOnce, type AdvisorUsage } from "./client";
import { advisorPaths } from "./paths";
import { isoWeekKey } from "./dates";
import { ensureDir, readTextOrEmpty, writeAtomic } from "./memory";

export const CHAT_COMPACT_SYSTEM = `Resume las siguientes conversaciones entre el Commander y su asesor financiero en un resumen conciso, para dar continuidad a futuras charlas. En español, con viñetas. Captura: temas tratados, decisiones o conclusiones, dudas abiertas y cosas a seguir. NO incluyas cifras de la cartera (ya están disponibles en vivo); céntrate en lo conversacional. Si las conversaciones son triviales, resume en una o dos líneas.`;

/**
 * Compact the week's raw transcripts into a single weekly summary, then delete
 * the raw files — but ONLY after the summary is written and verified (so a crash
 * mid-job never loses transcripts).
 */
export async function runChatCompact(opts: {
  model: string;
  now: Date;
}): Promise<{ summarizedFiles: number; usage?: AdvisorUsage }> {
  const dir = advisorPaths.chatsRawDir;
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    files = [];
  }
  // Only consume files settled before this run started (never eat an active chat).
  const cutoff = opts.now.getTime();
  const consume = files.filter((f) => {
    try {
      return statSync(resolve(dir, f)).mtimeMs < cutoff;
    } catch {
      return false;
    }
  });
  if (!consume.length) return { summarizedFiles: 0 };

  const raw = consume.map((f) => readFileSync(resolve(dir, f), "utf8")).join("\n\n---\n\n");
  const res = await runAdvisorOnce({
    model: opts.model,
    systemPrompt: CHAT_COMPACT_SYSTEM,
    prompt: raw,
    allowedTools: [],
    maxTurns: 1,
  });
  const summary = res.text.trim();
  if (!summary) throw new Error("El resumen de chats salió vacío.");

  // Write the weekly summary and VERIFY before deleting any raw file.
  const wk = isoWeekKey(opts.now);
  const file = resolve(advisorPaths.chatsWeeklyDir, `${wk}.md`);
  ensureDir(advisorPaths.chatsWeeklyDir);
  const prev = readTextOrEmpty(file);
  const block = `## Resumen ${opts.now.toISOString()}\n${summary}\n`;
  writeAtomic(file, prev.trim() ? `${prev.trim()}\n\n${block}` : `# Semana ${wk}\n\n${block}`);
  if (!readTextOrEmpty(file).includes(summary.slice(0, 24))) {
    throw new Error("No se pudo escribir el resumen semanal — no se borran los crudos.");
  }

  for (const f of consume) {
    try {
      rmSync(resolve(dir, f));
    } catch {
      /* ignore */
    }
  }
  const { text: _t, ...usage } = res;
  void _t;
  return { summarizedFiles: consume.length, usage };
}
