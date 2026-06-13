import { resolve } from "node:path";

/** All advisor memory lives under data/advisor/ (gitignored, like the DB). */
const ROOT = resolve(process.cwd(), "data", "advisor");

export const advisorPaths = {
  root: ROOT,
  marketDir: resolve(ROOT, "market"),
  digest: resolve(ROOT, "market", "digest.md"),
  journalFor: (yyyymm: string) => resolve(ROOT, "market", `journal-${yyyymm}.md`),
  personalDir: resolve(ROOT, "personal"),
  profile: resolve(ROOT, "personal", "profile.md"),
  changelog: resolve(ROOT, "personal", "changelog.md"),
  chatsRawDir: resolve(ROOT, "chats", "raw"),
  chatsWeeklyDir: resolve(ROOT, "chats", "weekly"),
  pendingDir: resolve(ROOT, "pending"),
  proposals: resolve(ROOT, "pending", "memory-proposals.json"),
} as const;
