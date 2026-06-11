"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { updateAccount } from "@/src/actions/accounts";
import { ACCOUNT_COUNTRY_LABELS, accountTypeLabel } from "@/src/lib/labels";
import type { Account } from "@/src/db/schema";

export function EditAccountModal({
  account,
  open,
  onOpenChange,
}: {
  account: Account | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return account ? (
    <EditAccountForm
      key={account.id}
      account={account}
      open={open}
      onOpenChange={onOpenChange}
    />
  ) : null;
}

function EditAccountForm({
  account,
  open,
  onOpenChange,
}: {
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = React.useState(account.name);
  const [countryCode, setCountryCode] = React.useState(account.countryCode ?? "");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});

    const payload = {
      id: account.id,
      name,
      countryCode: countryCode === "" ? null : countryCode,
    };

    startTransition(async () => {
      const result = await updateAccount(payload);
      if (result.ok) {
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
      title={`Editar ${account.name}`}
      description={`${accountTypeLabel(account.accountType)} · ${account.currency}. Divisa, tipo y saldo inicial no son editables: alimentan el estado derivado.`}
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
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            maxLength={80}
            required
          />
        </Field>

        <Field label="País de la entidad" errors={fieldErrors.countryCode}>
          <select
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
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
            El país del custodio (broker/banco), no el de los activos que contiene.
            Determina si la cuenta cuenta para el 720/721: las entidades españolas
            quedan exentas.
          </span>
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
            {pending ? "Guardando…" : "Guardar cambios"}
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
