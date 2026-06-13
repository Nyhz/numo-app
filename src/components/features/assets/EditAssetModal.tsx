"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { updateAsset } from "@/src/actions/updateAsset";
import { ASSET_TYPES } from "@/src/actions/_constants";
import { assetTypeLabel } from "@/src/components/ui/AssetTypeBadge";
import type { Asset } from "@/src/db/schema";

type FormState = {
  name: string;
  symbol: string;
  isin: string;
  assetType: string;
  ter: string;
  exchange: string;
  providerSymbol: string;
  isActive: boolean;
};

function stateFromAsset(a: Asset): FormState {
  return {
    name: a.name,
    symbol: a.symbol ?? "",
    isin: a.isin ?? "",
    assetType: a.assetType,
    ter: a.ter != null ? String(a.ter) : "",
    exchange: a.exchange ?? "",
    providerSymbol: a.providerSymbol ?? "",
    isActive: a.isActive,
  };
}

/** "0,22" / "0.22" / "" → 0.22 | null. Accepts Spanish decimal comma. */
function parseTer(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

export function EditAssetModal({
  asset,
  open,
  onOpenChange,
}: {
  asset: Asset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = React.useState<FormState | null>(() =>
    asset ? stateFromAsset(asset) : null,
  );
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  if (!asset || !form) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form || !asset) return;
    setBanner(null);
    setFieldErrors({});

    const payload = {
      id: asset.id,
      name: form.name,
      symbol: form.symbol,
      isin: form.isin.trim() ? form.isin.trim() : null,
      assetType: form.assetType,
      ter: parseTer(form.ter),
      exchange: form.exchange.trim() ? form.exchange.trim() : null,
      providerSymbol: form.providerSymbol.trim() ? form.providerSymbol.trim() : null,
      isActive: form.isActive,
    };

    startTransition(async () => {
      const result = await updateAsset(payload);
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
      title="Editar activo"
      description={asset.name}
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

        <Field label="TER (% anual)" errors={fieldErrors.ter}>
          <input
            type="text"
            inputMode="decimal"
            value={form.ter}
            onChange={(e) => update("ter", e.target.value)}
            className={inputClass}
            placeholder="opcional — p. ej. 0,22"
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
          />
        </Field>

        <Field
          label="Símbolo del proveedor"
          errors={fieldErrors.providerSymbol}
        >
          <input
            type="text"
            value={form.providerSymbol}
            onChange={(e) => update("providerSymbol", e.target.value)}
            className={inputClass}
            maxLength={64}
            placeholder={
              form.assetType === "crypto"
                ? "Id de CoinGecko (p. ej. binancecoin, ethereum)"
                : "Ticker de Yahoo (p. ej. AAPL, BTC-EUR)"
            }
          />
          <span className="text-xs text-muted-foreground">
            {form.assetType === "crypto"
              ? "Id de moneda de CoinGecko usado por la sincronización de precios cripto."
              : "Ticker de Yahoo Finance usado por la sincronización diaria de precios."}
          </span>
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
