import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
