# Backup a Proton Drive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botón en Ajustes + cron dominical que copian la BD (VACUUM INTO, verificada) a la carpeta local de Proton Drive con retención 3, y un label «Backup más reciente» que verifica el archivo real en cada render.

**Architecture:** Una lib compartida (`src/lib/backup.ts`) concentra copia+verificación+retención+estado; el Server Action, la ruta cron y el script CLI son wrappers finos sobre ella. El label se calcula server-side en cada render de `/settings` (force-dynamic) leyendo e integrando-verificando el archivo más reciente — nunca un registro almacenado.

**Tech Stack:** better-sqlite3 (`VACUUM INTO` + `PRAGMA integrity_check`), Next Server Actions, cron por crontab + shell script (patrón `cron-sync-prices.sh`), Vitest con filesystem temporal.

**Spec:** `docs/superpowers/specs/2026-07-08-proton-backup-design.md`

## Global Constraints

- Retención exacta: **3** backups más recientes; patrón de nombre `finances-YYYY-MM-DD-HHmm.db`; el borrado toca SOLO archivos que casan con ese patrón dentro de la carpeta gestionada.
- Si la copia o el integrity check fallan, NO se borra ningún backup previo.
- El label deriva SOLO del filesystem en el instante del render (existencia + `PRAGMA integrity_check` del más reciente). Jamás de un registro de BD.
- Env var `PROTON_BACKUP_DIR`; ausente o carpeta inexistente ⇒ botón deshabilitado con motivo + label «no disponible». Nunca crear la carpeta destino desde la app (una carpeta Proton desmontada no debe recrearse en un path muerto).
- Mutaciones: acción con Zod + audit_events + revalidatePath + `ActionResult` discriminado (`./_shared`). Cron: gated por `x-cron-secret` (`CRON_SECRET`), audit actor `system`/source `cron`.
- UI en español; primitivos existentes (`Card`, `Button`, `Badge`); dinero no aplica (no hay importes). Dark y light verificados antes de cerrar.
- Tests sin red y sin depender de `process.env` (todo por parámetros); TypeScript strict; Drizzle only.
- DoD del CLAUDE.md al cierre; deploy = build → kickstart (sin migraciones en esta misión) + línea de crontab + env var real.

---

### Task 1: Lib compartida `src/lib/backup.ts` + refactor del script CLI

**Files:**
- Create: `src/lib/backup.ts`
- Modify: `scripts/backup-db.ts` (pasa a consumir `backupDatabase`)
- Test: `src/lib/__tests__/backup.test.ts`

**Interfaces:**
- Consumes: nada previo. `date-fns` ya es dependencia (`src/lib/format.ts` usa `format`).
- Produces (Tasks 2–3 dependen de estos nombres exactos):

```ts
export const BACKUP_RETENTION = 3;
export const BACKUP_FILE_RE: RegExp; // /^finances-\d{4}-\d{2}-\d{2}-\d{4}\.db$/
export function backupDatabase(destPath: string, sourcePath?: string): { bytes: number };
export type BackupRunResult = { fileName: string; sizeMb: number; kept: number };
export function runBackupToDrive(opts?: { dir?: string; now?: Date; sourcePath?: string }): BackupRunResult;
export type BackupStatus =
  | { state: "verified"; fileName: string; sizeMb: number; backupAt: number; verifiedAt: number }
  | { state: "corrupt"; fileName: string }
  | { state: "empty" }
  | { state: "unavailable"; reason: string };
export function getLatestBackupStatus(dir?: string): BackupStatus;
```

- [ ] **Step 1: Test que falla**

