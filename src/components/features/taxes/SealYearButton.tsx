"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { sealYear } from "@/src/actions/sealYear";
import { toast } from "@/src/lib/toast";

type Props = { year: number; hasUnvalued?: boolean; hasUnknownCountry?: boolean };

export function SealYearButton({ year, hasUnvalued = false, hasUnknownCountry = false }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [acknowledgeCountry, setAcknowledgeCountry] = useState(false);
  const router = useRouter();

  async function handleConfirm() {
    setError(null);
    const result = await sealYear({
      year,
      acknowledgeUnvalued: acknowledge,
      acknowledgeUnknownCountry: acknowledgeCountry,
    });
    if (!result.ok) {
      setError(result.error.message);
      // Throw so ConfirmModal skips its onOpenChange(false) and stays open with
      // the error visible — a bare return lets the modal close and hide it.
      throw new Error(result.error.message);
    }
    toast.success("Ejercicio sellado");
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Sellar ejercicio</Button>
      <ConfirmModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setError(null);
            setAcknowledge(false);
            setAcknowledgeCountry(false);
          }
        }}
        title={`¿Sellar ${year}?`}
        description={
          <div className="space-y-2">
            <p>
              Sellar guarda una instantánea del informe fiscal de este ejercicio. Las
              ediciones posteriores de transacciones de {year} producirán un indicador
              de desviación en lugar de cambiar en silencio las cifras presentadas.
            </p>
            {hasUnvalued ? (
              <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledge}
                  onChange={(e) => setAcknowledge(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Algunos saldos extranjeros a cierre de ejercicio están{" "}
                  <strong>sin valorar</strong> — los umbrales de declaración de
                  M720/M721 podrían ser incorrectos. Sellar de todos modos con estos
                  valores incompletos.
                </span>
              </label>
            ) : null}
            {hasUnknownCountry ? (
              <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledgeCountry}
                  onChange={(e) => setAcknowledgeCountry(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Algunos saldos a cierre de ejercicio pertenecen a cuentas{" "}
                  <strong>sin país asignado</strong> — no se pueden comprobar contra los
                  umbrales de M720/M721 por geografía. Sellar de todos modos.
                </span>
              </label>
            ) : null}
            {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          </div>
        }
        confirmLabel="Sellar"
        confirmVariant="primary"
        onConfirm={handleConfirm}
      />
    </>
  );
}
