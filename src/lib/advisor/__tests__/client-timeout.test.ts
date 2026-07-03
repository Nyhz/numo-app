import { beforeEach, describe, expect, it, vi } from "vitest";

// The Agent SDK spawns a subprocess; never load the real thing in tests.
const queryMock = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

import { AdvisorTimeoutError, runAdvisorOnce } from "../client";

describe("runAdvisorOnce timeout", () => {
  beforeEach(() => {
    queryMock.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ADVISOR_ENABLED;
  });

  it("rejects with AdvisorTimeoutError when the SDK never yields, even if it ignores the abort", async () => {
    queryMock.mockImplementation(async function* () {
      // Simulates a hung `claude` subprocess that never emits a result and
      // never honours the abort signal.
      await new Promise(() => {});
      yield undefined;
    });
    await expect(
      runAdvisorOnce({ model: "m", systemPrompt: "s", prompt: "p", timeoutMs: 40 }),
    ).rejects.toBeInstanceOf(AdvisorTimeoutError);
  });

  it("aborts the subprocess signal when the timeout fires", async () => {
    let seenSignal: AbortSignal | undefined;
    queryMock.mockImplementation(async function* ({ options }: { options: { abortController?: AbortController } }) {
      seenSignal = options.abortController?.signal;
      await new Promise(() => {});
      yield undefined;
    });
    await expect(
      runAdvisorOnce({ model: "m", systemPrompt: "s", prompt: "p", timeoutMs: 40 }),
    ).rejects.toBeInstanceOf(AdvisorTimeoutError);
    expect(seenSignal?.aborted).toBe(true);
  });

  it("resolves normally when the SDK answers within the timeout", async () => {
    queryMock.mockImplementation(async function* () {
      yield { type: "result", subtype: "success", result: "hola", usage: { input_tokens: 1, output_tokens: 2 } };
    });
    const res = await runAdvisorOnce({
      model: "m",
      systemPrompt: "s",
      prompt: "p",
      timeoutMs: 5000,
    });
    expect(res.text).toBe("hola");
  });

  it("keeps the previous unbounded behaviour when no timeoutMs is given", async () => {
    queryMock.mockImplementation(async function* () {
      yield { type: "result", subtype: "success", result: "sin límite", usage: {} };
    });
    const res = await runAdvisorOnce({ model: "m", systemPrompt: "s", prompt: "p" });
    expect(res.text).toBe("sin límite");
  });
});
