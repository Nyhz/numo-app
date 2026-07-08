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
    // En un montaje CloudStorage (Proton Drive) un archivo desalojado (dataless)
    // fuerza su materialización al abrirlo, y esta comprobación es síncrona —
    // aceptable con la BD en ~2.5 MB; revisar con guarda `blocks === 0` si crece.
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
