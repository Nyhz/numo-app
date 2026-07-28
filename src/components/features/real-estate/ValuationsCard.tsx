"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { addValuation, deleteValuation } from "@/src/actions/realEstate";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { Modal } from "@/src/components/ui/Modal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { toast, toastResult } from "@/src/lib/toast";
import type { PropertySummary } from "@/src/server/realEstate";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

export function ValuationsCard({ summary }: { summary: PropertySummary }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [date, setDate] = React.useState("");
  const [value, setValue] = React.useState("");
  const [note, setNote] = React.useState("");
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    startTransition(async () => {
      const res = await addValuation({
        propertyId: summary.property.id,
        valuationDate: date,
        valueEur: Number(value),
        note: note || null,
      });
      if (res.ok) {
        toast.success("Tasación registrada");
        setAdding(false);
        setDate("");
        setValue("");
        setNote("");
        router.refresh();
        return;
      }
      setBanner(res.error.message);
    });
  }

  const rows = [...summary.valuations].sort((a, b) =>
    b.valuationDate.localeCompare(a.valuationDate),
  );

  return (
    <Card
      title="Valoraciones"
      action={
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          Actualizar valor
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin valoraciones — el inmueble computa a precio de compra (
          <SensitiveValue>{formatEur(summary.property.purchasePriceEur)}</SensitiveValue>).
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((v) => (
            <div key={v.id} className="flex items-center justify-between text-sm">
              <span>
                {v.valuationDate} — <SensitiveValue>{formatEur(v.valueEur)}</SensitiveValue>
                {v.note ? <span className="text-muted-foreground"> · {v.note}</span> : null}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(v.id)}>
                Eliminar
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={adding}
        onOpenChange={(open) => !pending && setAdding(open)}
        title="Actualizar valor del inmueble"
        description="Tasación, reforma o estimación — mueve el equity desde su fecha."
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          {banner ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {banner}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Fecha</span>
              <input
                type="date"
                className={inputClass}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Valor (€)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Nota (opcional)</span>
            <input
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tasación, reforma cocina…"
            />
          </label>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAdding(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !date || !value}>
              {pending ? "Guardando…" : "Guardar valoración"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Eliminar valoración"
        description="El valor vigente volverá a la valoración anterior (o al precio de compra)."
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteValuation({ id: deleting });
          if (toastResult(res, "Tasación eliminada")) {
            setDeleting(null);
            router.refresh();
          }
        }}
      />
    </Card>
  );
}