```ts
// src/lib/__tests__/backup.test.ts
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BACKUP_RETENTION,
  backupDatabase,
  getLatestBackupStatus,
  runBackupToDrive,
} from "../backup";

const scratch: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "numo-backup-"));
  scratch.push(d);
  return d;
}
afterEach(() => {
  while (scratch.length) rmSync(scratch.pop()!, { recursive: true, force: true });
});

/** BD SQLite real mínima para copiar. */
function makeSourceDb(dir: string): string {
  const p = join(dir, "source.db");
  const db = new Database(p);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('hola');");
  db.close();
  return p;
}

describe("backupDatabase", () => {
  it("produce una copia íntegra y devuelve su tamaño", () => {
    const dir = tempDir();
    const source = makeSourceDb(dir);
    const dest = join(dir, "out", "copy.db");
    const { bytes } = backupDatabase(dest, source);
    expect(bytes).toBeGreaterThan(0);
    const check = new Database(dest, { readonly: true })
      .prepare("PRAGMA integrity_check")
      .get() as { integrity_check: string };
    expect(check.integrity_check).toBe("ok");
  });

  it("lanza si la fuente no existe", () => {
    const dir = tempDir();
    expect(() => backupDatabase(join(dir, "x.db"), join(dir, "no-existe.db"))).toThrow(
      /source database not found/,
    );
  });
});

describe("runBackupToDrive", () => {
  it("nombra con fecha-hora y aplica retención 3 sin tocar otros archivos", () => {
    const dir = tempDir();
    const dest = tempDir();
    const source = makeSourceDb(dir);
    // 3 backups previos (para retención solo importa el nombre) + 1 ajeno
    for (const f of [
      "finances-2026-07-01-0000.db",
      "finances-2026-07-02-0000.db",
      "finances-2026-07-03-0000.db",
    ]) {
      writeFileSync(join(dest, f), "viejo");
    }
    writeFileSync(join(dest, "notas.txt"), "no me borres");

    const result = runBackupToDrive({
      dir: dest,
      now: new Date("2026-07-08T23:15:00"),
      sourcePath: source,
    });

    expect(result.fileName).toBe("finances-2026-07-08-2315.db");
    expect(result.kept).toBe(BACKUP_RETENTION);
    const files = readdirSync(dest).sort();
    expect(files).toEqual([
      "finances-2026-07-03-0000.db",
      "finances-2026-07-08-2315.db",
      "finances-2026-07-02-0000.db",
      "notas.txt",
    ].sort());
    expect(existsSync(join(dest, "finances-2026-07-01-0000.db"))).toBe(false);
  });

  it("si la copia falla, la retención no se ejecuta — los backups previos quedan intactos", () => {
    const dir = tempDir();
    const dest = tempDir();
    for (const f of [
      "finances-2026-07-01-0000.db",
      "finances-2026-07-02-0000.db",
      "finances-2026-07-03-0000.db",
      "finances-2026-07-04-0000.db",
    ]) {
      writeFileSync(join(dest, f), "viejo");
    }
    expect(() =>
      runBackupToDrive({ dir: dest, sourcePath: join(dir, "no-existe.db") }),
    ).toThrow(/source database not found/);
    // 4 archivos previos: ni la copia (falló) ni la poda (no debe correr).
    expect(readdirSync(dest).filter((f) => f.startsWith("finances-"))).toHaveLength(4);
  });

  it("sin dir definido lanza con mensaje claro; carpeta inexistente también, y no la crea", () => {
    const dir = tempDir();
    const source = makeSourceDb(dir);
    expect(() => runBackupToDrive({ dir: undefined, sourcePath: source })).toThrow(
      /PROTON_BACKUP_DIR/,
    );
    const muerto = join(dir, "desmontada");
    expect(() => runBackupToDrive({ dir: muerto, sourcePath: source })).toThrow(/no existe/);
    expect(existsSync(muerto)).toBe(false);
  });
});

describe("getLatestBackupStatus", () => {
  it("verified: el más reciente existe y pasa integrity_check en este instante", () => {
    const dir = tempDir();
    const dest = tempDir();
    const source = makeSourceDb(dir);
    runBackupToDrive({ dir: dest, now: new Date("2026-07-08T23:15:00"), sourcePath: source });
    const st = getLatestBackupStatus(dest);
    expect(st.state).toBe("verified");
    if (st.state === "verified") {
      expect(st.fileName).toBe("finances-2026-07-08-2315.db");
      expect(st.sizeMb).toBeGreaterThan(0);
      expect(st.verifiedAt).toBeGreaterThan(0);
    }
  });

  it("corrupt: un archivo basura con nombre de backup no pasa la verificación", () => {
    const dest = tempDir();
    writeFileSync(join(dest, "finances-2026-07-08-2315.db"), "esto no es sqlite");
    expect(getLatestBackupStatus(dest)).toEqual({
      state: "corrupt",
      fileName: "finances-2026-07-08-2315.db",
    });
  });

  it("empty y unavailable", () => {
    const dest = tempDir();
    expect(getLatestBackupStatus(dest)).toEqual({ state: "empty" });
    expect(getLatestBackupStatus(undefined)).toMatchObject({ state: "unavailable" });
    expect(getLatestBackupStatus(join(dest, "no-existe"))).toMatchObject({
      state: "unavailable",
    });
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test -- lib/__tests__/backup`
Expected: FAIL (módulo `../backup` no existe).

