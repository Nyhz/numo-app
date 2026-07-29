import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { advisorConversations, advisorMessages } from "../db/schema";

export type ConversationTurn = { role: "user" | "assistant"; content: string };

export type ConversationWithMessages = {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ConversationTurn[];
};

export type ConversationMeta = {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
};

/**
 * Pestañas del chat: solo metadatos, más recientes primero. Los mensajes se
 * cargan por conversación bajo demanda — embarcar el historial íntegro de
 * hasta 50 hilos en cada visita a /asesor crecía sin techo con el uso.
 */
export function listConversationMetas(dbc: DB = defaultDb, limit = 50): ConversationMeta[] {
  return dbc
    .select({
      id: advisorConversations.id,
      title: advisorConversations.title,
      createdAt: advisorConversations.createdAt,
      updatedAt: advisorConversations.updatedAt,
    })
    .from(advisorConversations)
    .orderBy(desc(advisorConversations.updatedAt))
    .limit(limit)
    .all();
}

/** Mensajes de un hilo concreto, en orden cronológico. */
export function getConversationMessages(id: string, dbc: DB = defaultDb): ConversationTurn[] {
  return dbc
    .select({ role: advisorMessages.role, content: advisorMessages.content })
    .from(advisorMessages)
    .where(eq(advisorMessages.conversationId, id))
    .orderBy(asc(advisorMessages.createdAt))
    .all()
    .map((r) => ({
      role: r.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: r.content,
    }));
}

/** True if a conversation row exists — guards message persistence against a stale id. */
export function conversationExists(id: string, dbc: DB = defaultDb): boolean {
  return (
    dbc
      .select({ id: advisorConversations.id })
      .from(advisorConversations)
      .where(eq(advisorConversations.id, id))
      .get() != null
  );
}
