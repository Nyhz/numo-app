"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { unsealYear } from "@/src/actions/unsealYear";

type Props = { year: number };

export function UnsealYearButton({ year }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirm() {
    setError(null);
    const result = await unsealYear({ year });
    if (!result.ok) {
      setError(result.error.message);
      // Throw so ConfirmModal skips its onOpenChange(false) and stays open with
      // the error visible — a bare return lets the modal close and hide it.
      throw new Error(result.error.message);
    }
    router.refresh();
  }

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Desellar ejercicio
      </Button>
      <ConfirmModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={`¿Desellar ${year}?`}
        description={
          <div className="space-y-2">
            <p>
              Desellar elimina la instantánea. Las cifras del ejercicio volverán a
              recomputarse en vivo — cualquier edición hecha desde el sellado surtirá
              efecto en silencio. Desella solo si necesitas corregir el registro sellado.
            </p>
            {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          </div>
        }
        confirmLabel="Desellar"
        confirmVariant="danger"
        onConfirm={handleConfirm}
      />
    </>
  );
}
