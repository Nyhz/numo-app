import Link from "next/link";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { DeleteTransactionButton } from "@/src/components/features/transactions/DeleteTransactionButton";
import { formatDateTime, formatEur } from "@/src/lib/format";
import { transactionTypeLabel } from "@/src/lib/labels";
import type { AssetTransaction } from "@/src/db/schema";

/** Ledger del activo: la tabla de /transactions con el filtro de activo fijo
 *  (sin columna «Activo»). La paginación conserva el rango de la gráfica. */
export function AssetTransactionsTable({
  items,
  accountNameById,
  nextHref,
  prevHref,
}: {
  items: AssetTransaction[];
  accountNameById: Map<string, string>;
  nextHref: string | null;
  prevHref: string | null;
}) {
  return (
    <DataTable<AssetTransaction>
      rows={items}
      getRowKey={(r) => r.id}
      emptyState="Sin transacciones en esta página."
      columns={[
        {
          key: "date",
          header: "Fecha",
          cell: (r) => formatDateTime(r.tradedAt),
        },
        {
          key: "account",
          header: "Cuenta",
          cell: (r) => accountNameById.get(r.accountId) ?? r.accountId,
        },
        {
          key: "type",
          header: "Tipo",
          cell: (r) => transactionTypeLabel(r.transactionType),
        },
        {
          key: "qty",
          header: "Cant.",
          align: "right",
          cell: (r) =>
            r.transactionType === "split" ? (
              <span className="tabular-nums" title="Canje: nuevas por antiguas">
                {r.splitNumerator ?? "?"}:{r.splitDenominator ?? "?"}
              </span>
            ) : (
              <span className="tabular-nums">{r.quantity.toFixed(4)}</span>
            ),
        },
        {
          key: "price",
          header: "Precio",
          align: "right",
          cell: (r) =>
            r.transactionType === "split" ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <SensitiveValue className="tabular-nums">
                {r.unitPrice.toFixed(4)}
              </SensitiveValue>
            ),
        },
        {
          key: "fx",
          header: "FX → EUR",
          align: "right",
          cell: (r) => (
            <span className="tabular-nums text-xs text-muted-foreground">
              {r.tradeCurrency === "EUR" ? "—" : r.fxRateToEur.toFixed(6)}
              {r.fxSource === "latest" ? (
                <Badge
                  variant="warning"
                  className="ml-1.5"
                  title="No existía tipo de cambio para la fecha de la operación — se usó el más reciente anterior. Los importes en EUR derivados de él son aproximados."
                >
                  FX desactualizado
                </Badge>
              ) : null}
            </span>
          ),
        },
        {
          key: "total",
          header: "Total (EUR)",
          align: "right",
          cell: (r) => (
            <SensitiveValue>{formatEur(r.tradeGrossAmountEur)}</SensitiveValue>
          ),
        },
        {
          key: "fee",
          header: "Comisión (EUR)",
          align: "right",
          cell: (r) => (
            <SensitiveValue>{formatEur(r.feesAmountEur)}</SensitiveValue>
          ),
        },
        {
          key: "actions",
          header: "",
          align: "right",
          cell: (r) => <DeleteTransactionButton id={r.id} />,
        },
      ]}
      footer={
        <>
          <span>{items.length} filas</span>
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
  );
}