- [ ] **Step 3: Implementación**

```ts
// src/lib/backup.ts
// Copia de seguridad de la BD SQLite hacia la carpeta local de Proton Drive
// (el cliente de Proton sube a la nube por su cuenta — eso NO es observable
// desde aquí y no se finge). Tres piezas: copia consistente (VACUUM INTO es
// seguro con la app sirviendo en WAL y no necesita -wal/-shm), retención de
// los 3 más recientes, y un estado del último backup calculado SIEMPRE contra
// el filesystem en el momento de la llamada — el label de Ajustes no puede
// mentir porque no lee ningún registro, abre el archivo y lo verifica.
import Database from "better-sqlite3";
import { format } from "date-fns";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

export const BACKUP_RETENTION = 3;
export const BACKUP_FILE_RE = /^finances-\d{4}-\d{2}-\d{2}-\d{4}\.db$/;

function defaultSource(): string {
  return process.env.DATABASE_URL ?? process.env.DB_PATH ?? "data/finances.db";
}

/** Copia consistente + verificación. Lanza (y elimina la copia fallida) si el
 *  integrity_check no es "ok" — nunca deja un backup corrupto en el destino. */
export function backupDatabase(destPath: string, sourcePath: string = defaultSource()): { bytes: number } {
  if (!existsSync(sourcePath)) {
    throw new Error(`source database not found: ${sourcePath}`);
  }
  mkdirSync(dirname(destPath), { recursive: true });
  // VACUUM INTO se niega a sobrescribir un archivo existente.
  if (existsSync(destPath)) unlinkSync(destPath);
  const db = new Database(sourcePath, { readonly: true });
  try {
    db.prepare("VACUUM INTO ?").run(destPath);
  } finally {
    db.close();
  }
  const copy = new Database(destPath, { readonly: true });
  try {
    const check = copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (check.integrity_check !== "ok") {
      copy.close();
      unlinkSync(destPath);
      throw new Error(`backup integrity check failed: ${check.integrity_check}`);
    }
  } finally {
    copy.close();
  }
  return { bytes: statSync(destPath).size };
}

export type BackupRunResult = { fileName: string; sizeMb: number; kept: number };

/** Backup con nombre fechado + retención. La carpeta destino debe existir ya:
 *  si Proton la desmonta no debe recrearse sobre un path muerto. */
export function runBackupToDrive(
  opts: { dir?: string; now?: Date; sourcePath?: string } = {},
): BackupRunResult {
  const dir = opts.dir ?? process.env.PROTON_BACKUP_DIR?.trim();
  if (!dir) throw new Error("PROTON_BACKUP_DIR no está definida en .env.local");
  if (!existsSync(dir)) throw new Error(`la carpeta de destino no existe: ${dir}`);
  const now = opts.now ?? new Date();
  const fileName = `finances-${format(now, "yyyy-MM-dd-HHmm")}.db`;
  const { bytes } = backupDatabase(join(dir, fileName), opts.sourcePath);
  // Retención: el patrón fecha-hora ordena lexicográfico = cronológico.
  const all = readdirSync(dir).filter((f) => BACKUP_FILE_RE.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - BACKUP_RETENTION))) {
    unlinkSync(join(dir, f));
  }
  return {
    fileName,
    sizeMb: bytes / 1024 / 1024,
    kept: Math.min(all.length, BACKUP_RETENTION),
  };
}

export type BackupStatus =
  | { state: "verified"; fileName: string; sizeMb: number; backupAt: number; verifiedAt: number }
  | { state: "corrupt"; fileName: string }
  | { state: "empty" }
  | { state: "unavailable"; reason: string };

/** Estado del último backup, calculado contra el filesystem AHORA: lista la
 *  carpeta, abre el más reciente read-only y le pasa integrity_check. Es la
 *  única fuente del label de Ajustes — por diseño no puede desincronizarse. */
export function getLatestBackupStatus(
  dir: string | undefined = process.env.PROTON_BACKUP_DIR?.trim(),
): BackupStatus {
  if (!dir) return { state: "unavailable", reason: "PROTON_BACKUP_DIR no está definida" };
  if (!existsSync(dir)) return { state: "unavailable", reason: `carpeta no disponible: ${dir}` };
  const all = readdirSync(dir).filter((f) => BACKUP_FILE_RE.test(f)).sort();
  if (all.length === 0) return { state: "empty" };
  const fileName = all[all.length - 1];
  const full = join(dir, fileName);
  try {
    const db = new Database(full, { readonly: true });
    try {
      const check = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      if (check.integrity_check !== "ok") return { state: "corrupt", fileName };
    } finally {
      db.close();
    }
    const st = statSync(full);
    return {
      state: "verified",
      fileName,
      sizeMb: st.size / 1024 / 1024,
      backupAt: st.mtimeMs,
      verifiedAt: Date.now(),
    };
  } catch {
    // No abre como SQLite (basura, truncado, permisos): no está verificado.
    return { state: "corrupt", fileName };
  }
}
```

