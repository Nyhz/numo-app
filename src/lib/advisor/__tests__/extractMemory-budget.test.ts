import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Redirect all advisor memory files to a throwaway temp dir — the real
// advisorPaths point at data/advisor/ and must never be touched by tests.
vi.mock("../paths", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { resolve } = await import("node:path");
  const ROOT = mkdtempSync(resolve(tmpdir(), "advisor-extract-"));
  return {
    advisorPaths: {
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
    },
  };
});

const runAdvisorOnceMock = vi.fn();
vi.mock("../client", () => ({
  runAdvisorOnce: (...args: unknown[]) => runAdvisorOnceMock(...args),
}));

import { advisorPaths } from "../paths";
import { extractAndApplyMemory } from "../extractMemory";

const OK_USAGE = { costUsd: 0, inputTokens: 1, outputTokens: 1, webSearches: 0, isError: false };

function seedProfile(content: string): void {
  mkdirSync(dirname(advisorPaths.profile), { recursive: true });
  writeFileSync(advisorPaths.profile, content, "utf8");
}

describe("extractAndApplyMemory when the profile is at the byte budget", () => {
  beforeEach(() => {
    runAdvisorOnceMock.mockReset();
  });

  it("reports skipped adds instead of silently dropping them", async () => {
    // Profile ~27 bytes under the 4096 cap: adding the header + bullet overflows it.
    seedProfile(`# Perfil\n${"- nota: x\n".repeat(406)}`);
    runAdvisorOnceMock.mockResolvedValue({
      text: '{"ops":[{"op":"add","field":"edad","value":"35","reason":"lo dijo"}]}',
      ...OK_USAGE,
    });

    const res = await extractAndApplyMemory({
      userMessage: "tengo 35 años",
      assistantMessage: "anotado",
      model: "m",
      now: new Date("2026-07-03T10:00:00Z"),
    });

    expect(res.added).toBe(0);
    expect(res.skippedAdds).toBe(1);
  });

  it("applies adds normally when there is room", async () => {
    seedProfile("# Perfil\n");
    runAdvisorOnceMock.mockResolvedValue({
      text: '{"ops":[{"op":"add","field":"edad","value":"35","reason":"lo dijo"}]}',
      ...OK_USAGE,
    });

    const res = await extractAndApplyMemory({
      userMessage: "tengo 35 años",
      assistantMessage: "anotado",
      model: "m",
      now: new Date("2026-07-03T10:00:00Z"),
    });

    expect(res.added).toBe(1);
    expect(res.skippedAdds).toBe(0);
    expect(readFileSync(advisorPaths.profile, "utf8")).toContain("edad: 35");
  });
});
