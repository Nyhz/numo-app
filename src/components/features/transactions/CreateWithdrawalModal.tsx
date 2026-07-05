"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { createAssetWithdrawal } from "@/src/actions/createAssetWithdrawal";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: { id: string; name: string }[];
  assets: { id: string; name: string }[];
};

type FormState = {
  accountId: string;
  tradeDate: string;
  assetId: string;
  quantity: string;
  valueEur: string;
  notes: string;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function CreateWithdrawalModal({ open, onOpenChange, accounts, assets }: Props) {
  const initial = React.useMemo<FormState>(
    () => ({
      accountId: accounts[0]?.id ?? "",
      tradeDate: todayIso(),
      assetId: assets[0]?.id ?? "",
      quantity: "",
      valueEur: "",
      notes: "",
    }),
    [accounts, assets],
  );

  const [form, setForm] = React.useState<FormState>(initial);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

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
      tradeDate: form.tradeDate,
      assetId: form.assetId,
      quantity: Number(form.quantity),
      valueEur: Number(form.valueEur),
      notes: form.notes.trim() || undefined,
    };

    startTransition(async () => {
      const result = await createAssetWithdrawal(payload);
      if (result.ok) {
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
      title="Retirar activo"
      description="Salida a custodia externa (wallet propia, otro bróker). Consume la posición sin generar venta fiscal ni movimiento de caja."
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

        <Field label="Fecha" errors={fieldErrors.tradeDate}>
          <input
            type="date"
            value={form.tradeDate}
            onChange={(e) => update("tradeDate", e.target.value)}
            className={inputClass}
            required
          />
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

          <Field label="Cantidad retirada" errors={fieldErrors.quantity}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.quantity}
              onChange={(e) => update("quantity", e.target.value)}
              className={inputClass}
              required
            />
          </Field>
        </div>

        <Field label="Valor en EUR en el momento de la retirada" errors={fieldErrors.valueEur}>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={form.valueEur}
            onChange={(e) => update("valueEur", e.target.value)}
            className={inputClass}
            required
          />
        </Field>

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
            disabled={
              pending || !form.accountId || !form.assetId || !form.quantity || !form.valueEur
            }
          >
            {pending ? "Guardando…" : "Retirar activo"}
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
