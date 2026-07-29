"use server";

import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { getAuditEventDiff, type AuditEventDiff } from "../server/audit";
import type { ActionResult } from "./_shared";

const inputSchema = z.object({
  id: z.string().min(1).max(64),
});

/** Lectura bajo demanda del diff de un evento de auditoría: el listado ya no
 *  embarca los blobs JSON, la tabla los pide al expandir la fila. Solo lee —
 *  sin transacción ni evento de auditoría propio. */
export async function loadAuditDiff(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<AuditEventDiff>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "validation", message: "Evento no válido" },
    };
  }
  const diff = await getAuditEventDiff(parsed.data.id, db);
  if (!diff) {
    return {
      ok: false,
      error: { code: "not_found", message: "Evento no encontrado" },
    };
  }
  return { ok: true, data: diff };
}