Refactor `scripts/backup-db.ts` — misma CLI, una sola implementación:

```ts
/**
 * Safe SQLite backup. The live DB runs in WAL mode, so a plain `cp` of
 * data/finances.db can miss everything still sitting in finances.db-wal.
 * `VACUUM INTO` produces a consistent, checkpointed, single-file copy that
 * needs no -wal/-shm siblings and is safe while the app is running.
 *
 * Usage: pnpm db:backup [destination]
 * Default destination: data/backups/finances-backup.db (overwritten each run)
 */
import { resolve } from "node:path";
import { backupDatabase } from "../src/lib/backup";

const dest = resolve(process.argv[2] ?? "data/backups/finances-backup.db");

try {
  const { bytes } = backupDatabase(dest);
  console.log(`backup ok: ${dest} (${(bytes / 1024 / 1024).toFixed(2)} MB, integrity_check=ok)`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
```

Nota de comportamiento preservado: el script sigue saliendo 1 con mensaje en error; el único cambio semántico (deliberado, de la spec) es que una copia que falla el check se ELIMINA en vez de quedarse en disco.

- [ ] **Step 4: Verificar**

Run: `pnpm test -- lib/__tests__/backup && pnpm db:backup && pnpm typecheck && pnpm lint`
Expected: tests PASS; `backup ok: .../data/backups/finances-backup.db (...)`; typecheck/lint limpios.

- [ ] **Step 5: Commit**

```bash
git add src/lib/backup.ts src/lib/__tests__/backup.test.ts scripts/backup-db.ts
git commit -m "feat(backup): lib compartida — VACUUM INTO verificado, retención 3 y estado en vivo"
```

---

### Task 2: Server Action + ruta cron + script shell + config

**Files:**
- Create: `src/actions/backupToDrive.ts`
- Create: `src/app/api/cron/backup/route.ts`
- Create: `scripts/cron-backup.sh` (chmod +x)
- Modify: `package.json` (script `backup:drive`)
- Modify: `.env.local.example` (bloque `PROTON_BACKUP_DIR`)
- Modify: `SPEC.md` §9 (env vars — añadir la línea junto a las demás)
- Test: `src/actions/__tests__/backupToDrive.test.ts`

**Interfaces:**
- Consumes: `runBackupToDrive`, `BackupRunResult` (Task 1); `ActionResult` de `./_shared`; patrón auth de `src/app/api/cron/sync-prices/route.ts`.
- Produces: `backupToDrive(input?: unknown, db?: DB, opts?: { dir?: string; sourcePath?: string }): Promise<ActionResult<BackupRunResult>>` (los `opts` existen para poder testear sin env); ruta `GET|POST /api/cron/backup`.

- [ ] **Step 1: Test que falla**

```ts
// src/actions/__tests__/backupToDrive.test.ts
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
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test -- backupToDrive`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar la acción**

```ts
// src/actions/backupToDrive.ts
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
```

Nota: comprobar el union de `ActionError.code` en `src/lib/domain.ts`; si `"db"` no existe, usar el código genérico de error de esa unión (el que usen otras acciones para fallos de runtime) — no inventar uno nuevo sin necesidad.

- [ ] **Step 4: Ruta cron**

```ts
// src/app/api/cron/backup/route.ts
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
```

- [ ] **Step 5: Script shell + package.json + env example + SPEC**

