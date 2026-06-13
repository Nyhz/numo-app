import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { advisorPaths } from "./paths";

const PROFILE_MAX = Number(process.env.ADVISOR_PROFILE_MAX_BYTES ?? 4096);

export class MemoryValidationError extends Error {}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function readTextOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Write via temp + rename so a crash never leaves a half-written file. */
export function writeAtomic(path: string, content: string): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

/** Roll path → path.bak.1 → path.bak.2 → … (keep N) before overwriting. */
export function rotateBackups(path: string, keep = 3): void {
  if (!existsSync(path)) return;
  for (let i = keep - 1; i >= 1; i--) {
    const from = `${path}.bak.${i}`;
    if (existsSync(from)) copyFileSync(from, `${path}.bak.${i + 1}`);
  }
  copyFileSync(path, `${path}.bak.1`);
}

// ── Personal memory ──────────────────────────────────────────────────────────

export function readProfile(): string {
  return readTextOrEmpty(advisorPaths.profile);
}

export function writeProfile(content: string): void {
  const trimmed = content.trim();
  if (!trimmed) throw new MemoryValidationError("El perfil no puede quedar vacío.");
  if (Buffer.byteLength(trimmed, "utf8") > PROFILE_MAX) {
    throw new MemoryValidationError(`El perfil excede ${PROFILE_MAX} bytes.`);
  }
  rotateBackups(advisorPaths.profile);
  writeAtomic(advisorPaths.profile, `${trimmed}\n`);
}

/** Append-only audit of every change to the profile. Never rewritten. */
export function appendChangelog(line: string, when: Date): void {
  ensureDir(dirname(advisorPaths.changelog));
  appendFileSync(advisorPaths.changelog, `- ${when.toISOString()} — ${line}\n`, "utf8");
}

// ── Market memory (journal + digest) ─────────────────────────────────────────

const DIGEST_MAX = Number(process.env.ADVISOR_DIGEST_MAX_BYTES ?? 8192);
const DIGEST_SECTIONS = ["## Riesgos activos", "## Oportunidades", "## Macro", "## Watchlist"];

export function readDigest(): string {
  return readTextOrEmpty(advisorPaths.digest);
}

/** Raw journal for the current + previous month — the source for the weekly rebuild. */
export function readRecentJournals(now: Date): string {
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev = readTextOrEmpty(advisorPaths.journalFor(key(prevMonth)));
  const cur = readTextOrEmpty(advisorPaths.journalFor(key(now)));
  return [prev, cur].filter((s) => s.trim()).join("\n");
}

/** Append a timestamped scan entry to the current month's journal (append-only). */
export function appendJournal(entry: string, when: Date): void {
  const yyyymm = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
  const file = advisorPaths.journalFor(yyyymm);
  ensureDir(dirname(file));
  appendFileSync(file, `\n### ${when.toISOString()} — scan\n${entry.trim()}\n`, "utf8");
}

/**
 * Validate + back up + atomically write the market digest. Guards against the
 * agent producing garbage or wiping it: enforces the byte budget, requires the
 * expected section structure, and rejects a catastrophic shrink (unless
 * `allowShrink`, used by the weekly rebuild).
 */
export function writeDigest(content: string, opts: { allowShrink?: boolean } = {}): void {
  const trimmed = content.trim();
  if (!trimmed) throw new MemoryValidationError("El digest no puede quedar vacío.");
  if (Buffer.byteLength(trimmed, "utf8") > DIGEST_MAX) {
    throw new MemoryValidationError(`El digest excede ${DIGEST_MAX} bytes.`);
  }
  const sectionsFound = DIGEST_SECTIONS.filter((s) => trimmed.includes(s)).length;
  if (sectionsFound < 2) {
    throw new MemoryValidationError("El digest no tiene la estructura esperada (faltan secciones).");
  }
  if (!opts.allowShrink) {
    const prevLen = Buffer.byteLength(readDigest().trim(), "utf8");
    if (prevLen > 400 && Buffer.byteLength(trimmed, "utf8") < prevLen * 0.3) {
      throw new MemoryValidationError(
        "El digest nuevo encoge demasiado respecto al anterior (posible borrado accidental).",
      );
    }
  }
  rotateBackups(advisorPaths.digest);
  writeAtomic(advisorPaths.digest, `${trimmed}\n`);
}
