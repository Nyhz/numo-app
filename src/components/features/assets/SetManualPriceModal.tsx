"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { setManualPrice } from "@/src/actions/setManualPrice";
import { toast } from "@/src/lib/toast";
import type { Asset } from "@/src/db/schema";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SetManualPriceModal({
  asset,
  open,
  onOpenChange,
}: {
  asset: Asset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [priceNative, setPriceNative] = React.useState("");
  const [priceDate, setPriceDate] = React.useState(() => today());
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  if (!asset) return null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!asset) return;
    setBanner(null);
    setFieldErrors({});

    const payload = {
      assetId: asset.id,
      priceNative: Number(priceNative),
      priceDate,
    };

    startTransition(async () => {
      const result = await setManualPrice(payload);
      if (result.ok) {
        // Sin importe en el mensaje — los toasts viven fuera de <SensitiveValue>.
        toast.success("Precio manual guardado");
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
      title="Fijar precio manual"
      description={`${asset.name} — divisa nativa ${asset.currency}`}
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

        <Field label={`Precio (${asset.currency})`} errors={fieldErrors.priceNative}>
          <SensitiveValue>
            <input
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              value={priceNative}
              onChange={(e) => setPriceNative(e.target.value)}
              className={inputClass}
              required
            />
          </SensitiveValue>
        </Field>

        <Field label="Fecha" errors={fieldErrors.priceDate}>
          <input
            type="date"
            value={priceDate}
            onChange={(e) => setPriceDate(e.target.value)}
            className={inputClass}
            required
          />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar precio"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

function Field({
  label,
  errors,
  children,
}: {
  label: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {errors && errors.length > 0 && (
        <span className="text-xs text-destructive">{errors.join(", ")}</span>
      )}
    </label>
  );
}
