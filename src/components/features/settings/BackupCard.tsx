"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { formatDateTime } from "@/src/lib/format";
import { backupToDrive } from "@/src/actions/backupToDrive";
import { toast } from "@/src/lib/toast";
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
      toast.success("Backup subido a Drive");
      // El label se recalcula del disco en el server, no de este resultado.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de conexión.");
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
