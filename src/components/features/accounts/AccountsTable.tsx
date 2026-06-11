"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { deleteAccount } from "@/src/actions/deleteAccount";
import { formatEur, formatMoney } from "@/src/lib/format";
import { accountCountryLabel, accountTypeLabel } from "@/src/lib/labels";
import type { AccountWithTotals } from "@/src/server/accounts";
import { isCashBearingAccount } from "@/src/actions/_constants";
import { EditAccountModal } from "./EditAccountModal";

export function AccountsTable({ rows }: { rows: AccountWithTotals[] }) {
  const [target, setTarget] = React.useState<AccountWithTotals | null>(null);
  const [editing, setEditing] = React.useState<AccountWithTotals | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);

  async function confirmDelete() {
    if (!target) return;
    const result = await deleteAccount({ id: target.id });
    if (!result.ok) {
      setBanner(result.error.message);
    } else {
      setBanner(null);
    }
    setTarget(null);
  }

  return (
    <>
      {banner && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {banner}
        </div>
      )}
      <DataTable<AccountWithTotals>
        rows={rows}
        getRowKey={(r) => r.id}
        columns={[
          { key: "name", header: "Nombre", cell: (r) => r.name },
          {
            key: "type",
            header: "Tipo",
            cell: (r) => accountTypeLabel(r.accountType),
          },
          { key: "currency", header: "Divisa", cell: (r) => r.currency },
          {
            key: "country",
            header: "País",
            cell: (r) =>
              r.countryCode ? (
                <span title={accountCountryLabel(r.countryCode)}>{r.countryCode}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            key: "eur",
            header: "Saldo (EUR)",
            align: "right",
            cell: (r) =>
              isCashBearingAccount(r.accountType) ? (
                <SensitiveValue>{formatEur(r.currentCashBalanceEur)}</SensitiveValue>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            key: "native",
            header: "Saldo (divisa nativa)",
            align: "right",
            cell: (r) =>
              isCashBearingAccount(r.accountType) ? (
                <SensitiveValue>
                  {formatMoney(r.currentCashBalanceEur, r.currency)}
                </SensitiveValue>
              ) : (
                <span className="text-muted-foreground">—</span>
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
                    <DropdownMenu.Item
                      onSelect={() => {
                        setBanner(null);
                        setEditing(r);
                      }}
                      className="flex cursor-pointer items-center rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-accent"
                    >
                      Editar
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={() => {
                        setBanner(null);
                        setTarget(r);
                      }}
                      className="flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-destructive outline-none data-[highlighted]:bg-accent"
                    >
                      Eliminar
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ),
          },
        ]}
      />

      <EditAccountModal
        account={editing}
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
      />
      <ConfirmModal
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
        title={`¿Eliminar ${target?.name ?? "la cuenta"}?`}
        description="Las cuentas solo se pueden eliminar cuando no tienen transacciones ni movimientos de efectivo."
        confirmLabel="Eliminar"
        onConfirm={confirmDelete}
      />
    </>
  );
}
