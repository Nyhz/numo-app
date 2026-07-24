export const dynamic = "force-dynamic";

import Link from "next/link";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { DataTable } from "@/src/components/ui/DataTable";
import { AssetLogo } from "@/src/components/ui/AssetLogo";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { listTransactions } from "@/src/server/transactions";
import { listAccounts } from "@/src/server/accounts";
import { listAssets } from "@/src/server/assets";
import { formatEur, formatDateTime } from "@/src/lib/format";
import { transactionTypeLabel } from "@/src/lib/labels";
import type { AssetTransaction } from "@/src/db/schema";
import { TransactionsNewButton } from "@/src/components/features/transactions/TransactionsNewButton";
import { TransactionsExtraActions } from "@/src/components/features/transactions/TransactionsExtraActions";
import { DeleteTransactionButton } from "@/src/components/features/transactions/DeleteTransactionButton";

type SearchParams = Promise<{ cursor?: string }>;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { cursor } = await searchParams;
  const [result, accounts, assets] = await Promise.all([
    listTransactions({ cursor, limit: 50 }),
    listAccounts(),
    listAssets(),
  ]);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const assetById = new Map(assets.map((a) => [a.id, a]));

  const nextHref = result.nextCursor
    ? `/transactions?cursor=${encodeURIComponent(result.nextCursor)}`
    : null;
  const prevHref = cursor ? "/transactions" : null;

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transacciones</h1>
          <p className="text-sm text-muted-foreground">
            Cronología unificada de operaciones y movimientos de efectivo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TransactionsExtraActions
            accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
            assets={assets.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
          />
          <TransactionsNewButton
            accounts={accounts
              .filter((a) => a.accountType !== "savings")
              .map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
            assets={assets.map((a) => ({
              id: a.id,
              name: a.name,
              symbol: a.symbol ?? null,
              currency: a.currency,
            }))}
            cashAccounts={accounts
              .filter((a) => a.accountType === "savings")
              .map((a) => ({
                id: a.id,
                name: a.name,
                currency: a.currency,
                accountType: a.accountType,
              }))}
          />
        </div>
      </header>

      {result.items.length === 0 && !cursor ? (
        <StatesBlock
          mode="empty"
          title="Sin transacciones"
          description="Registra una operación con «Nueva transacción» para poblar la cronología."
        />
      ) : (
        <DataTable<AssetTransaction>
          rows={result.items}
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
              cell: (r) => accountName.get(r.accountId) ?? r.accountId,
            },
            {
              key: "asset",
              header: "Activo",
              cell: (r) => {
                const a = assetById.get(r.assetId);
                if (!a) return r.assetId;
                return (
                  <Link
                    href={`/assets/${a.id}`}
                    className="flex items-center gap-2 hover:underline"
                  >
                    <AssetLogo name={a.name} logoUrl={a.logoUrl} size={18} />
                    {a.symbol ?? a.name}
                  </Link>
                );
              },
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
                  <span
                    className="tabular-nums"
                    title="Canje: nuevas por antiguas"
                  >
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
              <span>{result.items.length} filas</span>
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
      )}
    </div>
  );
}
