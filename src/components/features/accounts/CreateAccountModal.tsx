"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { createAccount } from "@/src/actions/accounts";
import { ACCOUNT_TYPES } from "@/src/actions/_constants";
import { ACCOUNT_COUNTRY_LABELS, accountTypeLabel } from "@/src/lib/labels";

type FormState = {
  name: string;
  accountType: string;
  currency: string;
  countryCode: string;
  openingBalanceNative: string;
  notes: string;
};

const INITIAL: FormState = {
  name: "",
  accountType: "savings",
  currency: "EUR",
  countryCode: "",
  openingBalanceNative: "0",
  notes: "",
};

export function CreateAccountModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function reset() {
    setForm(INITIAL);
    setFieldErrors({});
    setBanner(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});

    const payload = {
      name: form.name,
      accountType: form.accountType,
      currency: form.currency.toUpperCase(),
      countryCode: form.countryCode === "" ? undefined : form.countryCode,
      openingBalanceNative: Number(form.openingBalanceNative),
      notes: form.notes.trim() ? form.notes : undefined,
    };

    startTransition(async () => {
      const result = await createAccount(payload);
      if (result.ok) {
        reset();
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
      onOpenChange={(next) => {
        if (!next && !pending) reset();
        onOpenChange(next);
      }}
      title="Nueva cuenta"
      description="Registra el saldo de efectivo de un bróker, banco o monedero."
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

        <Field label="Nombre" errors={fieldErrors.name}>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className={inputClass}
            maxLength={80}
            required
          />
        </Field>

        <Field label="Tipo" errors={fieldErrors.accountType}>
          <select
            value={form.accountType}
            onChange={(e) => update("accountType", e.target.value)}
            className={inputClass}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {accountTypeLabel(t)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            Solo «Ahorro» mantiene saldo en metálico. Bróker, cripto e
            inversión contienen únicamente posiciones: el dinero de las ventas
            no se acumula en ellas.
          </span>
        </Field>

        <Field label="Divisa" errors={fieldErrors.currency}>
          {/* Selector cerrado: un typo en texto libre contaminaría todo el
              pipeline FX. EUR es el caso real; USD queda como opción. */}
          <select
            value={form.currency}
            onChange={(e) => update("currency", e.target.value)}
            className={inputClass}
            required
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
          </select>
        </Field>

        <Field label="País de la entidad" errors={fieldErrors.countryCode}>
          <select
            value={form.countryCode}
            onChange={(e) => update("countryCode", e.target.value)}
            className={inputClass}
          >
            <option value="">— Sin asignar —</option>
            {Object.entries(ACCOUNT_COUNTRY_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label} ({code})
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            El país del custodio (broker/banco), no el de los activos que
            contiene. Determina si la cuenta cuenta para el 720/721.
          </span>
        </Field>

        <Field
          label={`Saldo inicial (${form.currency || "EUR"})`}
          errors={fieldErrors.openingBalanceNative}
        >
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={form.openingBalanceNative}
            onChange={(e) => update("openingBalanceNative", e.target.value)}
            className={inputClass}
            required
          />
        </Field>

        <Field label="Notas" errors={fieldErrors.notes}>
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            className={`${inputClass} min-h-[80px]`}
            maxLength={500}
          />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Creando…" : "Crear cuenta"}
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
