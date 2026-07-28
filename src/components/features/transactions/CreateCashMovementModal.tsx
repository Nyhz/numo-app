"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { createCashMovement } from "@/src/actions/createCashMovement";
import { previewFx, type FxPreview } from "@/src/actions/previewFx";
import { toast } from "@/src/lib/toast";

const MANUAL_CASH_MOVEMENT_KINDS = ["deposit", "withdrawal", "interest"] as const;
const CASH_CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;
type ManualCashMovementKind = (typeof MANUAL_CASH_MOVEMENT_KINDS)[number];

export type CashAccountOption = {
  id: string;
  name: string;
  currency: string;
  accountType: string;
};

type FormState = {
  accountId: string;
  kind: ManualCashMovementKind;
  occurredAt: string;
  amount: string;
  currency: string;
  /** Broker's direction (DEGIRO): 1 EUR = X CCY. Always typed by hand. */
  fxEurToCcy: string;
  /** Retención practicada en EUR — solo intereses. */
  withholdingTaxEur: string;
  description: string;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

// Display-only labels — the submitted kind values stay in English.
const KIND_LABELS: Record<string, string> = {
  deposit: "Ingreso",
  withdrawal: "Retirada",
  interest: "Interés",
};

function labelForKind(kind: string): string {
  return KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function CreateCashMovementModal({
  open,
  onOpenChange,
  accounts,
  defaultAccountId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: CashAccountOption[];
  defaultAccountId?: string;
}) {
  const initial = React.useMemo<FormState>(() => {
    const fallback = accounts[0];
    const picked =
      (defaultAccountId && accounts.find((a) => a.id === defaultAccountId)) ||
      fallback;
    return {
      accountId: picked?.id ?? "",
      kind: "deposit",
      occurredAt: todayIso(),
      amount: "",
      currency: picked?.currency ?? "EUR",
      fxEurToCcy: "",
      withholdingTaxEur: "",
      description: "",
    };
  }, [accounts, defaultAccountId]);

  const [form, setForm] = React.useState<FormState>(initial);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = React.useState(false);
  const [fxDeviationWarning, setFxDeviationWarning] = React.useState(false);
  const [fxPreview, setFxPreview] = React.useState<FxPreview | null>(null);
  const acceptedRef = React.useRef({ duplicate: false, fxDeviation: false });
  const [pending, startTransition] = React.useTransition();

  function handleOpenChange(next: boolean) {
    if (!next && !pending) {
      setForm(initial);
      setFieldErrors({});
      setBanner(null);
      setDuplicateWarning(false);
      setFxDeviationWarning(false);
      acceptedRef.current = { duplicate: false, fxDeviation: false };
    }
    onOpenChange(next);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Inputs that change which FX rate applies invalidate the live preview.
    if (key === "currency" || key === "occurredAt") setFxPreview(null);
  }

  function onAccountChange(id: string) {
    const next = accounts.find((a) => a.id === id);
    setForm((prev) => ({
      ...prev,
      accountId: id,
      currency: next?.currency ?? prev.currency,
    }));
    setFxPreview(null);
  }

  const selectedAccount = accounts.find((a) => a.id === form.accountId);
  const currencyOptions = Array.from(
    new Set([selectedAccount?.currency ?? "EUR", ...CASH_CURRENCIES]),
  );

  // Audit H3: preview the rate that will be applied before submitting.
  React.useEffect(() => {
    if (!open || form.currency === "EUR" || !/^\d{4}-\d{2}-\d{2}$/.test(form.occurredAt)) {
      return;
    }
    let cancelled = false;
    previewFx({ currency: form.currency, date: form.occurredAt }).then((res) => {
      if (!cancelled) setFxPreview(res.ok ? res.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, form.currency, form.occurredAt]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit();
  }

  function submit(extra?: { allowDuplicate?: boolean; allowFxDeviation?: boolean }) {
    setBanner(null);
    setFieldErrors({});
    if (extra?.allowDuplicate) acceptedRef.current.duplicate = true;
    if (extra?.allowFxDeviation) acceptedRef.current.fxDeviation = true;

    const fxRate = form.fxEurToCcy.trim();
    const withholding = form.withholdingTaxEur.trim();
    const payload = {
      accountId: form.accountId,
      kind: form.kind,
      occurredAt: form.occurredAt,
      amountNative: Number(form.amount),
      currency: form.currency.toUpperCase(),
      fxEurToCcy: fxRate ? Number(fxRate) : undefined,
      withholdingTaxEur:
        form.kind === "interest" && withholding ? Number(withholding) : undefined,
      description: form.description.trim() ? form.description : undefined,
      allowDuplicate: acceptedRef.current.duplicate,
      allowFxDeviation: acceptedRef.current.fxDeviation,
    };

    startTransition(async () => {
      const result = await createCashMovement(payload);
      if (result.ok) {
        toast.success("Movimiento de caja registrado");
        handleOpenChange(false);
        return;
      }
      if (result.error.code === "duplicate") {
        setDuplicateWarning(true);
        setBanner(result.error.message);
        return;
      }
      if (result.error.code === "fx_deviation") {
        setFxDeviationWarning(true);
        setBanner(result.error.message);
        if (result.error.fieldErrors) setFieldErrors(result.error.fieldErrors);
        return;
      }
      setDuplicateWarning(false);
      setFxDeviationWarning(false);
      if (result.error.code === "validation" && result.error.fieldErrors) {
        setFieldErrors(result.error.fieldErrors);
      } else {
        setBanner(result.error.message);
      }
    });
  }

  const signHint =
    form.kind === "withdrawal"
      ? "El importe se registra como cargo (el saldo disminuye)."
      : "El importe se registra como abono (el saldo aumenta).";

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Nuevo movimiento de efectivo"
      description="Ingresos, retiradas, intereses, comisiones, dividendos y transferencias."
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
            onChange={(e) => onAccountChange(e.target.value)}
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

        <Field label="Tipo" errors={fieldErrors.kind}>
          <select
            value={form.kind}
            onChange={(e) =>
              update("kind", e.target.value as FormState["kind"])
            }
            className={inputClass}
          >
            {MANUAL_CASH_MOVEMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {labelForKind(k)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">{signHint}</span>
        </Field>

        <Field label="Fecha" errors={fieldErrors.occurredAt}>
          <input
            type="date"
            value={form.occurredAt}
            onChange={(e) => update("occurredAt", e.target.value)}
            className={inputClass}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Importe" errors={fieldErrors.amountNative}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.amount}
              onChange={(e) => update("amount", e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Divisa" errors={fieldErrors.currency}>
            <select
              value={form.currency}
              onChange={(e) => update("currency", e.target.value)}
              className={inputClass}
              required
            >
              {currencyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {c === selectedAccount?.currency ? " (divisa de la cuenta)" : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {form.currency !== "EUR" && (
          <Field
            label={`Tipo de cambio — 1 EUR = ? ${form.currency} (el de tu broker, obligatorio)`}
            errors={fieldErrors.fxEurToCcy}
          >
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.fxEurToCcy}
              onChange={(e) => update("fxEurToCcy", e.target.value)}
              className={inputClass}
              placeholder={`p. ej. ${fxPreview ? (1 / fxPreview.rate).toFixed(4) : "1,15"} — tal como lo muestra DEGIRO`}
              required
            />
            {fxPreview && (
              <span className="text-xs text-muted-foreground">
                Referencia diaria: 1 EUR = {(1 / fxPreview.rate).toFixed(4)} {form.currency}
                {fxPreview.rateDate ? ` (${fxPreview.rateDate})` : ""} — solo salvaguarda,
                nunca se aplica automáticamente.
              </span>
            )}
          </Field>
        )}

        {form.kind === "interest" && (
          <Field
            label="Retención practicada (EUR, opcional)"
            errors={fieldErrors.withholdingTaxEur}
          >
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.withholdingTaxEur}
              onChange={(e) => update("withholdingTaxEur", e.target.value)}
              className={inputClass}
              placeholder="p. ej. el 19 % que retiene el banco"
            />
            <span className="text-xs text-muted-foreground">
              Registra como importe el interés NETO abonado; la retención se suma para el
              bruto fiscal y descuenta como pago a cuenta en la previsión.
            </span>
          </Field>
        )}

        <Field label="Descripción" errors={fieldErrors.description}>
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
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
          {duplicateWarning ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => submit({ allowDuplicate: true })}
            >
              Guardar igualmente
            </Button>
          ) : null}
          {fxDeviationWarning ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => submit({ allowFxDeviation: true })}
            >
              Usar mi tipo igualmente
            </Button>
          ) : null}
          <Button type="submit" disabled={pending || !form.accountId}>
            {pending ? "Guardando…" : "Registrar movimiento"}
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
