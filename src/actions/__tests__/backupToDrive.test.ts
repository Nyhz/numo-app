import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";

// revalidatePath no existe fuera de Next: stub obligatorio en tests de acciones.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// El action ya no acepta opts de ruta (review final F2: eran controlables
// desde el wire). Se prueba mockeando la lib en vez de ensuciar process.env
// con carpetas temporales.
const runBackupToDriveMock = vi.fn();
vi.mock("../../lib/backup", () => ({
  runBackupToDrive: (...args: unknown[]) => runBackupToDriveMock(...args),
}));

import { backupToDrive } from "../backupToDrive";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

afterEach(() => {
  runBackupToDriveMock.mockReset();
});

describe("backupToDrive", () => {
  it("ok: crea el backup, escribe audit_events y devuelve el resultado", async () => {
    const db = makeDb();
    runBackupToDriveMock.mockReturnValue({
      fileName: "finances-2026-07-06-0000.db",
      sizeMb: 1.23,
      kept: 1,
    });
    const result = await backupToDrive({}, db);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.fileName).toMatch(/^finances-\d{4}-\d{2}-\d{2}-\d{4}\.db$/);
      expect(result.data.kept).toBe(1);
    }
    const audit = db.select().from(schema.auditEvents).all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityType: "backup", action: "create", actorType: "user", source: "ui" });
  });

  it("carpeta no disponible: devuelve error discriminado y NO escribe audit", async () => {
    const db = makeDb();
    runBackupToDriveMock.mockImplementation(() => {
      throw new Error("la carpeta de destino no existe: X");
    });
    const result = await backupToDrive({}, db);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/no existe/);
    expect(db.select().from(schema.auditEvents).all()).toHaveLength(0);
  });
});
