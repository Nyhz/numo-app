import "server-only";
import { runAdvisorOnce, streamAdvisor, type AdvisorUsage } from "../advisor/client";
import { buildDiscoverSystem, parseProposals, type ConfirmedCandidate, type DiscoverResult } from "./discover";
import { verifyCandidate, type VerifyClients } from "./verify";

// Streaming variant of the discovery run: yields progress events so the UI can
// show the agent's live narration, then per-candidate verification ("3/7…"),
// then a final summary. Returns the full DiscoverResult so the caller persists
// it. Shares the system prompt, parser and verifier with the batch path.

export type DiscoverEvent =
  | { type: "status"; message: string }
  | { type: "thinking"; text: string }
  | { type: "found"; count: number }
  | {
      type: "verify";
      index: number;
      total: number;
      symbol: string;
      name: string;
      status: "confirmed" | "refuted" | "unverifiable";
      detail: string;
    };

export type StreamAgentChunk =
  | { type: "delta"; text: string }
  | { type: "done"; text: string; usage: AdvisorUsage };
export type StreamAgent = (system: string, prompt: string) => AsyncIterable<StreamAgentChunk>;

const PROMPT = "Descubre ahora oportunidades para los baremos indicados.";

export async function* discoverStream(opts: {
  model: string;
  clients: VerifyClients;
  now?: Date;
  streamAgent?: StreamAgent;
}): AsyncGenerator<DiscoverEvent, DiscoverResult> {
  const now = opts.now ?? new Date();
  const system = buildDiscoverSystem();
  const streamAgent: StreamAgent =
    opts.streamAgent ??
    ((sys, prompt) =>
      streamAdvisor({
        model: opts.model,
        systemPrompt: sys,
        prompt,
        allowedTools: ["WebSearch", "WebFetch"],
        maxTurns: 16,
      }));

  yield { type: "status", message: "Rastreando el mercado con búsquedas web…" };

  let finalText = "";
  let usage: AdvisorUsage = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    webSearches: 0,
    isError: false,
  };
  for await (const chunk of streamAgent(system, PROMPT)) {
    if (chunk.type === "delta") {
      yield { type: "thinking", text: chunk.text };
    } else {
      finalText = chunk.text;
      usage = chunk.usage;
    }
  }

  let proposals = parseProposals(finalText);
  if (!proposals) {
    // One non-streaming retry with a stricter reminder.
    yield { type: "status", message: "Reintentando el formato de salida…" };
    const retry = await runAdvisorOnce({
      model: opts.model,
      systemPrompt: `${system}\n\nRECORDATORIO: termina con el bloque \`\`\`json y el array, sin nada después.`,
      prompt: PROMPT,
      allowedTools: ["WebSearch", "WebFetch"],
      maxTurns: 16,
      timeoutMs: 900_000,
    });
    proposals = parseProposals(retry.text);
    usage = retry;
  }
  if (!proposals) throw new Error("El descubrimiento no devolvió un JSON válido tras reintentar.");

  // Dedupe by symbol+criterion.
  const seen = new Set<string>();
  const unique = proposals.filter((p) => {
    const k = `${p.symbol.toUpperCase()}::${p.criterion}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  yield { type: "found", count: unique.length };
  yield { type: "status", message: "Verificando cada candidata con datos reales…" };

  const confirmed: ConfirmedCandidate[] = [];
  let refutedCount = 0;
  let unverifiableCount = 0;
  for (let i = 0; i < unique.length; i++) {
    const p = unique[i];
    const v = await verifyCandidate(p.symbol, p.criterion, opts.clients, now);
    yield {
      type: "verify",
      index: i + 1,
      total: unique.length,
      symbol: p.symbol,
      name: p.name,
      status: v.status,
      detail: v.detail,
    };
    if (v.status === "confirmed") {
      confirmed.push({ ...p, detail: v.detail, metrics: v.metrics });
    } else if (v.status === "refuted") {
      refutedCount++;
    } else {
      unverifiableCount++;
    }
  }

  return {
    confirmed,
    proposalCount: unique.length,
    confirmedCount: confirmed.length,
    refutedCount,
    unverifiableCount,
    usage,
    summary: `${confirmed.length} confirmadas de ${unique.length} propuestas (${refutedCount} descartadas, ${unverifiableCount} sin verificar)`,
  };
}