```bash
# scripts/cron-backup.sh
#!/bin/bash
# Invoked by cron on Sundays at 00:00 Madrid. Hits the backup route.
set -eu

FINANCES_DIR="/Users/nyhzdev/devroom/battlefields/finances"
LOG_DIR="$HOME/.finances/logs"
mkdir -p "$LOG_DIR"

cd "$FINANCES_DIR"

# Load CRON_SECRET from .env.local.
set -a
# shellcheck disable=SC1091
source .env.local
set +a

curl -fsS \
  -H "x-cron-secret: ${CRON_SECRET}" \
  http://localhost:3200/api/cron/backup
```

`chmod +x scripts/cron-backup.sh`.

`package.json` (junto a `sync:prices`):

```json
    "backup:drive": "curl -fsS --max-time 120 -H \"x-cron-secret: $CRON_SECRET\" http://localhost:3200/api/cron/backup",
```

`.env.local.example` (tras el bloque de `CRON_SECRET`):

```
# Carpeta local de Proton Drive donde se guardan los backups de la BD (botón
# de Ajustes + cron dominical). El cliente de Proton la sincroniza a la nube.
# Retención: se conservan los 3 backups más recientes.
PROTON_BACKUP_DIR=
```

`SPEC.md` §9: añadir la línea de `PROTON_BACKUP_DIR` en la tabla/lista de env vars con la misma descripción corta.

- [ ] **Step 6: Verificar**

Run: `pnpm test -- backupToDrive && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS todo.

- [ ] **Step 7: Commit**

```bash
git add src/actions/backupToDrive.ts src/actions/__tests__/backupToDrive.test.ts src/app/api/cron/backup/ scripts/cron-backup.sh package.json .env.local.example SPEC.md
git commit -m "feat(backup): acción de Ajustes + cron dominical a Proton Drive"
```

---

### Task 3: `BackupCard` con label verificado + página de Ajustes

**Files:**
- Create: `src/components/features/settings/BackupCard.tsx`
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `getLatestBackupStatus`/`BackupStatus`/`BackupRunResult` (Task 1, solo `import type` en el cliente), `backupToDrive` (Task 2), `Card`/`Button`/`Badge` primitivos, `formatDateTime` de `@/src/lib/format`.
- Produces: `BackupCard({ status, destDir }: { status: BackupStatus; destDir: string | null })`.

- [ ] **Step 1: Componente**

```tsx
// src/components/features/settings/BackupCard.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { formatDateTime } from "@/src/lib/format";
import { backupToDrive } from "@/src/actions/backupToDrive";
import type { BackupRunResult, BackupStatus } from "@/src/lib/backup";

/** El label deriva de `getLatestBackupStatus()` calculado en el server en CADA
 *  render de /settings (force-dynamic): existencia + integrity_check del
 *  archivo real en ese instante. No hay estado almacenado que pueda mentir. */
function StatusLabel({ status }: { status: BackupStatus }) {
  switch (status.state) {
    case "verified":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="success">Backup verificado</Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {status.fileName} · {status.sizeMb.toFixed(2)} MB · creado{" "}
            {formatDateTime(status.backupAt)} · verificado en esta carga
          </span>
        </div>
      );
    case "corrupt":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="warning">No verificado</Badge>
          <span className="text-xs text-destructive">
            El backup más reciente ({status.fileName}) no supera la verificación
            de integridad.
          </span>
        </div>
      );
    case "empty":
      return (
        <span className="text-sm text-muted-foreground">
          No hay backups en la carpeta todavía.
        </span>
      );
    case "unavailable":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="warning">No disponible</Badge>
          <span className="text-xs text-muted-foreground">{status.reason}</span>
        </div>
      );
  }
}

