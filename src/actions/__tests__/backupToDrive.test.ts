import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// revalidatePath no existe fuera de Next: stub obligatorio en tests de acciones.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { backupToDrive } from "../backupToDrive";
// makeDb: usar el MISMO harness in-memory + migrate que los demás tests de
// acciones de este directorio (copiar el helper local que ya usen; si ninguno
// monta db, replicar el makeDb de src/server/__tests__/dailyBalances.test.ts).
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length) rmSync(scratch.pop()!, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "numo-action-"));
  scratch.push(d);
  return d;
}
function makeSourceDb(dir: string): string {
  const p = join(dir, "source.db");
  const s = new Database(p);
  s.exec("CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t DEFAULT VALUES;");
  s.close();
  return p;
}

describe("backupToDrive", () => {
  it("ok: crea el backup, escribe audit_events y devuelve el resultado", async () => {
    const db = makeDb();
    const src = tempDir();
    const dest = tempDir();
    const result = await backupToDrive({}, db, { dir: dest, sourcePath: makeSourceDb(src) });
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
    const src = tempDir();
    const result = await backupToDrive({}, db, {
      dir: join(src, "no-existe"),
      sourcePath: makeSourceDb(src),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/no existe/);
    expect(db.select().from(schema.auditEvents).all()).toHaveLength(0);
  });
});
