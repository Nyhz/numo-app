import { chatRequestSchema } from "@/src/lib/advisor/schemas";
import {
  AdvisorAuthError,
  AdvisorDisabledError,
  streamAdvisor,
  type AdvisorUsage,
} from "@/src/lib/advisor/client";
import { buildChatPrompt, buildChatSystemPrompt } from "@/src/lib/advisor/prompts";
import { extractAndApplyMemory } from "@/src/lib/advisor/extractMemory";
import { recordAdvisorRun } from "@/src/lib/advisor/runs";
import { appendTranscript } from "@/src/lib/advisor/transcripts";
import {
  getAdvisorContext,
  readDigestForPrompt,
  readProfileForPrompt,
  readRecentChatSummaries,
} from "@/src/server/advisor";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON no válido" }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Datos no válidos" }, { status: 400 });
  }
  const { message, history, sessionId } = parsed.data;

  // Assemble context server-side (live portfolio + memory).
  const portfolio = await getAdvisorContext();
  const systemPrompt = buildChatSystemPrompt({
    portfolio,
    profile: readProfileForPrompt(),
    digest: readDigestForPrompt(),
    summaries: readRecentChatSummaries(),
  });
  const prompt = buildChatPrompt(history, message);
  const model = process.env.ADVISOR_CHAT_MODEL ?? "claude-opus-4-8";
  const memoryModel = process.env.ADVISOR_SCAN_MODEL ?? "claude-sonnet-4-6";
  const startedAt = Date.now();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      let finalText = "";
      let usage: AdvisorUsage | undefined;
      try {
        for await (const chunk of streamAdvisor({
          model,
          systemPrompt,
          prompt,
          allowedTools: ["WebSearch", "WebFetch"],
          maxTurns: 8,
        })) {
          if (chunk.type === "delta") {
            send({ type: "delta", text: chunk.text });
          } else {
            finalText = chunk.text;
            usage = chunk.usage;
          }
        }

        const now = new Date();
        appendTranscript(sessionId, message, finalText, now);
        recordAdvisorRun({
          kind: "chat",
          status: usage?.isError ? "error" : "ok",
          model,
          usage,
          startedAt,
        });

        // Memory extraction (best-effort — never fails the chat).
        let pending: Array<{ id: string; op: string; field: string; value?: string; reason: string }> = [];
        try {
          const r = await extractAndApplyMemory({
            userMessage: message,
            assistantMessage: finalText,
            model: memoryModel,
            now,
          });
          pending = r.pendingProposals;
          recordAdvisorRun({
            kind: "memory",
            status: "ok",
            model: memoryModel,
            usage: r.usage,
            summary: `+${r.added} add · ${pending.length} pendientes`,
            startedAt: now.getTime(),
          });
        } catch (err) {
          recordAdvisorRun({
            kind: "memory",
            status: "error",
            model: memoryModel,
            errorMessage: err instanceof Error ? err.message : String(err),
            startedAt: now.getTime(),
          });
        }

        send({ type: "done", proposals: pending });
        controller.close();
      } catch (err) {
        const friendly =
          err instanceof AdvisorAuthError || err instanceof AdvisorDisabledError
            ? err.message
            : "Error del asesor. Revisa los logs.";
        recordAdvisorRun({
          kind: "chat",
          status: "error",
          model,
          errorMessage: err instanceof Error ? err.message : String(err),
          startedAt,
        });
        send({ type: "error", message: friendly });
        controller.close();
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
