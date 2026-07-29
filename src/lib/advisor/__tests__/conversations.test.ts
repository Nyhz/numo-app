import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deriveTitle, persistChatExchange } from "../conversationStore";
import {
  getConversationMessages,
  listConversationMetas,
} from "../../../server/advisorConversations";
import {
  createConversation,
  deleteConversation,
  renameConversation,
} from "../../../actions/advisorConversations";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("deriveTitle", () => {
  it("collapses whitespace and truncates long messages", () => {
    expect(deriveTitle("  hola   mundo \n ")).toBe("hola mundo");
    expect(deriveTitle("a".repeat(100))).toBe(`${"a".repeat(57)}…`);
  });
  it("falls back when empty", () => {
    expect(deriveTitle("   ")).toBe("Nueva conversación");
  });
});

describe("persistChatExchange + listConversationMetas/getConversationMessages", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("persists the exchange, auto-titles from the first message, and bumps updatedAt", async () => {
    const created = await createConversation(db);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.id;

    persistChatExchange(id, "¿Cómo va mi cartera?", "Va bien.", new Date(1_000), db);

    let convs = listConversationMetas(db);
    expect(convs).toHaveLength(1);
    expect(convs[0].title).toBe("¿Cómo va mi cartera?");
    expect(getConversationMessages(id, db)).toEqual([
      { role: "user", content: "¿Cómo va mi cartera?" },
      { role: "assistant", content: "Va bien." },
    ]);
    expect(convs[0].updatedAt).toBe(1_000);

    // A second exchange keeps the original title and appends in order.
    persistChatExchange(id, "¿Y el riesgo?", "Moderado.", new Date(2_000), db);
    convs = listConversationMetas(db);
    expect(convs[0].title).toBe("¿Cómo va mi cartera?");
    expect(getConversationMessages(id, db).map((m) => m.content)).toEqual([
      "¿Cómo va mi cartera?",
      "Va bien.",
      "¿Y el riesgo?",
      "Moderado.",
    ]);
    expect(convs[0].updatedAt).toBe(2_000);
  });

  it("is a no-op when the conversation does not exist", () => {
    persistChatExchange("MISSING", "hola", "adiós", new Date(), db);
    expect(listConversationMetas(db)).toHaveLength(0);
    expect(getConversationMessages("MISSING", db)).toEqual([]);
  });

  it("orders conversations by most recent activity", async () => {
    const a = await createConversation(db);
    const b = await createConversation(db);
    if (!a.ok || !b.ok) throw new Error("setup failed");
    persistChatExchange(a.data.id, "primera", "ok", new Date(10), db);
    persistChatExchange(b.data.id, "segunda", "ok", new Date(20), db);

    const convs = listConversationMetas(db);
    expect(convs.map((c) => c.id)).toEqual([b.data.id, a.data.id]);
  });
});

describe("conversation actions", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("renames a conversation", async () => {
    const created = await createConversation(db);
    if (!created.ok) throw new Error("setup failed");
    const res = await renameConversation({ id: created.data.id, title: "Plan jubilación" }, db);
    expect(res.ok).toBe(true);
    expect(listConversationMetas(db)[0].title).toBe("Plan jubilación");
  });

  it("rejects renaming an unknown conversation", async () => {
    const res = await renameConversation({ id: "NOPE", title: "x" }, db);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("not_found");
  });

  it("deletes a conversation and cascades its messages", async () => {
    const created = await createConversation(db);
    if (!created.ok) throw new Error("setup failed");
    persistChatExchange(created.data.id, "hola", "adiós", new Date(), db);

    const res = await deleteConversation({ id: created.data.id }, db);
    expect(res.ok).toBe(true);
    expect(listConversationMetas(db)).toHaveLength(0);
    expect(db.select().from(schema.advisorMessages).all()).toHaveLength(0);
  });
});
