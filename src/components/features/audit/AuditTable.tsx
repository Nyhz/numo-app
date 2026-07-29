"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { loadAuditDiff } from "@/src/actions/loadAuditDiff";
import { cn } from "@/src/lib/cn";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import type { AuditEventSummary } from "@/src/server/audit";
import { formatDateTime } from "@/src/lib/format";
import { auditActionLabel, auditEntityLabel, auditSourceLabel } from "@/src/lib/labels";

type DiffState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; previousJson: string | null; nextJson: string | null };

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function DiffView({
  previous,
  next,
}: {
  previous: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
}) {
  const keys = React.useMemo(() => {
    const set = new Set<string>();
    if (previous) for (const k of Object.keys(previous)) set.add(k);
    if (next) for (const k of Object.keys(next)) set.add(k);
    return Array.from(set).sort();
  }, [previous, next]);

  if (keys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin datos registrados para este evento.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <div className="grid grid-cols-[minmax(8rem,auto)_1fr_1fr] border-b border-border bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <div className="px-3 py-2">Clave</div>
        <div className="border-l border-border px-3 py-2">Anterior</div>
        <div className="border-l border-border px-3 py-2">Posterior</div>
      </div>
      <div className="divide-y divide-border font-mono text-xs">
        {keys.map((key) => {
          const prevHas = previous ? key in previous : false;
          const nextHas = next ? key in next : false;
          const prevVal = prevHas ? previous![key] : undefined;
          const nextVal = nextHas ? next![key] : undefined;
          const changed =
            !prevHas || !nextHas || JSON.stringify(prevVal) !== JSON.stringify(nextVal);
          return (
            <div
              key={key}
              className={cn(
                "grid grid-cols-[minmax(8rem,auto)_1fr_1fr]",
                changed && "bg-warning/10",
              )}
            >
              <div className="px-3 py-1.5 font-medium text-foreground">{key}</div>
              <div
                className={cn(
                  "border-l border-border px-3 py-1.5 text-muted-foreground",
                  changed && prevHas && "text-destructive",
                )}
              >
                <SensitiveValue>{prevHas ? renderValue(prevVal) : "—"}</SensitiveValue>
              </div>
              <div
                className={cn(
                  "border-l border-border px-3 py-1.5 text-muted-foreground",
                  changed && nextHas && "text-success",
                )}
              >
                <SensitiveValue>{nextHas ? renderValue(nextVal) : "—"}</SensitiveValue>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AuditTable({ rows }: { rows: AuditEventSummary[] }) {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [diffs, setDiffs] = React.useState<Record<string, DiffState>>({});

  function toggle(id: string) {
    const opening = !expanded[id];
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
    if (!opening || diffs[id]) return;
    // Primer despliegue de la fila: los blobs no viajan en el listado, se
    // piden aquí y quedan cacheados para reaperturas.
    setDiffs((prev) => ({ ...prev, [id]: { status: "loading" } }));
    void loadAuditDiff({ id }).then((res) => {
      setDiffs((prev) => ({
        ...prev,
        [id]: res.ok
          ? { status: "ready", previousJson: res.data.previousJson, nextJson: res.data.nextJson }
          : { status: "error" },
      }));
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-2 py-2.5" />
              <th className="px-4 py-2.5 text-left">Fecha</th>
              <th className="px-4 py-2.5 text-left">Entidad</th>
              <th className="px-4 py-2.5 text-left">ID de entidad</th>
              <th className="px-4 py-2.5 text-left">Acción</th>
              <th className="px-4 py-2.5 text-left">Actor</th>
              <th className="px-4 py-2.5 text-left">Origen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = !!expanded[r.id];
              return (
                <React.Fragment key={r.id}>
                  <tr
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                    onClick={() => toggle(r.id)}
                  >
                    <td className="px-2 py-2.5 text-muted-foreground">
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4" aria-label="Contraer" />
                      ) : (
                        <ChevronRight className="h-4 w-4" aria-label="Expandir" />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      {auditEntityLabel(r.entityType)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {r.entityId}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{auditActionLabel(r.action)}</td>
                    <td className="px-4 py-2.5 text-foreground">{r.actorType}</td>
                    <td className="px-4 py-2.5 text-foreground">{auditSourceLabel(r.source)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border bg-muted/20 last:border-0">
                      <td />
                      <td colSpan={6} className="px-4 py-4">
                        {r.summary && (
                          <p className="mb-3 text-sm text-muted-foreground">
                            {r.summary}
                          </p>
                        )}
                        {(() => {
                          const diff = diffs[r.id];
                          if (!diff || diff.status === "loading") {
                            return (
                              <p className="text-sm text-muted-foreground">
                                Cargando detalle…
                              </p>
                            );
                          }
                          if (diff.status === "error") {
                            return (
                              <p className="text-sm text-destructive">
                                No se pudo cargar el detalle del evento.
                              </p>
                            );
                          }
                          return (
                            <DiffView
                              previous={parseJson(diff.previousJson)}
                              next={parseJson(diff.nextJson)}
                            />
                          );
                        })()}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
