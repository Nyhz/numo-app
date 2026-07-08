"use server";

import { revalidatePath } from "next/cache";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { auditEvents } from "../db/schema";
import type { ActionResult } from "./_shared";
import { runBackupToDrive, type BackupRunResult } from "../lib/backup";

const backupSchema = z.object({}).optional();

/** Copia la BD a la carpeta local de Proton Drive (retención 3). El tercer
 *  parámetro solo existe para los tests — en producción se resuelve por env. */
export async function backupToDrive(
  input?: unknown,
  db: DB = defaultDb,
  opts: { dir?: string; sourcePath?: string } = {},
): Promise<ActionResult<BackupRunResult>> {
  const parsed = backupSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Entrada inválida" } };
  }
  try {
    const result = runBackupToDrive(opts);
    db.insert(auditEvents)
      .values({
        id: ulid(),
        entityType: "backup",
        entityId: result.fileName,
        action: "create",
        actorType: "user",
        source: "ui",
        summary: `backup a Proton Drive (${result.sizeMb.toFixed(2)} MB, ${result.kept} copias)`,
        previousJson: null,
        nextJson: JSON.stringify(result),
        createdAt: Date.now(),
      })
      .run();
    revalidatePath("/settings");
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: { code: "db", message: err instanceof Error ? err.message : String(err) },
    };
  }
}
