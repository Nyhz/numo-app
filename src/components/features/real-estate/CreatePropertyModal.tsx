"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { createProperty } from "@/src/actions/realEstate";
import { Button } from "@/src/components/ui/Button";
import { Modal } from "@/src/components/ui/Modal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { annuityPayment } from "@/src/lib/mortgage";
import { toast } from "@/src/lib/toast";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

type FormState = {
  name: string;
  address: string;
  purchaseDate: string;
  purchasePriceEur: string;
  purchaseCostsEur: string;
  notes: string;
  hasMortgage: boolean;
  lender: string;
  principalEur: string;
  rateType: "fixed" | "variable" | "mixed";
  nominalRatePct: string;
  termYears: string;
  firstPaymentDate: string;
  expectedTotalInterestEur: string;
};

const initial: FormState = {
  name: "",
  address: "",
  purchaseDate: "",
  purchasePriceEur: "",
  purchaseCostsEur: "",
  notes: "",
  hasMortgage: true,
  lender: "",
  principalEur: "",
  rateType: "fixed",
  nominalRatePct: "",
  termYears: "",
  firstPaymentDate: "",
  expectedTotalInterestEur: "",
};

const RATE_TYPE_LABELS: Record<FormState["rateType"], string> = {
  fixed: "Fija",
  variable: "Variable",
  mixed: "Mixta",
};

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function CreatePropertyModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(initial);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const termMonths = Math.round(num(form.termYears) * 12);
  const livePayment =
    form.hasMortgage && num(form.principalEur) > 0 && termMonths > 0
      ? annuityPayment(num(form.principalEur), num(form.nominalRatePct), termMonths)
      : null;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleOpenChange(next: boolean) {
    if (!next && !pending) {
      setForm(initial);
      setFieldErrors({});
      setBanner(null);
    }
    onOpenChange(next);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await createProperty({
        name: form.name,
        address: form.address || null,
        purchaseDate: form.purchaseDate,
        purchasePriceEur: num(form.purchasePriceEur),
        purchaseCostsEur: num(form.purchaseCostsEur),
        notes: form.notes || null,
        mortgage: form.hasMortgage
          ? {
              lender: form.lender || null,
              principalEur: num(form.principalEur),
              rateType: form.rateType,
              nominalRatePct: num(form.nominalRatePct),
              termMonths,
              firstPaymentDate: form.firstPaymentDate,
              expectedTotalInterestEur: form.expectedTotalInterestEur
                ? num(form.expectedTotalInterestEur)
                : null,
            }
          : null,
      });
      if (result.ok) {
        toast.success("Inmueble registrado");
        handleOpenChange(false);
        router.refresh();
        return;
      }
      if (result.error.code === "validation" && result.error.fieldErrors) {
        setFieldErrors(result.error.fieldErrors);
        if (result.error.fieldErrors.mortgage?.length) {
          setBanner(result.error.fieldErrors.mortgage.join(", "));
        }
      } else {
        setBanner(result.error.message);
      }
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Registrar inmueble"
      description="La compra entra de cero: no toca la caja de ninguna cuenta."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {banner ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {banner}
          </div>
        ) : null}

        <Field label="Nombre" errors={fieldErrors.name}>
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Vivienda habitual"
          />
        </Field>
        <Field label="Dirección (opcional)" errors={fieldErrors.address}>
          <input
            className={inputClass}
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Fecha de compra" errors={fieldErrors.purchaseDate}>
            <input
              type="date"
              className={inputClass}
              value={form.purchaseDate}
              onChange={(e) => set("purchaseDate", e.target.value)}
            />
          </Field>
          <Field label="Precio (€)" errors={fieldErrors.purchasePriceEur}>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              value={form.purchasePriceEur}
              onChange={(e) => set("purchasePriceEur", e.target.value)}
            />
          </Field>
          <Field label="Costes (ITP, notaría…) (€)" errors={fieldErrors.purchaseCostsEur}>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              value={form.purchaseCostsEur}
              onChange={(e) => set("purchaseCostsEur", e.target.value)}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.hasMortgage}
            onChange={(e) => set("hasMortgage", e.target.checked)}
          />
          Con hipoteca
        </label>

        {form.hasMortgage ? (
          <div className="flex flex-col gap-4 rounded-lg border border-border/60 p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Banco (opcional)" errors={fieldErrors["mortgage.lender"]}>
                <input
                  className={inputClass}
                  value={form.lender}
                  onChange={(e) => set("lender", e.target.value)}
                />
              </Field>
              <Field label="Tipo" errors={fieldErrors["mortgage.rateType"]}>
                <select
                  className={inputClass}
                  value={form.rateType}
                  onChange={(e) => set("rateType", e.target.value as FormState["rateType"])}
                >
                  {(Object.keys(RATE_TYPE_LABELS) as FormState["rateType"][]).map((k) => (
                    <option key={k} value={k}>
                      {RATE_TYPE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Capital (€)" errors={fieldErrors["mortgage.principalEur"]}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputClass}
                  value={form.principalEur}
                  onChange={(e) => set("principalEur", e.target.value)}
                />
              </Field>
              <Field label="TIN (%)" errors={fieldErrors["mortgage.nominalRatePct"]}>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  className={inputClass}
                  value={form.nominalRatePct}
                  onChange={(e) => set("nominalRatePct", e.target.value)}
                />
              </Field>
              <Field label="Plazo (años)" errors={fieldErrors["mortgage.termMonths"]}>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className={inputClass}
                  value={form.termYears}
                  onChange={(e) => set("termYears", e.target.value)}
                />
              </Field>
              <Field label="Primera cuota" errors={fieldErrors["mortgage.firstPaymentDate"]}>
                <input
                  type="date"
                  className={inputClass}
                  value={form.firstPaymentDate}
                  onChange={(e) => set("firstPaymentDate", e.target.value)}
                />
              </Field>
            </div>
            <Field
              label="Total intereses según el banco (€) (opcional)"
              errors={fieldErrors["mortgage.expectedTotalInterestEur"]}
            >
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={form.expectedTotalInterestEur}
                onChange={(e) => set("expectedTotalInterestEur", e.target.value)}
                placeholder="Dato de la FEIN — valida el cuadro derivado"
              />
            </Field>
            {livePayment != null ? (
              <p className="text-sm text-muted-foreground">
                Cuota estimada:{" "}
                <SensitiveValue className="font-medium text-foreground">
                  {formatEur(livePayment)}
                </SensitiveValue>{" "}
                /mes — contrasta con la FEIN del banco antes de guardar.
              </p>
            ) : null}
          </div>
        ) : null}

        <Field label="Notas (opcional)" errors={fieldErrors.notes}>
          <textarea
            className={inputClass}
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
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
              pending ||
              !form.name ||
              !form.purchaseDate ||
              (form.hasMortgage &&
                (!form.principalEur ||
                  !form.nominalRatePct ||
                  !form.termYears ||
                  !form.firstPaymentDate))
            }
          >
            {pending ? "Guardando…" : "Registrar inmueble"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

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
      {errors && errors.length > 0 ? (
        <span className="text-xs text-destructive">{errors.join(", ")}</span>
      ) : null}
    </label>
  );
}
