"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { DataTable } from "@/src/components/ui/DataTable";
import { assetTypeLabel } from "@/src/components/ui/AssetTypeBadge";
import { deactivateAsset } from "@/src/actions/deactivateAsset";
import { deleteAsset } from "@/src/actions/deleteAsset";
import type { Asset } from "@/src/db/schema";
import type { AssetListRow } from "@/src/server/assets";
import { EditAssetModal } from "./EditAssetModal";
import { SetManualPriceModal } from "./SetManualPriceModal";

type ModalKind = "edit" | "price" | "deactivate" | "delete" | null;

function FreshnessCell({ row }: { row: AssetListRow }) {
  const f = row.freshness;
  if (!f) {
    return <span className="text-xs text-muted-foreground">Sin precio</span>;
  }
  const when = new Date(f.pricedAt).toISOString().slice(0, 10);
  const KNOWN: Record<string, { label: string; variant: "success" | "neutral" | "warning" }> = {
    yahoo: { label: "Yahoo", variant: "success" },
    "yahoo-backfill": { label: "Yahoo", variant: "success" },
    coingecko: { label: "CoinGecko", variant: "success" },
    manual: { label: "Manual", variant: "neutral" },
  };
  const known = KNOWN[f.source];
  const label = known?.label ?? f.source;
  const variant = known?.variant ?? "warning";
  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant={variant}>{label}</Badge>
      <span className="text-xs text-muted-foreground">{when}</span>
    </span>
  );
}

export function AssetsTable({ rows }: { rows: AssetListRow[] }) {
  const [active, setActive] = React.useState<Asset | null>(null);
  const [modal, setModal] = React.useState<ModalKind>(null);

  function open(kind: Exclude<ModalKind, null>, asset: Asset) {
    setActive(asset);
    setModal(kind);
  }

  function closeModal() {
    setModal(null);
  }

  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  async function confirmDeactivate() {
    if (!active) return;
    await deactivateAsset({ id: active.id });
    closeModal();
  }

  async function confirmDelete() {
    if (!active) return;
    setDeleteError(null);
    const result = await deleteAsset({ id: active.id });
    if (!result.ok) {
      setDeleteError(result.error.message);
      throw new Error(result.error.message);
    }
    closeModal();
  }

  return (
    <>
      <DataTable<AssetListRow>
        rows={rows}
        getRowKey={(r) => r.id}
        columns={[
          { key: "symbol", header: "Símbolo", cell: (r) => r.symbol ?? "—" },
          { key: "name", header: "Nombre", cell: (r) => r.name },
          {
            key: "type",
            header: "Tipo",
            cell: (r) => assetTypeLabel(r.assetType),
          },
          { key: "currency", header: "Divisa", cell: (r) => r.currency },
          {
            key: "ter",
            header: "TER",
            cell: (r) =>
              r.ter != null ? (
                `${r.ter.toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              ),
          },
          {
            key: "price",
            header: "Precio",
            cell: (r) => <FreshnessCell row={r} />,
          },
          {
            key: "active",
            header: "Estado",
            cell: (r) =>
              r.isActive ? (
                <Badge variant="success">Activo</Badge>
              ) : (
                <Badge>Inactivo</Badge>
              ),
          },
          {
            key: "actions",
            header: "",
            align: "right",
            cell: (r) => (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Acciones para ${r.name}`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className="z-50 min-w-[10rem] rounded-md border border-border bg-card p-1 text-sm shadow-md"
                  >
                    <MenuItem onSelect={() => open("edit", r)}>Editar</MenuItem>
                    <MenuItem onSelect={() => open("price", r)}>Fijar precio manual</MenuItem>
                    <MenuItem
                      onSelect={() => open("deactivate", r)}
                      disabled={!r.isActive}
                      danger
                    >
                      Desactivar
                    </MenuItem>
                    <MenuItem onSelect={() => open("delete", r)} danger>
                      Eliminar
                    </MenuItem>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ),
          },
        ]}
      />

      <EditAssetModal
        key={`edit-${active?.id ?? "none"}`}
        asset={modal === "edit" ? active : null}
        open={modal === "edit"}
        onOpenChange={(next) => {
          if (!next) closeModal();
        }}
      />

      <SetManualPriceModal
        key={`price-${active?.id ?? "none"}`}
        asset={modal === "price" ? active : null}
        open={modal === "price"}
        onOpenChange={(next) => {
          if (!next) closeModal();
        }}
      />

      <ConfirmModal
        open={modal === "deactivate"}
        onOpenChange={(next) => {
          if (!next) closeModal();
        }}
        title={`¿Desactivar ${active?.name ?? "el activo"}?`}
        description="El activo permanece en el historial pero se oculta en las nuevas transacciones."
        confirmLabel="Desactivar"
        onConfirm={confirmDeactivate}
      />

      <ConfirmModal
        open={modal === "delete"}
        onOpenChange={(next) => {
          if (!next) {
            closeModal();
            setDeleteError(null);
          }
        }}
        title={`¿Eliminar ${active?.name ?? "el activo"}?`}
        description={
          <div className="flex flex-col gap-2">
            <p>
              Elimina permanentemente el activo junto con todas sus
              valoraciones de precio y filas de posición. Se rechaza si alguna
              transacción aún referencia el activo — elimina esas primero.
            </p>
            {deleteError && (
              <p className="text-sm font-medium text-destructive">
                {deleteError}
              </p>
            )}
          </div>
        }
        confirmLabel="Eliminar"
        confirmVariant="danger"
        onConfirm={confirmDelete}
      />
    </>
  );
}

function MenuItem({
  children,
  onSelect,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={`flex cursor-pointer items-center rounded-sm px-2 py-1.5 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent ${
        danger ? "text-destructive" : ""
      }`}
    >
      {children}
    </DropdownMenu.Item>
  );
}
