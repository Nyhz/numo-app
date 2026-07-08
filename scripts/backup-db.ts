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
