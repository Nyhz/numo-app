"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db as defaultDb, type DB } from "../db/client";
import { advisorConversations } from "../db/schema";
import type { ActionResult } from "../lib/domain";
import {
  conversationExists,
  getConversationMessages,
  type ConversationTurn,
  type ConversationWithMessages,
} from "../server/advisorConversations";

const renameSchema = z.object({
  id: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(80),
});

const idSchema = z.object({ id: z.string().trim().min(1).max(64) });

/** Open a fresh thread. Title stays null until the first exchange auto-derives one. */
export async function createConversation(
  db: DB = defaultDb,
): Promise<ActionResult<ConversationWithMessages>> {
  const now = Date.now();
  const id = ulid();
  db.insert(advisorConversations).values({ id, title: null, createdAt: now, updatedAt: now }).run();
  revalidatePath("/asesor");
  return {
    ok: true,
    data: { id, title: null, createdAt: now, updatedAt: now, messages: [] },
  };
}

/** Mensajes de un hilo, bajo demanda: /asesor solo embarca los del hilo
 *  activo y las pestañas cargan el resto al seleccionarlas. Solo lectura. */
export async function loadConversationMessages(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string; messages: ConversationTurn[] }>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Datos no válidos" } };
  }
  const { id } = parsed.data;
  if (!conversationExists(id, db)) {
    return { ok: false, error: { code: "not_found", message: "Conversación no encontrada" } };
  }
  return { ok: true, data: { id, messages: getConversationMessages(id, db) } };
}

/** Rename a thread's tab. */
export async function renameConversation(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string; title: string }>> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Título no válido" } };
  }
  const { id, title } = parsed.data;
  const res = db
    .update(advisorConversations)
    .set({ title })
    .where(eq(advisorConversations.id, id))
    .run();
  if (res.changes === 0) {
    return { ok: false, error: { code: "not_found", message: "Conversación no encontrada" } };
  }
  revalidatePath("/asesor");
  return { ok: true, data: { id, title } };
}

/** End a thread: delete it and its messages (cascade). The AI's memory lives in
 *  the filesystem transcripts, so nothing is lost there. */
export async function deleteConversation(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Datos no válidos" } };
  }
  const { id } = parsed.data;
  const res = db.delete(advisorConversations).where(eq(advisorConversations.id, id)).run();
  if (res.changes === 0) {
    return { ok: false, error: { code: "not_found", message: "Conversación no encontrada" } };
  }
  revalidatePath("/asesor");
  return { ok: true, data: { id } };
}
