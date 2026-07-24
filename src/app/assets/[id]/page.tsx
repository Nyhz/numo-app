export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { AssetDetailHeader } from "@/src/components/features/assets/detail/AssetDetailHeader";
import { AssetKpis } from "@/src/components/features/assets/detail/AssetKpis";
import { AssetPriceChart } from "@/src/components/features/assets/detail/AssetPriceChart";
import { AssetTransactionsTable } from "@/src/components/features/assets/detail/AssetTransactionsTable";
import { AssetWeightDonut } from "@/src/components/features/assets/detail/AssetWeightDonut";
import { OpenLotsCard } from "@/src/components/features/assets/detail/OpenLotsCard";
import { GainsTable } from "@/src/components/features/taxes/GainsTable";
import { cn } from "@/src/lib/cn";
import { formatDateTime, formatEur } from "@/src/lib/format";
import { listAccounts } from "@/src/server/accounts";
import {
  ASSET_DETAIL_RANGES,
  getAssetDetail,
  parseAssetDetailRange,
  type AssetDetailRange,
} from "@/src/server/assetDetail";
import { listTransactions } from "@/src/server/transactions";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ cursor?: string; range?: string }>;

function rangeHref(id: string, range: AssetDetailRange): string {
  return range === "MAX" ? `/assets/${id}` : `/assets/${id}?range=${range}`;
}

function RangeTabs({ id, range }: { id: string; range: AssetDetailRange }) {
  return (
    <div className="flex items-center gap-1">
      {ASSET_DETAIL_RANGES.map((r) => (
        <Link
          key={r}
          href={rangeHref(id, r)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            r === range
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {r === "MAX" ? "Máx" : r}
        </Link>
      ))}
    </div>
  );
}

export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { cursor, range: rawRange } = await searchParams;
  const range = parseAssetDetailRange(rawRange);

  const [detail, txs, accounts] = await Promise.all([
    getAssetDetail(id, range),
    listTransactions({ assetId: id, cursor, limit: 50 }),
    listAccounts(),
  ]);
  if (!detail) notFound();

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const base = rangeHref(id, range);
  const sep = base.includes("?") ? "&" : "?";
  const nextHref = txs.nextCursor
    ? `${base}${sep}cursor=${encodeURIComponent(txs.nextCursor)}`
    : null;
  const prevHref = cursor ? base : null;

  const hasComposition =
    detail.sectors.slices.length > 0 || detail.regions.slices.length > 0;
  const showLots = detail.openLots.length > 0;
  const compositionAsOf = detail.sectors.asOf ?? detail.regions.asOf;

  return (
    <div className="flex flex-col gap-6 p-8">
      <AssetDetailHeader detail={detail} />

      <Card title="Precio" action={<RangeTabs id={id} range={range} />}>
        {detail.series.length === 0 ? (
          <StatesBlock
            mode="empty"
            title="Sin historial de precio"
            description="La serie aparecerá cuando haya valoraciones sincronizadas durante la tenencia del activo."
          />
        ) : (
          <AssetPriceChart
            data={detail.series}
            averageCostEur={detail.state === "open" ? detail.averageCostEur : null}
          />
        )}
      </Card>

      <AssetKpis detail={detail} />

      {(showLots || hasComposition) && (
        <section className="grid items-start gap-6 lg:grid-cols-3">
          {showLots && (
            <div className={cn(hasComposition ? "lg:col-span-2" : "lg:col-span-3")}>
              <OpenLotsCard
                lots={detail.openLots}
                lastPriceEur={detail.lastPrice?.unitPriceEur ?? null}
                sellToday={detail.sellToday}
              />
            </div>
          )}
          {hasComposition && (
            <div
              className={cn(
                "flex flex-col gap-6",
                showLots ? "" : "lg:col-span-3 lg:grid lg:grid-cols-2 lg:gap-6",
              )}
            >
              {detail.sectors.slices.length > 0 && (
                <Card
                  title="Sectores"
                  action={
                    compositionAsOf != null ? (
                      <span className="text-xs text-muted-foreground">
                        Datos a {formatDateTime(compositionAsOf)}
                      </span>
                    ) : undefined
                  }
                >
                  <AssetWeightDonut slices={detail.sectors.slices} kind="sector" />
                </Card>
              )}
              {detail.regions.slices.length > 0 && (
                <Card title="Regiones">
                  <AssetWeightDonut slices={detail.regions.slices} kind="region" />
                </Card>
              )}
            </div>
          )}
        </section>
      )}

      {detail.realized && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Ventas realizadas</h2>
          <GainsTable
            sales={detail.realized.sales}
            hint="Una fila por venta, con sus lotes FIFO desplegables. La transcripción a Rentanet vive en Fiscalidad → ejercicio correspondiente."
          />
        </section>
      )}

      {detail.dividends && (
        <Card title="Dividendos cobrados">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Cobros</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {detail.dividends.count}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Bruto (EUR)</dt>
              <dd>
                <SensitiveValue className="text-sm font-semibold tabular-nums">
                  {formatEur(detail.dividends.grossEur)}
                </SensitiveValue>
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Retenciones</dt>
              <dd>
                <SensitiveValue className="text-sm font-semibold tabular-nums">
                  {formatEur(detail.dividends.withholdingEur)}
                </SensitiveValue>
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Neto (EUR)</dt>
              <dd>
                <SensitiveValue className="text-sm font-semibold tabular-nums">
                  {formatEur(detail.dividends.netEur)}
                </SensitiveValue>
              </dd>
            </div>
          </dl>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Transacciones del activo</h2>
        {txs.items.length === 0 && !cursor ? (
          <StatesBlock
            mode="empty"
            title="Sin transacciones"
            description="Las operaciones de este activo aparecerán aquí."
          />
        ) : (
          <AssetTransactionsTable
            items={txs.items}
            accountNameById={accountNameById}
            nextHref={nextHref}
            prevHref={prevHref}
          />
        )}
      </section>
    </div>
  );
}
