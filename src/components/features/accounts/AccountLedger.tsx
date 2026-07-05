"use client";

import * as React from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { deleteCashMovement } from "@/src/actions/deleteCashMovement";
import { deleteTransaction } from "@/src/actions/deleteTransaction";
import { formatDateTime, formatEur } from "@/src/lib/format";
import { ledgerLabel } from "@/src/lib/labels";

type Kind = "transaction" | "cash_movement";

export type AccountLedgerRow = {
  kind: Kind;
  id: string;
  occurredAt: number;
  label: string;
  amountEur: number;
  assetSymbol: string | null;
  quantity: number | null;
  description: string | null;
};

export type AccountLedgerProps = {
  rows: AccountLedgerRow[];
  nextHref: string | null;
  prevHref: string | null;
};

type Target = { kind: Kind; id: string; label: string };

function kindVariant(label: string): React.ComponentProps<typeof Badge>["variant"] {
  switch (label) {
    case "buy":
    case "deposit":
    case "dividend":
    case "interest":
    case "transfer-in":
      return "success";
    case "sell":
    case "withdrawal":
    case "fee":
    case "transfer-out":
    case "transfer_out":
      return "warning";
    default:
      return "neutral";
  }
}

export function AccountLedger({ rows, nextHref, prevHref }: AccountLedgerProps) {
  const [target, setTarget] = React.useState<Target | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);

  async function onConfirm() {
    if (!target) return;
    const result =
      target.kind === "transaction"
        ? await deleteTransaction({ id: target.id })
        : await deleteCashMovement({ id: target.id });
    if (!result.ok) {
      setBanner(result.error.message);
      throw new Error(result.error.message);
    }
    setBanner(null);
  }

  return (
    <Card title="Movimientos">
      {banner && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {banner}
        </div>
      )}
      <DataTable<AccountLedgerRow>
        rows={rows}
        getRowKey={(r) => `${r.kind}:${r.id}`}
        emptyState="Sin movimientos en esta cuenta."
        columns={[
          {
            key: "date",
            header: "Fecha",
            cell: (r) => formatDateTime(r.occurredAt),
          },
          {
            key: "kind",
            header: "Tipo",
            cell: (r) => (
              <Badge variant={kindVariant(r.label)}>{ledgerLabel(r.label)}</Badge>
            ),
          },
          {
            key: "detail",
            header: "Detalle",
            cell: (r) => {
              if (r.kind === "transaction") {
                return (
                  <span className="text-muted-foreground">
                    {r.assetSymbol ?? "—"}
                    {r.quantity != null ? ` · ${r.quantity.toFixed(4)}` : ""}
                  </span>
                );
              }
              return (
                <span className="text-muted-foreground">{r.description ?? "—"}</span>
              );
            },
          },
          {
            key: "amount",
            header: "Importe (EUR)",
            align: "right",
            cell: (r) => {
              const color =
                r.amountEur > 0
                  ? "text-success"
                  : r.amountEur < 0
                    ? "text-destructive"
                    : "";
              return (
                <SensitiveValue className={color}>
                  {formatEur(r.amountEur)}
                </SensitiveValue>
              );
            },
          },
          {
            key: "actions",
            header: "",
            align: "right",
            cell: (r) => (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Eliminar ${ledgerLabel(r.label).toLowerCase()}`}
                onClick={() => {
                  setBanner(null);
                  setTarget({ kind: r.kind, id: r.id, label: r.label });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ),
          },
        ]}
        footer={
          <>
            <span>{rows.length} filas</span>
            <span className="flex items-center gap-2">
              {prevHref ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={prevHref}>Anterior</Link>
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled>
                  Anterior
                </Button>
              )}
              {nextHref ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={nextHref}>Siguiente</Link>
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled>
                  Siguiente
                </Button>
              )}
            </span>
          </>
        }
      />

      <ConfirmModal
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
        title={`¿Eliminar ${target ? ledgerLabel(target.label).toLowerCase() : "registro"}?`}
        description="Revierte el impacto en posiciones y efectivo cuando aplica, y registra un evento de auditoría. No se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={onConfirm}
      />
    </Card>
  );
}
