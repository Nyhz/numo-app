import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { auditEvents, taxDeclaredBaselines } from "../../db/schema";
import { deleteDeclaredBaseline, setDeclaredBaseline } from "../setDeclaredBaseline";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("setDeclaredBaseline / deleteDeclaredBaseline", () => {
  it("creates a baseline with an audit event", async () => {
    const db = makeDb();
    const res = await setDeclaredBaseline(
      { year: 2025, category: "broker-securities", amountEur: 59_278.235, notes: "AEAT" },
      db,
    );
    expect(res.ok).toBe(true);
    const row = db.select().from(taxDeclaredBaselines).all()[0];
    // EUR amounts are rounded to cents at the boundary
    expect(row.amountEur).toBe(59_278.24);
    expect(row.notes).toBe("AEAT");
    const audit = db.select().from(auditEvents).where(eq(auditEvents.action, "create")).all();
    expect(audit).toHaveLength(1);
    expect(audit[0].entityType).toBe("tax_declared_baseline");
  });

  it("upserts on (year, category) instead of duplicating", async () => {
    const db = makeDb();
    await setDeclaredBaseline({ year: 2025, category: "crypto", amountEur: 51_000 }, db);
    const res = await setDeclaredBaseline({ year: 2025, category: "crypto", amountEur: 52_500 }, db);
    expect(res.ok).toBe(true);
    const rows = db.select().from(taxDeclaredBaselines).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].amountEur).toBe(52_500);
    expect(db.select().from(auditEvents).where(eq(auditEvents.action, "update")).all()).toHaveLength(1);
  });

  it("rejects invalid input before touching the DB", async () => {
    const db = makeDb();
    const res = await setDeclaredBaseline({ year: 2025, category: "real-estate", amountEur: -1 }, db);
    expect(res.ok).toBe(false);
    expect(db.select().from(taxDeclaredBaselines).all()).toHaveLength(0);
  });

  it("deletes a baseline with an audit event", async () => {
    const db = makeDb();
    await setDeclaredBaseline({ year: 2025, category: "bank-accounts", amountEur: 60_000 }, db);
    const id = db.select().from(taxDeclaredBaselines).all()[0].id;
    const res = await deleteDeclaredBaseline({ id }, db);
    expect(res.ok).toBe(true);
    expect(db.select().from(taxDeclaredBaselines).all()).toHaveLength(0);
    expect(db.select().from(auditEvents).where(eq(auditEvents.action, "delete")).all()).toHaveLength(1);
  });

  it("returns not_found for an unknown id", async () => {
    const db = makeDb();
    const res = await deleteDeclaredBaseline({ id: "nope" }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("not_found");
  });
});