export function BackupCard({
  status,
  destDir,
}: {
  status: BackupStatus;
  destDir: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<BackupRunResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const disabled = busy || status.state === "unavailable";

  async function handleBackup() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await backupToDrive();
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setResult(res.data);
      // El label se recalcula del disco en el server, no de este resultado.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Copia de seguridad">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Backup más reciente
          </span>
          <StatusLabel status={status} />
        </div>
        <p className="text-sm text-muted-foreground">
          Copia consistente de la base de datos (verificada con{" "}
          <span className="font-mono text-xs">integrity_check</span>) en tu
          carpeta local de Proton Drive. Se conservan las 3 copias más
          recientes; también se genera una automáticamente cada domingo a
          medianoche. La sincronización a la nube la gestiona Proton Drive.
        </p>
        {destDir && (
          <p className="font-mono text-xs break-all text-muted-foreground">{destDir}</p>
        )}
        <div className="flex items-center gap-3">
          <Button onClick={handleBackup} disabled={disabled}>
            {busy ? "Creando backup…" : "Crear backup en Proton Drive"}
          </Button>
          {result && (
            <span className="text-sm text-success">
              {result.fileName} · {result.sizeMb.toFixed(2)} MB · {result.kept}{" "}
              {result.kept === 1 ? "copia" : "copias"} en la carpeta
            </span>
          )}
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
      </div>
    </Card>
  );
}
```

Nota: comprobar los variants reales de `Badge` (`success`/`warning`/`neutral` existen — ver `FreshnessCell`); si `text-success` no existiera como clase, usar la misma clase que use `TopPositionsTable` para plusvalía positiva.

- [ ] **Step 2: Página de Ajustes**

En `src/app/settings/page.tsx` — imports nuevos y card entre `ProfileEditor` y `WipeAppCard`:

```tsx
import { BackupCard } from "@/src/components/features/settings/BackupCard";
import { getLatestBackupStatus } from "@/src/lib/backup";
```

```tsx
      <ProfileEditor initialContent={readProfile()} defaultOpen />

      <BackupCard
        status={getLatestBackupStatus()}
        destDir={process.env.PROTON_BACKUP_DIR?.trim() || null}
      />

      <WipeAppCard />
```

- [ ] **Step 3: Verificar**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: PASS. (La verificación visual dark/light y el click real quedan en Task 4.)

- [ ] **Step 4: Commit**

```bash
git add src/components/features/settings/BackupCard.tsx src/app/settings/page.tsx
git commit -m "feat(settings): BackupCard — botón de backup y label «Backup más reciente» verificado en render"
```

---

### Task 4: Deploy, crontab y verificación end-to-end

**Files:**
- Modify: `.env.local` del Commander (línea `PROTON_BACKUP_DIR`, valor real)
- Modify: crontab del usuario (línea dominical)

- [ ] **Step 1: Suite completa**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: todo PASS.

- [ ] **Step 2: Env var real**

Añadir a `.env.local` (SIN tocar ninguna otra línea; el archivo contiene secretos):

```
PROTON_BACKUP_DIR=/Users/nyhzdev/Library/CloudStorage/ProtonDrive-dany.nyhz@proton.me-folder/finances/numo-app
```

- [ ] **Step 3: Deploy**

Run: `pnpm build && launchctl kickstart -k gui/$(id -u)/com.finances.app` — esperar y verificar `curl -s -o /dev/null -w '%{http_code}' http://localhost:3200/settings` → 200. (Sin migraciones en esta misión.)

- [ ] **Step 4: Prueba end-to-end real**

1. `pnpm backup:drive` → `{ ok: true, fileName: "finances-...", ... }`.
2. `ls` de la carpeta Proton → aparece el archivo.
3. `curl http://localhost:3200/settings` (o navegador) → el label muestra «Backup verificado · finances-… » .
4. Repetir `pnpm backup:drive` 3 veces más (con ≥1 min entre medias o tocando el reloj no — basta con que los minutos difieran) → la carpeta nunca supera 3 archivos `finances-*.db`.
5. Prueba del label que no miente: corromper una copia (`echo x > <archivo más reciente>`), recargar `/settings` → «No verificado»; borrar el corrupto, recargar → verified con el anterior. Restaurar estado sano (opcional: un backup manual más).

- [ ] **Step 5: Crontab**

```bash
(crontab -l; echo '# Finances — backup dominical a Proton Drive, domingo 00:00 Madrid'; echo '0 0 * * 0 /Users/nyhzdev/devroom/battlefields/finances/scripts/cron-backup.sh >> /Users/nyhzdev/.finances/logs/cron.log 2>&1') | crontab -
crontab -l | tail -3   # verificar
```

(`CRON_TZ=Europe/Madrid` ya está en cabecera del crontab.)

- [ ] **Step 6: Verificación visual dark/light**

Dev en 3210 (o el prod 3200 ya desplegado) + Playwright (patrón de la memoria): `/settings` en dark y light — Card «Copia de seguridad» con label verified (badge verde), ruta en mono, botón; estado del resultado tras click. Confirmar también el estado `unavailable` es razonable (se puede simular arrancando dev con `PROTON_BACKUP_DIR=/tmp/no-existe`).

- [ ] **Step 7: Commit de cierre (si hubo retoques) y debrief**

```bash
git add -A && git commit -m "chore: cierre DoD backup Proton Drive"
```
