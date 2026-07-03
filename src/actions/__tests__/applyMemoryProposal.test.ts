import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Redirect all advisor memory files to a throwaway temp dir — the real
// advisorPaths point at data/advisor/ and must never be touched by tests.
vi.mock("../../lib/advisor/paths", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { resolve } = await import("node:path");
  const ROOT = mkdtempSync(resolve(tmpdir(), "advisor-apply-"));
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

// The Agent SDK spawns a subprocess; stub the whole client wrapper.
const runAdvisorOnceMock = vi.fn();
vi.mock("../../lib/advisor/client", () => ({
  runAdvisorOnce: (...args: unknown[]) => runAdvisorOnceMock(...args),
  AdvisorAuthError: class AdvisorAuthError extends Error {},
  // Mirrors the real class' constructor signature and message shape.
  AdvisorTimeoutError: class AdvisorTimeoutError extends Error {
    constructor(ms: number) {
      super(`El asesor no respondió en ${Math.round(ms / 1000)} s. Inténtalo de nuevo.`);
    }
  },
}));

// recordAdvisorRun writes to the real SQLite singleton — keep it out.
vi.mock("../../lib/advisor/runs", () => ({ recordAdvisorRun: vi.fn() }));

import { advisorPaths } from "../../lib/advisor/paths";
import { AdvisorTimeoutError } from "../../lib/advisor/client";
import { applyMemoryProposal } from "../applyMemoryProposal";

const OK_USAGE = { costUsd: 0, inputTokens: 1, outputTokens: 1, webSearches: 0, isError: false };

function seed(profile: string, proposals: Array<Record<string, unknown>>): void {
  mkdirSync(dirname(advisorPaths.profile), { recursive: true });
  mkdirSync(dirname(advisorPaths.proposals), { recursive: true });
  writeFileSync(advisorPaths.profile, profile, "utf8");
  writeFileSync(advisorPaths.proposals, JSON.stringify(proposals), "utf8");
}

const PROPOSAL = {
  id: "01TESTPROPOSAL000000000000",
  op: "update",
  field: "horizonte",
  value: "15 años",
  reason: "lo dijo en el chat",
  proposedAt: 1750000000000,
};

describe("applyMemoryProposal", () => {
  beforeEach(() => {
    runAdvisorOnceMock.mockReset();
    seed("# Perfil\n- horizonte: 10 años\n", [PROPOSAL]);
  });

  it("confirm applies the LLM-rewritten profile and removes the proposal", async () => {
    runAdvisorOnceMock.mockResolvedValue({ text: "# Perfil\n- horizonte: 15 años", ...OK_USAGE });

    const res = await applyMemoryProposal({ id: PROPOSAL.id, decision: "confirm" });

    expect(res.ok).toBe(true);
    expect(readFileSync(advisorPaths.profile, "utf8")).toContain("15 años");
    expect(JSON.parse(readFileSync(advisorPaths.proposals, "utf8"))).toEqual([]);
    expect(readFileSync(advisorPaths.changelog, "utf8")).toContain("confirmado");
  });

  it("tells the model the byte budget and bounds the call with a timeout", async () => {
    runAdvisorOnceMock.mockResolvedValue({ text: "# Perfil\n- horizonte: 15 años", ...OK_USAGE });

    await applyMemoryProposal({ id: PROPOSAL.id, decision: "confirm" });

    expect(runAdvisorOnceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("4096"),
        timeoutMs: expect.any(Number),
      }),
    );
  });

  it("keeps the proposal and the profile intact when the rewrite exceeds the budget", async () => {
    runAdvisorOnceMock.mockResolvedValue({ text: "x".repeat(5000), ...OK_USAGE });

    const res = await applyMemoryProposal({ id: PROPOSAL.id, decision: "confirm" });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("validation");
    expect(readFileSync(advisorPaths.profile, "utf8")).toContain("10 años");
    expect(JSON.parse(readFileSync(advisorPaths.proposals, "utf8"))).toHaveLength(1);
  });

  it("surfaces the timeout message instead of a generic error", async () => {
    runAdvisorOnceMock.mockRejectedValue(new AdvisorTimeoutError(120_000));

    const res = await applyMemoryProposal({ id: PROPOSAL.id, decision: "confirm" });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toContain("no respondió");
    expect(JSON.parse(readFileSync(advisorPaths.proposals, "utf8"))).toHaveLength(1);
  });

  it("discard removes the proposal without calling the LLM", async () => {
    const res = await applyMemoryProposal({ id: PROPOSAL.id, decision: "discard" });

    expect(res.ok).toBe(true);
    expect(runAdvisorOnceMock).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(advisorPaths.proposals, "utf8"))).toEqual([]);
  });
});
