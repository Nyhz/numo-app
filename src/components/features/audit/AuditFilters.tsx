"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { cn } from "@/src/lib/cn";
import { auditActionLabel, auditEntityLabel } from "@/src/lib/labels";

const ENTITY_TYPES = [
  "account",
  "asset",
  "asset_transaction",
  "cash_movement",
  "objective",
  "price_alert",
  "alert_event",
  "benchmark",
] as const;

const ACTIONS = [
  "create",
  "update",
  "delete",
  "deactivate",
  "assign",
  "retarget",
  "reorder",
  "acknowledge",
  "backfill",
] as const;

type Values = {
  entityType: string;
  entityId: string;
  action: string;
  source: string;
  dateFrom: string;
  dateTo: string;
};

function readValues(params: URLSearchParams | null): Values {
  return {
    entityType: params?.get("entityType") ?? "",
    entityId: params?.get("entityId") ?? "",
    action: params?.get("action") ?? "",
    source: params?.get("source") ?? "",
    dateFrom: params?.get("dateFrom") ?? "",
    dateTo: params?.get("dateTo") ?? "",
  };
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary";

export function AuditFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const paramsKey = params?.toString() ?? "";
  const [snapshot, setSnapshot] = React.useState(paramsKey);
  const [values, setValues] = React.useState<Values>(() => readValues(params));
  if (paramsKey !== snapshot) {
    setSnapshot(paramsKey);
    setValues(readValues(params));
  }

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function apply(next: Values) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v) qs.set(k, v);
    }
    startTransition(() => {
      const q = qs.toString();
      router.push(q ? `/audit?${q}` : "/audit");
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    apply(values);
  }

  function onReset() {
    const empty: Values = {
      entityType: "",
      entityId: "",
      action: "",
      source: "",
      dateFrom: "",
      dateTo: "",
    };
    setValues(empty);
    apply(empty);
  }

  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        "grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-3 lg:grid-cols-6",
        pending && "opacity-60",
      )}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Tipo de entidad
        <select
          value={values.entityType}
          onChange={(e) => update("entityType", e.target.value)}
          className={inputClass}
        >
          <option value="">Todos</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {auditEntityLabel(t)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        ID de entidad
        <input
          type="text"
          value={values.entityId}
          onChange={(e) => update("entityId", e.target.value)}
          placeholder="p. ej. acc_01H…"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Acción
        <select
          value={values.action}
          onChange={(e) => update("action", e.target.value)}
          className={inputClass}
        >
          <option value="">Todas</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {auditActionLabel(a)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Origen
        <input
          type="text"
          value={values.source}
          onChange={(e) => update("source", e.target.value)}
          placeholder="p. ej. ui, cron"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Desde
        <input
          type="date"
          value={values.dateFrom}
          onChange={(e) => update("dateFrom", e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Hasta
        <input
          type="date"
          value={values.dateTo}
          onChange={(e) => update("dateTo", e.target.value)}
          className={inputClass}
        />
      </label>

      <div className="flex items-end gap-2 md:col-span-3 lg:col-span-6">
        <Button type="submit" size="sm" disabled={pending}>
          Aplicar filtros
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onReset} disabled={pending}>
          Restablecer
        </Button>
      </div>
    </form>
  );
}
