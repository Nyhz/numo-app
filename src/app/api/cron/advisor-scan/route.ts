import { and, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { advisorRuns } from "@/src/db/schema";
import { runScan } from "@/src/lib/advisor/scan";
import { readAdvisorConfig } from "@/src/lib/advisor/config";
import { recordAdvisorRun } from "@/src/lib/advisor/runs";
import { sendTelegram } from "@/src/lib/advisor/telegram";
import { getScanFocus } from "@/src/server/advisor";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// In-process guard against overlapping scans (Audit-style, mirrors sync-prices).
let running = false;

/** Idempotency key: one scan per calendar hour (handles duplicate / coalesced fires). */
function slotFor(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T${String(now.getHours()).padStart(2, "0")}`;
}

async function handle(req: Request): Promise<Response> {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (process.env.ADVISOR_ENABLED === "false") {
    return Response.json({ ok: true, skipped: "advisor disabled" });
  }
  if (!readAdvisorConfig().marketIngestEnabled) {
    return Response.json({ ok: true, skipped: "ingesta de mercado pausada" });
  }
  if (running) {
    return Response.json({ ok: false, error: "scan already running" }, { status: 409 });
  }
  running = true;
  const now = new Date();
  const slot = slotFor(now);
  try {
    const done = db
      .select({ id: advisorRuns.id })
      .from(advisorRuns)
      .where(and(eq(advisorRuns.kind, "scan"), eq(advisorRuns.slot, slot), eq(advisorRuns.status, "ok")))
      .get();
    if (done) {
      return Response.json({ ok: true, skipped: `slot ${slot} ya completado` });
    }

    const startedAt = Date.now();
    const model = process.env.ADVISOR_SCAN_MODEL ?? "claude-sonnet-4-6";
    try {
      const focus = await getScanFocus();
      const r = await runScan({ focus, model, now });
      recordAdvisorRun({
        kind: "scan",
        slot,
        status: "ok",
        model,
        usage: r.usage,
        summary: r.summary,
        startedAt,
      });

      // Morning brief → Telegram, only on the 09:00 scan. Best-effort: a failure
      // here never affects the scan (the digest is the primary deliverable).
      let telegramSent = false;
      if (now.getHours() === 9 && r.brief && process.env.ADVISOR_TELEGRAM_ENABLED !== "false") {
        const tgStart = Date.now();
        const tg = await sendTelegram(r.brief);
        telegramSent = tg.ok;
        recordAdvisorRun({
          kind: "telegram",
          slot,
          status: tg.ok ? "ok" : "error",
          errorMessage: tg.ok ? undefined : tg.error,
          summary: tg.ok ? "brief matinal enviado" : undefined,
          startedAt: tgStart,
        });
      }
      return Response.json({ ok: true, slot, summary: r.summary, hadFindings: r.hadFindings, telegramSent });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordAdvisorRun({ kind: "scan", slot, status: "error", model, errorMessage: message, startedAt });
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
