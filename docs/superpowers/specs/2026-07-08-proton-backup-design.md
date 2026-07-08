# Backup a Proton Drive: botón en Ajustes + cron dominical + label verificado

**Fecha:** 2026-07-08 · **Estado:** aprobado

Copias de seguridad de la BD SQLite hacia la carpeta local de Proton Drive (el
cliente de Proton sincroniza a la nube por su cuenta). Tres piezas: botón manual
en Ajustes, backup automático los domingos a medianoche, y un label «Backup más
reciente» que **no puede mentir** porque verifica el archivo real en cada render.

---

## Config

- Env var nueva `PROTON_BACKUP_DIR` en `.env.local` (+ `.env.local.example` y
  SPEC §9). Valor del Commander:
  `/Users/nyhzdev/Library/CloudStorage/ProtonDrive-dany.nyhz@proton.me-folder/finances/numo-app`
  (carpeta ya creada y verificada).
- Si la env var falta o la carpeta no existe/no está montada, el botón se
  deshabilita mostrando el motivo y el label lo refleja. Nunca fallo silencioso.

## Lógica compartida — `src/lib/backup.ts`

- `backupDatabase(destPath)`: extraída de `scripts/backup-db.ts` — `VACUUM INTO`
  (consistente en WAL, no necesita `-wal`/`-shm`, seguro con la app sirviendo) +
  `PRAGMA integrity_check` sobre la copia; lanza si no es `ok`. El script CLI
  pasa a consumir esta función — una sola implementación.
- `runBackupToDrive(dir?, now?)`: compone el nombre `finances-YYYY-MM-DD-HHmm.db`
  (hora local Madrid; minutos evitan colisión el mismo día), llama a
  `backupDatabase`, y tras éxito aplica **retención 3**: lista los
  `finances-*.db` de la carpeta y borra todos menos los 3 más recientes (por
  nombre, que ordena cronológicamente). El borrado toca SOLO archivos con ese
  patrón dentro de la carpeta gestionada. Si la copia o el check fallan, no se
  borra nada. Devuelve `{ fileName, sizeMb, kept }`.
- `getLatestBackupStatus(dir?)` (lectura, usada por el label): estado
  discriminado calculado EN EL MOMENTO de la llamada —
  `{ state: "verified", fileName, sizeMb, verifiedAt, backupAt }` (abre el más
  reciente read-only y le pasa `PRAGMA integrity_check` ahora) |
  `{ state: "corrupt", fileName }` | `{ state: "empty" }` |
  `{ state: "unavailable", reason }` (env var ausente o carpeta inexistente).

## Server Action — `src/actions/backupToDrive.ts`

- Sin input (Zod `z.object({})`). Llama a `runBackupToDrive()`.
- Escribe `audit_events` (entityType `backup`, action `create`, actor `user`,
  source `ui`, `nextJson` con destino/archivo/tamaño). El cron usa actor
  `system`, source `cron`.
- `revalidatePath("/settings")` — el label se recalcula del disco.
- Devuelve `{ ok: true, data: { fileName, sizeMb, kept } } | { ok: false, error }`.

## Cron dominical

- Ruta `src/app/api/cron/backup/route.ts`: gated por `x-cron-secret`
  (`CRON_SECRET`), llama a `runBackupToDrive()`, audit con actor `system`,
  respuesta `{ ok, fileName, sizeMb, kept }`. Misma función que el botón — un
  solo camino de código.
- `scripts/cron-backup.sh`: clon del patrón `cron-sync-prices.sh` (source
  `.env.local`, curl a `localhost:3200/api/cron/backup`, log a
  `~/.finances/logs/`).
- Crontab del Commander: `0 0 * * 0` (domingo 00:00, `CRON_TZ=Europe/Madrid` ya
  presente) — se añade en el deploy.
- `package.json`: `"backup:drive"` (curl local, como `sync:prices`).

## UI — `src/components/features/settings/BackupCard.tsx`

Card «Copia de seguridad» en `/settings` (patrón `WipeAppCard`):

- **Label «Backup más reciente»** alimentado por `getLatestBackupStatus()` en el
  Server Component (la página es `force-dynamic` ⇒ se verifica en cada carga):
  - ✅ «Backup verificado · finances-…db · 2,45 MB · hace 2 h» — existencia e
    integridad comprobadas en este render, no cuando se creó.
  - ❌ «El backup más reciente no supera la verificación de integridad».
  - «No hay backups en la carpeta» / «Carpeta de Proton Drive no disponible».
- Ruta de destino visible en texto muted.
- Botón «Crear backup en Proton Drive» con estado de carga y resultado inline
  (éxito con nombre/tamaño/«3 copias en la carpeta», o el error concreto). Sin
  `ConfirmModal` — no es destructivo.
- Copy honesto del límite: «La sincronización a la nube la gestiona Proton
  Drive» — el label garantiza guardado local + integridad; la subida a la nube
  no es observable desde la app y no se finge.

## Principio del label que no miente

El label jamás lee un registro de «hice un backup»: deriva exclusivamente del
sistema de archivos en el instante del render (listado + integrity_check del
más reciente). Carpeta desmontada, archivo borrado a mano o corrupción
posterior ⇒ el label lo dice en la siguiente carga de Ajustes.

## Tests

- `backup.test.ts` con BD temporal real y carpeta destino temporal: backup crea
  archivo íntegro; retención con 4 archivos deja los 3 más recientes; fallo de
  integridad no borra nada; `getLatestBackupStatus` cubre los 4 estados
  (verified / corrupt — archivo basura / empty / unavailable).
- Sin red en tests (todo es disco local).

## Fuera de alcance

- Verificación de la subida a la nube de Proton (no observable sin su API).
- Retenciones separadas manual/cron (comparten las 3 copias).
- Backup de nada más que el archivo SQLite (data/advisor etc. quedan fuera).
