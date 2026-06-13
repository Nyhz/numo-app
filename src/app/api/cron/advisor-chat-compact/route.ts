import { and, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { advisorRuns } from "@/src/db/schema";
import { isoWeekKey } from "@/src/lib/advisor/dates";
import { runChatCompact } from "@/src/lib/advisor/chatCompact";
import { recordAdvisorRun } from "@/src/lib/advisor/runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

let running = false;

async function handle(req: Request): Promise<Response> {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (process.env.ADVISOR_ENABLED === "false") {
    return Response.json({ ok: true, skipped: "advisor disabled" });
  }
  if (running) {
    return Response.json({ ok: false, error: "compact already running" }, { status: 409 });
  }
  running = true;
  const now = new Date();
  const slot = isoWeekKey(now);
  try {
    const done = db
      .select({ id: advisorRuns.id })
      .from(advisorRuns)
      .where(
        and(eq(advisorRuns.kind, "chat_compact"), eq(advisorRuns.slot, slot), eq(advisorRuns.status, "ok")),
      )
      .get();
    if (done) {
      return Response.json({ ok: true, skipped: `semana ${slot} ya compactada` });
    }

    const startedAt = Date.now();
    const model = process.env.ADVISOR_SCAN_MODEL ?? "claude-sonnet-4-6";
    try {
      const r = await runChatCompact({ model, now });
      recordAdvisorRun({
        kind: "chat_compact",
        slot,
        status: "ok",
        model,
        usage: r.usage,
        summary: `${r.summarizedFiles} chats resumidos`,
        startedAt,
      });
      return Response.json({ ok: true, slot, summarizedFiles: r.summarizedFiles });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordAdvisorRun({ kind: "chat_compact", slot, status: "error", model, errorMessage: message, startedAt });
      return Response.json({ ok: false, slot, error: message }, { status: 500 });
    }
  } finally {
    running = false;
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
