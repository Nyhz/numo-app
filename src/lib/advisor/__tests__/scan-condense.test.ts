import { beforeEach, describe, expect, it, vi } from "vitest";

// The Agent SDK spawns a subprocess; never load the real thing in tests.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));
vi.mock("../client", () => ({ runAdvisorOnce: vi.fn() }));
vi.mock("../config", () => ({ readAdvisorConfig: () => ({ marketSources: ["Reuters"] }) }));
vi.mock("../memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../memory")>();
  return {
    ...actual,
    appendJournal: vi.fn(),
    readDigest: vi.fn(() => ""),
    writeDigest: vi.fn(),
  };
});

import { runAdvisorOnce } from "../client";
import { DIGEST_MAX_BYTES, writeDigest } from "../memory";
import { runScan } from "../scan";

const mockedRun = vi.mocked(runAdvisorOnce);
const mockedWrite = vi.mocked(writeDigest);

const USAGE = { costUsd: 0.1, inputTokens: 10, outputTokens: 5, webSearches: 1, isError: false };

const DIGEST_OK = `_Actualizado: 2026-07-31_

## Riesgos activos
- [transitorio] a

## Oportunidades
- b

## Macro y geopolítica
- c

## Watchlist
- d`;

function scanText(digest: string): string {
  return `===JOURNAL===\n- hallazgo [fuente: http://x]\n===DIGEST===\n${digest}\n===SUMMARY===\n1 hallazgo\n===BRIEF===\nBuenos días.`;
}

beforeEach(() => {
  mockedRun.mockReset();
  mockedWrite.mockReset();
});

describe("runScan — autocompactación del digest sobre presupuesto", () => {
  it("no lanza el pase de condensación cuando el digest cabe", async () => {
    mockedRun.mockResolvedValueOnce({ text: scanText(DIGEST_OK), ...USAGE });
    const r = await runScan({ focus: "- BABA", model: "m", now: new Date("2026-07-31T16:00:00Z") });
    expect(mockedRun).toHaveBeenCalledTimes(1);
    expect(mockedWrite).toHaveBeenCalledWith(DIGEST_OK);
    expect(r.usage.costUsd).toBeCloseTo(0.1);
  });

  it("condensa con un segundo pase sin tools y suma el usage de ambos", async () => {
    const oversized = `${DIGEST_OK}\n${"x".repeat(DIGEST_MAX_BYTES)}`;
    mockedRun
      .mockResolvedValueOnce({ text: scanText(oversized), ...USAGE })
      // Cerco markdown a propósito: el pase debe sobrevivir a un modelo que envuelva la salida.
      .mockResolvedValueOnce({ text: `\`\`\`markdown\n${DIGEST_OK}\n\`\`\``, ...USAGE });

    const r = await runScan({ focus: "- BABA", model: "m", now: new Date("2026-07-31T16:00:00Z") });

    expect(mockedRun).toHaveBeenCalledTimes(2);
    const condenseCall = mockedRun.mock.calls[1][0];
    expect(condenseCall.allowedTools).toEqual([]);
    expect(condenseCall.maxTurns).toBe(1);
    expect(condenseCall.systemPrompt).toContain(String(DIGEST_MAX_BYTES));
    expect(condenseCall.prompt).toBe(oversized);
    expect(mockedWrite).toHaveBeenCalledWith(DIGEST_OK); // sin el cerco ```
    expect(r.usage.costUsd).toBeCloseTo(0.2);
    expect(r.usage.inputTokens).toBe(20);
  });

  it("si el pase devuelve vacío conserva el digest original y deja fallar a writeDigest", async () => {
    const oversized = `${DIGEST_OK}\n${"x".repeat(DIGEST_MAX_BYTES)}`;
    mockedRun
      .mockResolvedValueOnce({ text: scanText(oversized), ...USAGE })
      .mockResolvedValueOnce({ text: "   ", ...USAGE });
    mockedWrite.mockImplementationOnce(() => {
      throw new Error("El digest excede el presupuesto.");
    });
    await expect(
      runScan({ focus: "- BABA", model: "m", now: new Date("2026-07-31T16:00:00Z") }),
    ).rejects.toThrow("excede");
    expect(mockedWrite).toHaveBeenCalledWith(oversized);
  });
});
