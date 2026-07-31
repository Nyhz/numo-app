"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Bell, Minus, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { AssetLogo } from "@/src/components/ui/AssetLogo";
import { AssetTypeBadge } from "@/src/components/ui/AssetTypeBadge";
import { PositionSparkline } from "@/src/components/features/overview/PositionSparkline";
import { cn } from "@/src/lib/cn";
import { deleteAlert } from "@/src/actions/deleteAlert";
import { toastResult } from "@/src/lib/toast";
import type { AlertKind, PriceAlert } from "@/src/db/schema";
import type { WatchlistItem } from "@/src/server/watchlist";
import { AlertModal } from "./AlertModal";

const KIND_LABELS: Record<AlertKind, string> = {
  price_below: "Baja de",
  price_above: "Sube a",
};

// Absolute price delta vs the last daily close — same baseline as the
// "% vs cierre" line below, so both always agree in sign and colour.
// Green ▲ up, red ▼ down, yellow — flat. Hidden until there's a close.
function CloseDeltaIndicator({
  price,
  lastClose,
  currency,
}: {
  price: number;
  lastClose: number | null;
  currency: string;
}) {
  if (lastClose == null) return null;
  const delta = price - lastClose;
  const up = delta > 0;
  const down = delta < 0;
  const Icon = up ? ArrowUp : down ? ArrowDown : Minus;
  const color = up ? "text-success" : down ? "text-destructive" : "text-warning";
  const sign = up ? "+" : down ? "−" : "";
  return (
    <span
      className={cn("flex items-center gap-0.5 text-xs font-medium tabular-nums", color)}
      title="Variación vs el último cierre diario"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <SensitiveValue>
        {sign}
        {fmt(Math.abs(delta), currency)}
      </SensitiveValue>
    </span>
  );
}

function fmt(n: number, currency: string): string {
  return `${n.toLocaleString("es-ES", { maximumFractionDigits: 4 })} ${currency}`;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function WatchlistCard({ item }: { item: WatchlistItem }) {
  const { asset, quote, lastClose, series, alerts } = item;
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PriceAlert | null>(null);
  const [toDelete, setToDelete] = React.useState<PriceAlert | null>(null);

  const price = quote?.price ?? null;
  const currency = quote?.currency ?? asset.currency;
  const changePct =
    price != null && lastClose != null && lastClose !== 0
      ? ((price - lastClose) / lastClose) * 100
      : null;

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(alert: PriceAlert) {
    setEditing(alert);
    setModalOpen(true);
  }
  async function confirmDelete() {
    if (!toDelete) return;
    const result = await deleteAlert({ id: toDelete.id });
    toastResult(result, "Alerta eliminada");
    setToDelete(null);
  }

  return (
    <>
      <Card className="flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <AssetLogo name={asset.name} logoUrl={asset.logoUrl} size={20} />
              <span className="truncate font-semibold">{asset.name}</span>
              <AssetTypeBadge type={asset.assetType} />
            </div>
            {asset.symbol && (
              <span className="text-xs text-muted-foreground">{asset.symbol}</span>
            )}
          </div>
          <div className="text-right">
            {price != null ? (
              <div className="flex items-center justify-end gap-1.5">
                <SensitiveValue as="span" className="text-lg font-semibold tabular-nums">
                  {fmt(price, currency)}
                </SensitiveValue>
                <CloseDeltaIndicator price={price} lastClose={lastClose} currency={currency} />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Sin cotización</span>
            )}
            {changePct != null && (
              <div
                className={cn(
                  "text-xs font-medium tabular-nums",
                  changePct > 0 ? "text-success" : changePct < 0 ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {changePct > 0 ? "▲" : changePct < 0 ? "▼" : ""}{" "}
                {Math.abs(changePct).toLocaleString("es-ES", { maximumFractionDigits: 2 })}% vs cierre
              </div>
            )}
          </div>
        </div>

        <div className="mt-3">
          {series.length >= 2 ? (
            <PositionSparkline data={series} id={asset.id} />
          ) : (
            <div className="flex h-12 items-center text-xs text-muted-foreground">
              Histórico insuficiente para el gráfico
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {quote
              ? `Actualizado ${fmtTime(quote.updatedAt)}`
              : "Aún sin refresco intradía"}
          </span>
        </div>

        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Bell className="h-3.5 w-3.5" /> Alertas
            </span>
            <Button variant="ghost" size="sm" onClick={openNew}>
              <Plus className="h-4 w-4" /> Añadir
            </Button>
          </div>

          {alerts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin alertas configuradas.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">
                      {KIND_LABELS[alert.kind]} <SensitiveValue>{fmt(alert.threshold, currency)}</SensitiveValue>
                    </span>
                    {alert.notifyTelegram && (
                      <Send className="h-3 w-3 text-muted-foreground" aria-label="Aviso por Telegram" />
                    )}
                    {alert.status === "triggered" ? (
                      <Badge variant="warning">Disparada</Badge>
                    ) : (
                      <Badge>Armada</Badge>
                    )}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar alerta"
                      onClick={() => openEdit(alert)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Eliminar alerta"
                      onClick={() => setToDelete(alert)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <AlertModal
        key={`${editing?.id ?? "new"}-${modalOpen}`}
        assetId={asset.id}
        assetName={asset.name}
        currency={currency}
        alert={editing}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />

      <ConfirmModal
        open={toDelete != null}
        onOpenChange={(next) => {
          if (!next) setToDelete(null);
        }}
        title="¿Eliminar alerta?"
        description="Dejarás de recibir avisos para esta condición."
        confirmLabel="Eliminar"
        confirmVariant="danger"
        onConfirm={confirmDelete}
      />
    </>
  );
}
