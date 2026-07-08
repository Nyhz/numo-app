import { ulid } from "ulid";
import { db } from "../../../../db/client";
import { auditEvents } from "../../../../db/schema";
import { runBackupToDrive } from "../../../../lib/backup";

// Backup dominical a Proton Drive (crontab: 0 0 * * 0 Europe/Madrid). Mismo
// camino de código que el botón de Ajustes — runBackupToDrive — con actor
// system para distinguirlo en la auditoría.
async function handle(req: Request): Promise<Response> {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || !secret || secret !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = runBackupToDrive();
    db.insert(auditEvents)
      .values({
        id: ulid(),
        entityType: "backup",
        entityId: result.fileName,
        action: "create",
        actorType: "system",
        source: "cron",
        summary: `backup dominical a Proton Drive (${result.sizeMb.toFixed(2)} MB, ${result.kept} copias)`,
        previousJson: null,
        nextJson: JSON.stringify(result),
        createdAt: Date.now(),
      })
      .run();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
