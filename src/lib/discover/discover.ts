import "server-only";
import { z } from "zod";
import { runAdvisorOnce, type AdvisorUsage } from "../advisor/client";
import {
  DISCOVER_CRITERIA,
  DISCOVER_CRITERIA_KEYS,
  type DiscoverMetrics,
} from "./criteria";
import { verifyCandidate, type VerifyClients } from "./verify";

// The discovery agent: Claude scans the web (no fixed universe) and proposes
// tickers + thesis + which baremo they hit. We then verify every proposal with
// real data (verify.ts) and keep only the confirmed ones. The agent discovers
// and argues; the deterministic engine decides — so no invented number reaches
// the UI.

const proposalSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  criterion: z.enum(DISCOVER_CRITERIA_KEYS),
  thesis: z.string().trim().min(1).max(400),
  sourceUrl: z.string().trim().max(500).optional(),
});
const proposalsSchema = z.array(proposalSchema);

export type DiscoverProposal = z.infer<typeof proposalSchema>;

export type ConfirmedCandidate = DiscoverProposal & {
  detail: string;
  metrics: DiscoverMetrics;
};

export type DiscoverResult = {
  confirmed: ConfirmedCandidate[];
  proposalCount: number;
  confirmedCount: number;
  refutedCount: number;
  unverifiableCount: number;
  usage: AdvisorUsage;
  summary: string;
};

/** Agent invocation, injectable so tests run without the SDK / network. */
export type RunAgent = (system: string, prompt: string) => Promise<{ text: string } & AdvisorUsage>;

export function buildDiscoverSystem(): string {
  const list = DISCOVER_CRITERIA.map((c) => `- ${c.key}: ${c.promptHint}`).join("\n");
  return `Eres un analista que DESCUBRE oportunidades de inversión para un inversor particular español que opera en EUR. Rastrea con WebSearch/WebFetch prensa económica, screeners públicos y análisis de mercado recientes para encontrar acciones que encajen en estos baremos:

${list}

Reglas:
- Propón acciones REALES con su TICKER tal como aparece en Yahoo Finance (usa el sufijo de bolsa si no es de EE. UU.: p. ej. ASML.AS, AIR.PA, BMW.DE).
- NO inventes cifras (precios, %). Nosotros verificamos cada candidata con datos reales; tu trabajo es DESCUBRIR y ARGUMENTAR, no calcular.
- Para cada candidata indica a qué baremo (clave exacta de la lista) crees que pertenece.
- Máximo ~5 candidatas por baremo; prioriza calidad sobre cantidad. Evita duplicados.
- Ve NARRANDO brevemente tu proceso en texto a medida que trabajas (qué estás buscando, qué vas encontrando, en qué baremo encaja) — ese texto se muestra en vivo al usuario.
- TERMINA SIEMPRE con un bloque de código \`\`\`json con el array de candidatas (el resto del texto puede ser tu narración, pero el JSON debe ir al final). Cada objeto:
  { "symbol": "TICKER", "name": "Nombre", "criterion": "clave_baremo", "thesis": "por qué es interesante (≤300 caracteres)", "sourceUrl": "https://… (opcional)" }`;
}

/** Extract the JSON array from the agent's reply (fenced block or bare array). */
export function parseProposals(text: string): DiscoverProposal[] | null {
  let raw = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    raw = fence[1];
  } else {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return null;
    raw = text.slice(start, end + 1);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = proposalsSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

export async function runDiscover(opts: {
  model: string;
  clients: VerifyClients;
  now?: Date;
  runAgent?: RunAgent;
}): Promise<DiscoverResult> {
  const now = opts.now ?? new Date();
  const system = buildDiscoverSystem();
  const runAgent: RunAgent =
    opts.runAgent ??
    ((sys, prompt) =>
      runAdvisorOnce({
        model: opts.model,
        systemPrompt: sys,
        prompt,
        allowedTools: ["WebSearch", "WebFetch"],
        maxTurns: 16,
        timeoutMs: 900_000,
      }));

  let res = await runAgent(system, "Descubre ahora oportunidades para los baremos indicados.");
  let proposals = parseProposals(res.text);
  if (!proposals) {
    res = await runAgent(
      `${system}\n\nRECORDATORIO: responde EXCLUSIVAMENTE con el bloque \`\`\`json y el array, sin texto fuera.`,
      "Descubre ahora oportunidades para los baremos indicados.",
    );
    proposals = parseProposals(res.text);
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

  const verified = await mapLimit(unique, 6, async (p) => {
    const v = await verifyCandidate(p.symbol, p.criterion, opts.clients, now);
    return { proposal: p, verdict: v };
  });

  const confirmed: ConfirmedCandidate[] = [];
  let refutedCount = 0;
  let unverifiableCount = 0;
  for (const { proposal, verdict } of verified) {
    if (verdict.status === "confirmed") {
      confirmed.push({ ...proposal, detail: verdict.detail, metrics: verdict.metrics });
    } else if (verdict.status === "refuted") {
      refutedCount++;
    } else {
      unverifiableCount++;
    }
  }

  const { text: _t, ...usage } = res;
  void _t;
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
