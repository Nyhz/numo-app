import "server-only";
import { runAdvisorOnce, type AdvisorUsage } from "./client";
import { readAdvisorConfig } from "./config";
import { appendJournal, readDigest, writeDigest } from "./memory";

const MARK = {
  journal: "===JOURNAL===",
  digest: "===DIGEST===",
  summary: "===SUMMARY===",
  brief: "===BRIEF===",
} as const;

export type ScanOutput = { journal: string; digest: string; summary: string; brief: string };

/** Parse the delimiter-framed scan output. Robust to surrounding prose; markdown
 *  inside the digest is preserved verbatim (no JSON escaping pitfalls). The BRIEF
 *  section is optional. */
export function parseScanOutput(text: string): ScanOutput | null {
  const ji = text.indexOf(MARK.journal);
  const di = text.indexOf(MARK.digest);
  const si = text.indexOf(MARK.summary);
  if (ji === -1 || di === -1 || si === -1 || !(ji < di && di < si)) return null;
  const bi = text.indexOf(MARK.brief);
  const journal = text.slice(ji + MARK.journal.length, di).trim();
  const digest = text.slice(di + MARK.digest.length, si).trim();
  const summaryEnd = bi > si ? bi : text.length;
  const summary = text.slice(si + MARK.summary.length, summaryEnd).trim();
  const brief = bi > si ? text.slice(bi + MARK.brief.length).trim() : "";
  if (!digest) return null;
  return { journal, digest, summary: summary.slice(0, 200), brief };
}

export function buildScanSystem(focus: string, sources: string[], currentDigest: string): string {
  return `Eres el analista de mercados del Commander, un inversor particular español que opera en EUR. Tu trabajo: escanear la prensa económica en busca de noticias RELEVANTES PARA SU CARTERA y para el macro/geopolítica que le afecta, y mantener actualizado un "digest" conciso.

# Foco (busca sobre esto)
${focus}
Además, el macro que afecta a esa exposición: tipos de interés (BCE/Fed), EUR/USD, inflación, tecnología de EE. UU., emergentes de Asia, oro, criptomonedas y geopolítica relevante.

# Fuentes prioritarias
Prioriza prensa económica reputada: ${sources.join(", ")}. IGNORA redes sociales, foros y rumores sin fundamento. Cita siempre la fuente con su URL.

# Digest actual
${currentDigest || "(vacío — es el primer escaneo)"}

# Tarea
1. Usa WebSearch para encontrar noticias recientes y relevantes según el foco.
2. Devuelve la salida EXACTAMENTE con estos tres delimitadores, en este orden y sin texto fuera de ellos:

${MARK.journal}
(viñetas de los hallazgos NUEVOS de hoy, una por línea: "- <titular> — <por qué importa para la cartera> [fuente: URL]". Si no hay nada nuevo relevante, escribe "- (sin novedades relevantes)".)
${MARK.digest}
(El digest COMPLETO actualizado. Integra lo nuevo relevante, refresca lo que sigue vivo y ELIMINA lo resuelto o caducado. Máximo ~800 palabras. Estructura EXACTA:
_Actualizado: <fecha-hora ISO>_

## Riesgos activos
## Oportunidades
## Macro y geopolítica
## Watchlist

Cada ítem: "- [estructural|transitorio] <texto> — <relevancia para la cartera> (visto: <fecha>) [fuente]". Los ítems "estructural" persisten; los "transitorio" se caen cuando dejan de ser relevantes.)
${MARK.summary}
(Una sola línea: nº de hallazgos y el titular más importante.)
${MARK.brief}
(Resumen matinal en TEXTO PLANO de máximo 5 puntos: lo más importante de hoy para la cartera, breve y directo, listo para enviarse por Telegram. Empieza con un saludo corto tipo "Buenos días.". NO trates al usuario de "Commander" ni uses ese término en el brief.)

Reglas: no inventes; calidad sobre cantidad; si no hay novedades, refresca solo la fecha del digest y conserva lo vigente.`;
}

export type ScanResult = {
  summary: string;
  usage: AdvisorUsage;
  hadFindings: boolean;
  /** Morning brief for Telegram (only sent on the 09:00 scan). */
  brief: string;
};

/** Run one market scan: guided WebSearch → append journal + update digest. */
export async function runScan(opts: {
  focus: string;
  model: string;
  now: Date;
}): Promise<ScanResult> {
  const sources = readAdvisorConfig().marketSources;
  const currentDigest = readDigest();
  const system = buildScanSystem(opts.focus, sources, currentDigest);

  const call = (sys: string) =>
    runAdvisorOnce({
      model: opts.model,
      systemPrompt: sys,
      prompt: "Realiza ahora el escaneo de mercado.",
      allowedTools: ["WebSearch", "WebFetch"],
      maxTurns: 16,
    });

  let res = await call(system);
  let parsed = parseScanOutput(res.text);
  if (!parsed) {
    res = await call(
      `${system}\n\nRECORDATORIO: responde EXACTAMENTE con los tres delimitadores ${MARK.journal} ${MARK.digest} ${MARK.summary}, sin nada fuera de ellos.`,
    );
    parsed = parseScanOutput(res.text);
  }
  if (!parsed) throw new Error("El scan no devolvió el formato esperado tras reintentar.");

  appendJournal(parsed.journal || "- (sin novedades relevantes)", opts.now);
  writeDigest(parsed.digest); // validates (budget/sections/anti-wipe) + backups; throws on bad output

  const { text: _t, ...usage } = res;
  void _t;
  const hadFindings = !/sin novedades/i.test(parsed.journal);
  return { summary: parsed.summary || "scan", usage, hadFindings, brief: parsed.brief };
}
