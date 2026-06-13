import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { advisorPaths } from "./paths";
import { ensureDir } from "./memory";

const UNSAFE = /[^a-zA-Z0-9_-]/g;

/** Append a chat exchange to the week's raw transcript. Compacted into a weekly
 *  summary every Monday (Phase 3); read for conversational continuity. */
export function appendTranscript(
  sessionId: string,
  userMsg: string,
  assistantMsg: string,
  when: Date,
): void {
  ensureDir(advisorPaths.chatsRawDir);
  const safe = sessionId.replace(UNSAFE, "_").slice(0, 64) || "session";
  const file = resolve(advisorPaths.chatsRawDir, `${safe}.md`);
  appendFileSync(
    file,
    `\n### ${when.toISOString()}\n\n**Tú:** ${userMsg}\n\n**Asesor:** ${assistantMsg}\n`,
    "utf8",
  );
}
