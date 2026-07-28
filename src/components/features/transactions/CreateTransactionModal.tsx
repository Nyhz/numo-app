"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { createTransaction } from "@/src/actions/createTransaction";
import { previewFx, type FxPreview } from "@/src/actions/previewFx";
import { formatEur } from "@/src/lib/format";
import { toast } from "@/src/lib/toast";

export type AccountOption = { id: string; name: string; currency: string };
export type AssetOption = { id: string; name: string; symbol: string | null; currency: string };

type FormState = {
  accountId: string;
  assetId: string;
  tradeDate: string;
  side: "buy" | "sell";
  quantity: string;
  priceNative: string;
  currency: string;
  /** Broker's direction (DEGIRO): 1 EUR = X CCY. Always typed by hand. */
  fxEurToCcy: string;
  fees: string;
  notes: string;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function CreateTransactionModal({
  open,
  onOpenChange,
  accounts,
  assets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountOption[];
  assets: AssetOption[];
}) {
  const initial = React.useMemo<FormState>(
    () => ({
      accountId: accounts[0]?.id ?? "",
      assetId: assets[0]?.id ?? "",
      tradeDate: todayIso(),
      side: "buy",
      quantity: "",
      priceNative: "",
      currency: assets[0]?.currency ?? "EUR",
      fxEurToCcy: "",
      fees: "0",
      notes: "",
    }),
    [accounts, assets],
  );

  const [form, setForm] = React.useState<FormState>(initial);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = React.useState(false);
  const [fxDeviationWarning, setFxDeviationWarning] = React.useState(false);
  const [fxPreview, setFxPreview] = React.useState<FxPreview | null>(null);
  const [fxUnavailable, setFxUnavailable] = React.useState(false);
  // Sticky per-form acknowledgements so confirming one warning survives a
  // second round-trip (e.g. FX override confirmed, then duplicate confirmed).
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
    if (key === "currency" || key === "tradeDate") {
      setFxPreview(null);
      setFxUnavailable(false);
    }
  }

  function onAssetChange(id: string) {
    const asset = assets.find((a) => a.id === id);
    setForm((prev) => ({
      ...prev,
      assetId: id,
      currency: asset?.currency ?? prev.currency,
    }));
    setFxPreview(null);
    setFxUnavailable(false);
  }

  // Audit H3: show the rate that WILL be applied (and its provenance) before
  // the user submits — money is never entered blind.
  React.useEffect(() => {
    if (!open || form.currency === "EUR" || !/^\d{4}-\d{2}-\d{2}$/.test(form.tradeDate)) {
      return;
    }
    let cancelled = false;
    previewFx({ currency: form.currency, date: form.tradeDate }).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setFxPreview(res.data);
        setFxUnavailable(false);
      } else {
        setFxPreview(null);
        setFxUnavailable(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, form.currency, form.tradeDate]);

  // FX is ALWAYS manual for non-EUR: the daily stored rate never applies to a
  // transaction (it only powers the reference line and the deviation guard).
  const manualEurToCcy = form.fxEurToCcy.trim() ? Number(form.fxEurToCcy) : undefined;
  const effectiveRate =
    form.currency === "EUR"
      ? 1
      : manualEurToCcy != null && manualEurToCcy > 0
        ? 1 / manualEurToCcy
        : undefined;
  const qtyNum = Number(form.quantity);
  const priceNum = Number(form.priceNative);
  const feesNum = Number(form.fees || 0);
  // Fees are entered in EUR (European broker) — only the gross leg converts.
  const estimatedTotalEur =
    effectiveRate != null &&
    Number.isFinite(effectiveRate) &&
    effectiveRate > 0 &&
    qtyNum > 0 &&
    priceNum > 0
      ? qtyNum * priceNum * effectiveRate + (form.side === "buy" ? feesNum : -feesNum)
      : null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit();
  }

  function submit(extra?: { allowDuplicate?: boolean; allowFxDeviation?: boolean }) {
    setBanner(null);
    setFieldErrors({});
    if (extra?.allowDuplicate) acceptedRef.current.duplicate = true;
    if (extra?.allowFxDeviation) acceptedRef.current.fxDeviation = true;

    const payload = {
      accountId: form.accountId,
      assetId: form.assetId,
      tradeDate: form.tradeDate,
      side: form.side,
      quantity: Number(form.quantity),
      priceNative: Number(form.priceNative),
      currency: form.currency.toUpperCase(),
      fxEurToCcy: form.fxEurToCcy.trim() ? Number(form.fxEurToCcy) : undefined,
      fees: Number(form.fees || 0),
      notes: form.notes.trim() ? form.notes : undefined,
      allowDuplicate: acceptedRef.current.duplicate,
      allowFxDeviation: acceptedRef.current.fxDeviation,
    };

    startTransition(async () => {
      const result = await createTransaction(payload);
      if (result.ok) {
        toast.success("Transacción registrada");
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

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Nueva transacción"
      description="Registra una compra o venta. La posición y el saldo de efectivo se actualizan a la vez."
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

        <Field label="Activo" errors={fieldErrors.assetId}>
          <select
            value={form.assetId}
            onChange={(e) => onAssetChange(e.target.value)}
            className={inputClass}
            required
          >
            {assets.length === 0 && <option value="">Sin activos</option>}
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.symbol ?? a.name} — {a.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Operación" errors={fieldErrors.side}>
          <select
            value={form.side}
            onChange={(e) => update("side", e.target.value as "buy" | "sell")}
            className={inputClass}
          >
            <option value="buy">Compra</option>
            <option value="sell">Venta</option>
          </select>
        </Field>

        <Field label="Fecha de operación" errors={fieldErrors.tradeDate}>
          <input
            type="date"
            value={form.tradeDate}
            onChange={(e) => update("tradeDate", e.target.value)}
            className={inputClass}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Cantidad" errors={fieldErrors.quantity}>
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
          <Field label="Precio unitario" errors={fieldErrors.priceNative}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.priceNative}
              onChange={(e) => update("priceNative", e.target.value)}
              className={inputClass}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Divisa" errors={fieldErrors.currency}>
            <input
              type="text"
              value={form.currency}
              readOnly
              aria-readonly="true"
              tabIndex={-1}
              className={`${inputClass} cursor-not-allowed bg-muted/40 text-muted-foreground`}
            />
            <span className="text-xs text-muted-foreground">
              Derivada del activo seleccionado — el precio unitario siempre está en esta divisa.
            </span>
          </Field>
          <Field label="Comisiones (EUR)" errors={fieldErrors.fees}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.fees}
              onChange={(e) => update("fees", e.target.value)}
              className={inputClass}
            />
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
              placeholder={`p. ej. ${fxPreview ? (1 / fxPreview.rate).toFixed(4) : "1,15"} — tal como lo muestra DEGIRO`}
              value={form.fxEurToCcy}
              onChange={(e) => update("fxEurToCcy", e.target.value)}
              className={inputClass}
              required
            />
            {fxPreview && (
              <span className="text-xs text-muted-foreground">
                Referencia diaria: 1 EUR = {(1 / fxPreview.rate).toFixed(4)} {form.currency}
                {fxPreview.rateDate ? ` (${fxPreview.rateDate})` : ""} — solo salvaguarda,
                nunca se aplica automáticamente.
              </span>
            )}
            {fxUnavailable && (
              <span className="text-xs text-muted-foreground">
                Sin referencia diaria para esta fecha — se omite la salvaguarda de desviación.
              </span>
            )}
          </Field>
        )}

        {estimatedTotalEur != null && (
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {form.side === "buy"
                ? "Coste estimado (comisiones incl.)"
                : "Importe neto estimado"}
              {form.currency !== "EUR" ? " (con tu tipo)" : ""}
            </span>
            <SensitiveValue>{formatEur(estimatedTotalEur)}</SensitiveValue>
          </div>
        )}

        <Field label="Notas" errors={fieldErrors.notes}>
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
          <Button type="submit" disabled={pending || !form.accountId || !form.assetId}>
            {pending ? "Guardando…" : "Crear transacción"}
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
