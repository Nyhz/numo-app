"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { Modal } from "@/src/components/ui/Modal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import {
  createObjective,
  deleteObjective,
  reorderObjectives,
  setObjectiveTargets,
  updateObjective,
} from "@/src/actions/objectives";
import { formatEur, formatPercent } from "@/src/lib/format";
import {
  OBJECTIVE_COLOR_VARS,
  firstFreeObjectiveColor,
  objectiveColorCss,
  resolveObjectiveColor,
  resolveObjectiveColorVar,
  type ObjectiveColorVar,
} from "@/src/lib/objective-colors";
import type { ObjectiveBucket } from "@/src/server/objectives";
import { ObjectivesPie, type PieSlice } from "./ObjectivesPie";

type FormState = { id: string | null; name: string; color: ObjectiveColorVar };

export function ObjectivesPanel({
  buckets,
  targetSumPct,
  totalValuedEur,
}: {
  buckets: ObjectiveBucket[];
  targetSumPct: number;
  totalValuedEur: number;
}) {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState | null>(null);
  const [deleting, setDeleting] = React.useState<{ id: string; name: string } | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const serverTagged = buckets.filter((b) => b.objective != null);
  const unassigned = buckets.find((b) => b.objective == null) ?? null;

  // Drag & drop display order: optimistic override until the committed
  // refresh lands (same derived-state pattern as the pie shares).
  const serverIdsKey = serverTagged.map((b) => b.objective!.id).join(",");
  const [orderOverride, setOrderOverride] = React.useState<{
    baseKey: string;
    ids: string[];
  } | null>(null);
  const [dragIdx, setDragIdx] = React.useState<number | null>(null);
  if (orderOverride && orderOverride.baseKey !== serverIdsKey && dragIdx === null) {
    setOrderOverride(null);
  }

  let tagged = serverTagged;
  if (orderOverride) {
    const byId = new Map(serverTagged.map((b) => [b.objective!.id, b] as const));
    const reordered = orderOverride.ids
      .map((id) => byId.get(id))
      .filter((b): b is ObjectiveBucket => b != null);
    if (reordered.length === serverTagged.length) tagged = reordered;
  }

  function onRowDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === index) return;
    const ids = tagged.map((b) => b.objective!.id);
    const [moved] = ids.splice(dragIdx, 1);
    ids.splice(index, 0, moved);
    setOrderOverride({ baseKey: serverIdsKey, ids });
    setDragIdx(index);
  }

  function onRowDragEnd() {
    setDragIdx(null);
    if (!orderOverride) return;
    if (orderOverride.ids.join(",") === serverIdsKey) {
      setOrderOverride(null);
      return;
    }
    startTransition(async () => {
      const result = await reorderObjectives({ ids: orderOverride.ids });
      if (!result.ok) setBanner(result.error.message);
      router.refresh();
    });
  }

  const slices: PieSlice[] = tagged.map((b, i) => ({
    id: b.objective!.id,
    label: b.objective!.name,
    color: resolveObjectiveColor(b.objective!.color, i),
    targetPct: b.objective!.targetPct,
    actualPct: b.weightPct,
  }));

  const planEmpty = tagged.length > 0 && targetSumPct <= 0;

  function submitForm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form) return;
    startTransition(async () => {
      const result = form.id
        ? await updateObjective({
            id: form.id,
            name: form.name,
            color: form.color,
            targetPct: tagged.find((b) => b.objective!.id === form.id)?.objective!.targetPct ?? 0,
          })
        : await createObjective({ name: form.name, color: form.color });
      if (!result.ok) {
        setBanner(result.error.message);
        return;
      }
      setBanner(null);
      setForm(null);
      router.refresh();
    });
  }

  async function confirmDelete() {
    if (!deleting) return;
    const result = await deleteObjective({ id: deleting.id });
    setDeleting(null);
    if (!result.ok) setBanner(result.error.message);
    router.refresh();
  }

  function commitTargets(targets: Array<{ id: string; targetPct: number }>) {
    startTransition(async () => {
      const result = await setObjectiveTargets({ targets });
      if (!result.ok) {
        setBanner(result.error.message);
      } else {
        setBanner(null);
      }
      router.refresh();
    });
  }

  return (
    <Card
      title="Plan de asignación"
      action={
        <div className="flex items-center gap-3">
          {planEmpty && <Badge variant="warning">arrastra los bordes para fijar pesos</Badge>}
          <Button
            onClick={() =>
              setForm({
                id: null,
                name: "",
                color: firstFreeObjectiveColor(tagged.map((b) => b.objective!.color)),
              })
            }
          >
            Nuevo tag
          </Button>
        </div>
      }
    >
      {banner && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {banner}
        </div>
      )}
      {tagged.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="Sin tags definidos"
          description="Crea tags (World, Crypto, Oro, Small caps…), asígnalos a tus activos y reparte los pesos arrastrando el gráfico."
        />
      ) : (
        <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start">
          <ObjectivesPie
            slices={slices}
            unassignedActualPct={unassigned?.weightPct ?? 0}
            onCommit={commitTargets}
            center={
              <span className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Valorado
                </span>
                <SensitiveValue className="text-sm font-semibold tabular-nums">
                  {formatEur(totalValuedEur)}
                </SensitiveValue>
              </span>
            }
          />
          <ul className="flex w-full flex-1 flex-col gap-2">
            {tagged.map((b, i) => {
              const drift = b.driftPct ?? 0;
              const tone =
                Math.abs(drift) < 1
                  ? "text-muted-foreground"
                  : drift < 0
                    ? "text-warning"
                    : "text-success";
              return (
                <li
                  key={b.objective!.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragIdx(i);
                  }}
                  onDragOver={(e) => onRowDragOver(e, i)}
                  onDragEnd={onRowDragEnd}
                  className={`group flex cursor-grab items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 active:cursor-grabbing ${
                    dragIdx === i ? "border-primary/60 opacity-60" : ""
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <GripVertical
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
                    />
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: resolveObjectiveColor(b.objective!.color, i) }}
                    />
                    <span className="truncate text-sm font-medium">{b.objective!.name}</span>
                    <span className="text-xs text-muted-foreground" title={b.assets.map((a) => a.symbol ?? a.name).join(", ")}>
                      ·{b.assets.length}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-4">
                    <span className="flex flex-col items-end leading-tight">
                      <span className="whitespace-nowrap text-sm tabular-nums">
                        {formatPercent(b.weightPct / 100)}{" "}
                        <span className="text-muted-foreground">
                          / {formatPercent(b.objective!.targetPct / 100)}
                        </span>
                      </span>
                      {b.driftEur != null && Math.abs(b.driftEur) >= 1 ? (
                        <SensitiveValue className={`whitespace-nowrap text-xs tabular-nums ${tone}`}>
                          {b.driftEur > 0
                            ? `faltan ${formatEur(b.driftEur)}`
                            : `sobran ${formatEur(-b.driftEur)}`}
                        </SensitiveValue>
                      ) : (
                        <span className={`text-xs ${tone}`}>en plan</span>
                      )}
                    </span>
                    <span className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setForm({
                            id: b.objective!.id,
                            name: b.objective!.name,
                            color: resolveObjectiveColorVar(b.objective!.color, i),
                          })
                        }
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting({ id: b.objective!.id, name: b.objective!.name })}
                      >
                        Eliminar
                      </Button>
                    </span>
                  </span>
                </li>
              );
            })}
            {unassigned && (
              <li className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border/60 px-3 py-2 text-muted-foreground">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  <span className="text-sm">Sin tag</span>
                  <span className="text-xs" title={unassigned.assets.map((a) => a.symbol ?? a.name).join(", ")}>
                    ·{unassigned.assets.length}
                  </span>
                </span>
                <span className="flex items-baseline gap-2 text-sm tabular-nums">
                  {formatPercent(unassigned.weightPct / 100)}
                  <SensitiveValue className="text-xs">
                    {formatEur(unassigned.valueEur)}
                  </SensitiveValue>
                </span>
              </li>
            )}
            <li className="px-3 pt-1 text-xs text-muted-foreground">
              Anillo exterior: tu plan — arrastra los tiradores para mover peso entre
              tags vecinos. Anillo interior: tu cartera real hoy. Arrastra las filas
              para reordenar tags y gráfico.
            </li>
          </ul>
        </div>
      )}

      <Modal
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
        title={form?.id ? "Editar tag" : "Nuevo tag"}
        description="Un tag agrupa activos equivalentes aunque vivan en brokers distintos. El peso se reparte después, arrastrando el gráfico."
      >
        {form && (
          <form onSubmit={submitForm} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Nombre</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
                maxLength={40}
                placeholder="World, Crypto, Oro, Small caps…"
                autoFocus
                required
              />
            </label>
            <fieldset className="flex flex-col gap-1.5 text-sm">
              <legend className="font-medium">Color</legend>
              <div className="flex flex-wrap gap-2 pt-1">
                {OBJECTIVE_COLOR_VARS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, color: c })}
                    aria-label={`Color ${c.replace("--chart-", "")}`}
                    aria-pressed={form.color === c}
                    className={`h-7 w-7 rounded-full transition-transform ${
                      form.color === c
                        ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-card"
                        : "hover:scale-105"
                    }`}
                    style={{ backgroundColor: objectiveColorCss(c) }}
                  />
                ))}
              </div>
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Guardando…" : form.id ? "Guardar" : "Crear tag"}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmModal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`¿Eliminar el tag «${deleting?.name}»?`}
        description="Sus activos quedarán sin tag (no se borra ningún activo ni transacción)."
        confirmLabel="Eliminar"
        confirmVariant="danger"
        onConfirm={confirmDelete}
      />
    </Card>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";
