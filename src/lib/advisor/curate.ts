import "server-only";
import { runAdvisorOnce, type AdvisorUsage } from "./client";
import { readDigest, readRecentJournals, writeDigest } from "./memory";

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:markdown|md)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

export function buildCurateSystem(
  focus: string,
  currentDigest: string,
  journal: string,
  now: Date,
): string {
  return `Eres el curador del digest de mercados del usuario (inversor particular español, EUR). Tu trabajo NO es buscar noticias nuevas, sino **reconstruir y depurar** el digest desde cero a partir del registro crudo (journal) y el digest previo, para mantenerlo limpio, denso y vigente.

# Cartera actual
${focus}
Las entradas ESPECÍFICAS de un activo (Riesgos, Oportunidades, Watchlist) deben referirse ÚNICAMENTE a activos de la cartera actual. El journal es un registro histórico: puede mencionar activos que el usuario YA VENDIÓ — no los reintroduzcas en el digest aunque su tesis siga viva. El macro/geopolítica general se mantiene mientras afecte a la cartera actual, sin anclarlo a tickers que ya no están en ella.

# Digest previo
${currentDigest || "(vacío)"}

# Journal crudo (registro de los scans recientes)
${journal || "(vacío)"}

# Tarea
Reescribe el digest COMPLETO aplicando estas reglas:
- Conserva e integra los ítems **[estructural]** que siguen vigentes.
- ELIMINA los **[transitorio]** que ya están resueltos o que no se han reconfirmado en el journal reciente (~14 días).
- Deduplica, fusiona ítems repetidos y reprioriza por relevancia para la cartera.
- Máximo ~800 palabras. Mantén EXACTAMENTE esta estructura:

_Actualizado: ${now.toISOString()}_

## Riesgos activos
## Oportunidades
## Macro y geopolítica
## Watchlist

Cada ítem: "- [estructural|transitorio] <texto> — <relevancia para la cartera> (visto: <fecha>) [fuente]".

Devuelve SOLO el digest markdown, sin comentarios ni explicaciones, sin bloques de código.`;
}

/** Weekly rebuild of the digest from the raw journal (anti-drift compaction). */
export async function runCurate(opts: {
  /** Cartera en vivo (getScanFocus) — sin ella el curador resucitaría del
   *  journal activos ya vendidos. */
  focus: string;
  model: string;
  now: Date;
}): Promise<{ usage: AdvisorUsage }> {
  const currentDigest = readDigest();
  const journal = readRecentJournals(opts.now);
  if (!currentDigest.trim() && !journal.trim()) {
    throw new Error("No hay digest ni journal que curar todavía.");
  }
  const system = buildCurateSystem(opts.focus, currentDigest, journal, opts.now);
  const call = (sys: string) =>
    runAdvisorOnce({
      model: opts.model,
      systemPrompt: sys,
      prompt: "Reconstruye y depura el digest ahora.",
      allowedTools: [],
      maxTurns: 2,
      timeoutMs: 300_000,
    });

  let res = await call(system);
  try {
    writeDigest(stripFences(res.text), { allowShrink: true });
  } catch {
    res = await call(
      `${system}\n\nRECORDATORIO: devuelve SOLO el digest markdown con las 4 secciones (## Riesgos activos, ## Oportunidades, ## Macro y geopolítica, ## Watchlist).`,
    );
    writeDigest(stripFences(res.text), { allowShrink: true }); // throws → caller logs error
  }
  const { text: _t, ...usage } = res;
  void _t;
  return { usage };
}
