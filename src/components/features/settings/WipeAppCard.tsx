"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { wipeApp } from "@/src/actions/wipeApp";
import { toast } from "@/src/lib/toast";

export function WipeAppCard() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    if (confirmation !== "WIPE") {
      setError("Escribe WIPE para confirmar");
      throw new Error("confirmation missing");
    }
    const result = await wipeApp({ confirmation });
    if (!result.ok) {
      setError(result.error.message);
      throw new Error(result.error.message);
    }
    toast.success("Base de datos vaciada");
    setConfirmation("");
    router.refresh();
  }

  return (
    <Card title="Zona de peligro">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">
          Borra todo excepto el histórico de precios en bruto (barras de
          Yahoo / CoinGecko) y el catálogo de activos. Cuentas, transacciones,
          valoraciones, tipos de cambio, filas fiscales y entradas de
          auditoría desaparecen.
        </p>
        <div>
          <Button variant="danger" onClick={() => setOpen(true)}>
            Borrado total
          </Button>
        </div>
      </div>

      <ConfirmModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setConfirmation("");
            setError(null);
          }
        }}
        title="¿Borrado total de la aplicación?"
        description={
          <div className="flex flex-col gap-3">
            <p>
              Elimina permanentemente todo excepto el catálogo de activos y el
              histórico de precios en bruto (barras de Yahoo / CoinGecko).
              Cuentas, transacciones, movimientos de efectivo, valoraciones,
              tipos de cambio, filas fiscales y entradas de auditoría se
              borran por completo.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                Escribe <span className="font-mono font-semibold">WIPE</span>{" "}
                para confirmar:
              </span>
              <input
                type="text"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoFocus
                className="rounded-md border border-border bg-background px-2 py-1 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-destructive/40"
              />
            </label>
            {error && (
              <p className="text-sm font-medium text-destructive">{error}</p>
            )}
          </div>
        }
        confirmLabel="Borrar todo"
        confirmVariant="danger"
        onConfirm={handleConfirm}
      />
    </Card>
  );
}
