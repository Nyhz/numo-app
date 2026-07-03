import { revalidatePath } from "next/cache";
import { db } from "@/src/db/client";
import { AdvisorAuthError, AdvisorDisabledError } from "@/src/lib/advisor/client";
import { recordAdvisorRun } from "@/src/lib/advisor/runs";
import { sendTelegram } from "@/src/lib/advisor/telegram";
import { discoverStream } from "@/src/lib/discover/stream";
import { persistDiscover, realClients } from "@/src/lib/discover/run";

export const dynamic = "force-dynamic";

// In-process mutex (auditoría 2026-07): sin él, cada POST apila un run del
// agente completo — amplificación directa de gasto de crédito Claude.
let running = false;

// Manual "Descubrir ahora" with live progress. Streams the agent's narration +
// per-candidate verification as SSE, persists the confirmed set at the end, and
// records the run in advisor_runs (kind=discover). The weekly cron uses the
// non-streaming runDiscoverScan; both share the verifier + persistence.
export async function POST(): Promise<Response> {
  if (process.env.DISCOVER_ENABLED === "false") {
    return Response.json({ error: "discover desactivado" }, { status: 400 });
  }
  if (running) {
    return Response.json({ error: "ya hay un descubrimiento en curso" }, { status: 409 });
  }
  running = true;

  const model = process.env.DISCOVER_SCAN_MODEL ?? "claude-sonnet-4-6";
  const startedAt = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The run is decoupled from the client: closing the page only stops the
      // live feed. `send` swallows enqueue failures (cancelled stream) so the
      // agent + verification + persistence still complete server-side — results
      // appear on the next visit and the Telegram summary still fires.
      let connected = true;
      const send = (obj: unknown) => {
        if (!connected) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          connected = false; // client gone — keep working, stop emitting
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed/cancelled */
        }
      };
      try {
        const it = discoverStream({ model, clients: realClients() });
        let result;
        while (true) {
          const { value, done } = await it.next();
          if (done) {
            result = value;
            break;
          }
          send(value);
        }

        persistDiscover(db, result.confirmed, startedAt);
        recordAdvisorRun({
          kind: "discover",
          slot: null,
          status: "ok",
          model,
          usage: result.usage,
          summary: result.summary,
          startedAt,
        });
        revalidatePath("/discover");

        if (process.env.DISCOVER_TELEGRAM_ENABLED !== "false" && result.confirmed.length > 0) {
          const lines = result.confirmed.slice(0, 8).map((c) => `• ${c.symbol} — ${c.detail}`);
          await sendTelegram(
            `🔎 Discover: ${result.confirmed.length} oportunidades\n${lines.join("\n")}`,
          );
        }

        send({ type: "done", confirmedCount: result.confirmedCount, summary: result.summary });
        close();
      } catch (err) {
        const friendly =
          err instanceof AdvisorAuthError || err instanceof AdvisorDisabledError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Error en el descubrimiento";
        recordAdvisorRun({
          kind: "discover",
          slot: null,
          status: "error",
          model,
          errorMessage: err instanceof Error ? err.message : String(err),
          startedAt,
        });
        send({ type: "error", message: friendly });
        close();
      } finally {
        running = false;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
