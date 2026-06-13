"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { createAsset } from "@/src/actions/createAsset";
import { ASSET_TYPES } from "@/src/actions/_constants";
import { assetTypeLabel } from "@/src/components/ui/AssetTypeBadge";

type FormState = {
  name: string;
  symbol: string;
  isin: string;
  assetType: string;
  currency: string;
  ter: string;
  exchange: string;
  providerSymbol: string;
  isActive: boolean;
};

const INITIAL: FormState = {
  name: "",
  symbol: "",
  isin: "",
  assetType: "etf",
  currency: "EUR",
  ter: "",
  exchange: "",
  providerSymbol: "",
  isActive: true,
};

/** "0,22" / "0.22" / "" → 0.22 | null. Accepts Spanish decimal comma. */
function parseTer(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

export function CreateAssetModal({
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
      symbol: form.symbol,
      isin: form.isin.trim() ? form.isin.trim() : null,
      assetType: form.assetType,
      currency: form.currency.toUpperCase(),
      ter: parseTer(form.ter),
      exchange: form.exchange.trim() ? form.exchange.trim() : null,
      providerSymbol: form.providerSymbol.trim() ? form.providerSymbol.trim() : null,
      isActive: form.isActive,
    };

    startTransition(async () => {
      const result = await createAsset(payload);
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
      title="Nuevo activo"
      description="Registra un instrumento para seguir posiciones y valoraciones."
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
            maxLength={120}
            required
          />
        </Field>

        <Field label="Símbolo" errors={fieldErrors.symbol}>
          <input
            type="text"
            value={form.symbol}
            onChange={(e) => update("symbol", e.target.value)}
            className={inputClass}
            maxLength={32}
            required
          />
        </Field>

        <Field label="ISIN" errors={fieldErrors.isin}>
          <input
            type="text"
            value={form.isin}
            onChange={(e) => update("isin", e.target.value.toUpperCase())}
            className={inputClass}
            maxLength={12}
            placeholder="opcional"
          />
        </Field>

        <Field label="Tipo" errors={fieldErrors.assetType}>
          <select
            value={form.assetType}
            onChange={(e) => update("assetType", e.target.value)}
            className={inputClass}
          >
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {assetTypeLabel(t)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Divisa nativa" errors={fieldErrors.currency}>
          {/* Selector cerrado: la divisa del activo gobierna el FX de todas
              sus operaciones — un typo aquí sería catastrófico. */}
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

        <Field label="TER (% anual)" errors={fieldErrors.ter}>
          <input
            type="text"
            inputMode="decimal"
            value={form.ter}
            onChange={(e) => update("ter", e.target.value)}
            className={inputClass}
            placeholder="opcional — p. ej. 0,22 para un fondo/ETF"
          />
          <span className="text-xs text-muted-foreground">
            Coste anual del fondo. Alimenta el coste estimado del Extracto.
          </span>
        </Field>

        <Field label="Mercado" errors={fieldErrors.exchange}>
          <input
            type="text"
            value={form.exchange}
            onChange={(e) => update("exchange", e.target.value)}
            className={inputClass}
            maxLength={32}
            placeholder="opcional"
          />
        </Field>

        <Field label="Símbolo de Yahoo / proveedor" errors={fieldErrors.providerSymbol}>
          <input
            type="text"
            value={form.providerSymbol}
            onChange={(e) => update("providerSymbol", e.target.value)}
            className={inputClass}
            maxLength={64}
            placeholder="opcional — sustituye al símbolo en la sincronización de precios"
          />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => update("isActive", e.target.checked)}
          />
          <span>Activo</span>
        </label>

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
            {pending ? "Creando…" : "Crear activo"}
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
