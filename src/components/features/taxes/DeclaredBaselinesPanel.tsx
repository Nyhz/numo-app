"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { Modal } from "@/src/components/ui/Modal";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import {
  deleteDeclaredBaseline,
  setDeclaredBaseline,
} from "@/src/actions/setDeclaredBaseline";
import type { DeclaredBaselineCategory, TaxDeclaredBaseline } from "@/src/db/schema";

const CATEGORY_LABEL: Record<DeclaredBaselineCategory, string> = {
  "broker-securities": "Valores (720)",
  "bank-accounts": "Cuentas (720)",
  crypto: "Cripto (721)",
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL) as [
  DeclaredBaselineCategory,
  string,
][];

export function DeclaredBaselinesPanel({
  baselines,
  defaultYear,
}: {
  baselines: TaxDeclaredBaseline[];
  defaultYear: number;
}) {
  const [editing, setEditing] = React.useState<TaxDeclaredBaseline | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<TaxDeclaredBaseline | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const router = useRouter();

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(row: TaxDeclaredBaseline) {
    setEditing(row);
    setFormOpen(true);
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteError(null);
    const result = await deleteDeclaredBaseline({ id: deleting.id });
    if (!result.ok) {
      setDeleteError(result.error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mx-4 mb-3 border-t border-border/40 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Declaraciones presentadas</div>
          <p className="text-xs text-muted-foreground">
            Registra el importe con el que presentaste cada modelo (también si fue ante
            otra Hacienda): el aviso de redeclaración salta cuando el valor conjunto de
            la categoría varía más de 20.000 € respecto al último importe registrado.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={openCreate}>
          Registrar importe
        </Button>
      </div>
      {baselines.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {baselines.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono text-xs">{b.year}</span>
                <span>{CATEGORY_LABEL[b.category]}</span>
                <span className="tabular-nums">
                  <SensitiveValue>{formatEur(b.amountEur)}</SensitiveValue>
                </span>
                {b.notes ? (
                  <span className="text-xs text-muted-foreground">{b.notes}</span>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(b)}>
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleting(b);
                  }}
                >
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <BaselineFormModal
        key={editing?.id ?? (formOpen ? "new" : "closed")}
        open={formOpen}
        onOpenChange={(next) => {
          setFormOpen(next);
          if (!next) setEditing(null);
        }}
        editing={editing}
        defaultYear={defaultYear}
      />
      <ConfirmModal
        open={deleting != null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title="¿Eliminar importe declarado?"
        description={
          <div className="space-y-2">
            <p>
              Se eliminará el registro de {deleting ? CATEGORY_LABEL[deleting.category] : ""}{" "}
              del ejercicio {deleting?.year}. Los avisos de redeclaración volverán a
              calcularse como si esa declaración no se hubiera presentado.
            </p>
            {deleteError ? (
              <p className="text-sm font-medium text-destructive">{deleteError}</p>
            ) : null}
          </div>
        }
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function BaselineFormModal({
  open,
  onOpenChange,
  editing,
  defaultYear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TaxDeclaredBaseline | null;
  defaultYear: number;
}) {
  const [year, setYear] = React.useState(String(editing?.year ?? defaultYear));
  const [category, setCategory] = React.useState<DeclaredBaselineCategory>(
    editing?.category ?? "broker-securities",
  );
  const [amountEur, setAmountEur] = React.useState(
    editing ? String(editing.amountEur) : "",
  );
  const [notes, setNotes] = React.useState(editing?.notes ?? "");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});
    const payload = {
      year: Number(year),
      category,
      amountEur: Number(amountEur),
      notes: notes.trim() === "" ? undefined : notes.trim(),
    };
    startTransition(async () => {
      const result = await setDeclaredBaseline(payload);
      if (result.ok) {
        onOpenChange(false);
        router.refresh();
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
      title={editing ? "Editar importe declarado" : "Registrar importe declarado"}
      description="Importe conjunto de la categoría tal y como figura en el modelo presentado."
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="Ejercicio" errors={fieldErrors.year}>
            <input
              type="number"
              inputMode="numeric"
              min="2000"
              max="2100"
              step="1"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Categoría" errors={fieldErrors.category}>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as DeclaredBaselineCategory)}
              className={inputClass}
              disabled={editing != null}
            >
              {CATEGORY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Importe declarado (EUR)" errors={fieldErrors.amountEur}>
          <SensitiveValue>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amountEur}
              onChange={(e) => setAmountEur(e.target.value)}
              className={inputClass}
              required
            />
          </SensitiveValue>
        </Field>

        <Field label="Notas (opcional)" errors={fieldErrors.notes}>
          <input
            type="text"
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="p. ej. presentado ante la AEAT (Madrid)"
            className={inputClass}
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
            {pending ? "Guardando…" : "Guardar"}
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
