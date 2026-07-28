"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { createAssetSplit } from "@/src/actions/createAssetSplit";
import { toast } from "@/src/lib/toast";
import { splitLabel } from "@/src/lib/domain";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: { id: string; name: string }[];
  assets: { id: string; name: string }[];
};

type FormState = {
  accountId: string;
  effectiveDate: string;
  assetId: string;
  newShares: string;
  oldShares: string;
  notes: string;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function CreateSplitModal({ open, onOpenChange, accounts, assets }: Props) {
  const initial = React.useMemo<FormState>(
    () => ({
      accountId: accounts[0]?.id ?? "",
      effectiveDate: todayIso(),
      assetId: assets[0]?.id ?? "",
      newShares: "",
      oldShares: "",
      notes: "",
    }),
    [accounts, assets],
  );

  const [form, setForm] = React.useState<FormState>(initial);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const newShares = Number(form.newShares);
  const oldShares = Number(form.oldShares);
  const factorValid =
    Number.isInteger(newShares) &&
    Number.isInteger(oldShares) &&
    newShares > 0 &&
    oldShares > 0 &&
    newShares !== oldShares;

  function handleOpenChange(next: boolean) {
    if (!next && !pending) {
      setForm(initial);
      setFieldErrors({});
      setBanner(null);
    }
    onOpenChange(next);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});

    const payload = {
      accountId: form.accountId,
      assetId: form.assetId,
      effectiveDate: form.effectiveDate,
      newShares,
      oldShares,
      notes: form.notes.trim() || undefined,
    };

    startTransition(async () => {
      const result = await createAssetSplit(payload);
      if (result.ok) {
        toast.success("Split registrado");
        handleOpenChange(false);
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
      onOpenChange={handleOpenChange}
      title="Registrar split / contra-split"
      description="Canje N nuevas por M antiguas: re-escala la cantidad de toda la posición. No genera venta fiscal ni movimiento de caja; los lotes FIFO conservan fecha de adquisición y coste."
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

        <Field label="Cuenta" errors={fieldErrors.accountId}>
          <select
            value={form.accountId}
            onChange={(e) => update("accountId", e.target.value)}
            className={inputClass}
            required
          >
            {accounts.length === 0 && <option value="">Sin cuentas</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Activo" errors={fieldErrors.assetId}>
            <select
              value={form.assetId}
              onChange={(e) => update("assetId", e.target.value)}
              className={inputClass}
              required
            >
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Fecha efectiva" errors={fieldErrors.effectiveDate}>
            <input
              type="date"
              value={form.effectiveDate}
              onChange={(e) => update("effectiveDate", e.target.value)}
              className={inputClass}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Acciones nuevas (N)" errors={fieldErrors.newShares}>
            <input
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              value={form.newShares}
              onChange={(e) => update("newShares", e.target.value)}
              className={inputClass}
              required
            />
          </Field>

          <Field label="Acciones antiguas (M)" errors={fieldErrors.oldShares}>
            <input
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              value={form.oldShares}
              onChange={(e) => update("oldShares", e.target.value)}
              className={inputClass}
              required
            />
          </Field>
        </div>

        <p className="text-xs text-muted-foreground">
          {factorValid
            ? `Se registrará un ${splitLabel(newShares, oldShares)}: cada ${oldShares} ${
                oldShares === 1 ? "unidad antigua" : "unidades antiguas"
              } pasa${oldShares === 1 ? "" : "n"} a ser ${newShares} ${
                newShares === 1 ? "nueva" : "nuevas"
              }.`
            : "Ejemplos: split 4:1 → N=4, M=1 · contra-split 25→1 → N=1, M=25."}
        </p>

        <Field label="Notas (opcional)" errors={fieldErrors.notes}>
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            className={`${inputClass} min-h-[60px]`}
            maxLength={500}
          />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={pending || !form.accountId || !form.assetId || !factorValid}
          >
            {pending ? "Guardando…" : "Registrar canje"}
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
