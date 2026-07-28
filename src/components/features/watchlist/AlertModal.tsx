"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { createAlert } from "@/src/actions/createAlert";
import { updateAlert } from "@/src/actions/updateAlert";
import { toast } from "@/src/lib/toast";
import type { AlertKind, PriceAlert } from "@/src/db/schema";

const KIND_LABELS: Record<AlertKind, string> = {
  price_below: "El precio baja de",
  price_above: "El precio sube a",
};

export function AlertModal({
  assetId,
  assetName,
  currency,
  alert,
  open,
  onOpenChange,
}: {
  assetId: string;
  assetName: string;
  currency: string;
  /** When provided the modal edits this alert; otherwise it creates a new one. */
  alert: PriceAlert | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const editing = alert != null;
  const [kind, setKind] = React.useState<AlertKind>(alert?.kind ?? "price_below");
  const [threshold, setThreshold] = React.useState(alert ? String(alert.threshold) : "");
  const [notifyTelegram, setNotifyTelegram] = React.useState(alert?.notifyTelegram ?? false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // The form seeds its initial state from `alert` on mount; WatchlistCard keys
  // this modal by alert id + open state, so it remounts fresh each time — no
  // effect needed to re-seed.

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = editing
        ? await updateAlert({ id: alert.id, kind, threshold: Number(threshold), notifyTelegram })
        : await createAlert({ assetId, kind, threshold: Number(threshold), notifyTelegram });
      if (result.ok) {
        toast.success(editing ? "Alerta actualizada" : "Alerta creada");
        onOpenChange(false);
        return;
      }
      if (result.error.code === "validation" && result.error.fieldErrors) {
        setFieldErrors(result.error.fieldErrors);
      } else {
        setBanner(result.error.message);
      }
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Editar alerta" : "Nueva alerta"}
      description={`${assetName} — umbral en ${currency}`}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {banner && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {banner}
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Condición</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AlertKind)}
            className={inputClass}
          >
            {(Object.keys(KIND_LABELS) as AlertKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{`Umbral (${currency})`}</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.0001"
            min="0"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className={inputClass}
            required
          />
          {fieldErrors.threshold && fieldErrors.threshold.length > 0 && (
            <span className="text-xs text-destructive">{fieldErrors.threshold.join(", ")}</span>
          )}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notifyTelegram}
            onChange={(e) => setNotifyTelegram(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span>También avisarme por Telegram</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear alerta"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";
