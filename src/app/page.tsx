export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { BenchmarkToggles } from "@/src/components/features/overview/BenchmarkToggles";
import { NetWorthChart } from "@/src/components/features/overview/NetWorthChart";
import { OverviewFilters } from "@/src/components/features/overview/OverviewFilters";
import { TopPositionsTable } from "@/src/components/features/overview/TopPositionsTable";
import { SavingsBalanceChart } from "@/src/components/features/overview/SavingsBalanceChart";
import { SavingsMovementsTable } from "@/src/components/features/overview/SavingsMovementsTable";
import {
  ChartCardSkeleton,
  KpiRowSkeleton,
  TableCardSkeleton,
} from "@/src/components/features/overview/skeletons";
import { parseBenchmarkKeys, type BenchmarkKey } from "@/src/lib/benchmarks";
import { listAccounts } from "@/src/server/accounts";
import { getBenchmarkSeries } from "@/src/server/benchmarks";
import {
  OVERVIEW_RANGES,
  getNetWorthSeries,
  getOverviewKpis,
  getTopPositions,
  type OverviewRange,
} from "@/src/server/overview";
import {
  getSavingsBalanceSeries,
  getSavingsKpis,
  getSavingsMovements,
} from "@/src/server/savings";
import { formatEur, formatPercent } from "@/src/lib/format";

function parseRange(value: string | string[] | undefined): OverviewRange {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && (OVERVIEW_RANGES as string[]).includes(raw)) {
    return raw as OverviewRange;
  }
  return "ALL";
}

function parseAccountIds(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

type Filters = { range: OverviewRange; accountIds: string[] };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function KpiRow({ filters }: { filters: Filters }) {
  const kpis = await getOverviewKpis(filters);
  const pnlTone =
    kpis.unrealizedPnlEur > 0
      ? "text-success"
      : kpis.unrealizedPnlEur < 0
        ? "text-destructive"
        : "";
  const xirrTone =
    kpis.xirrPct != null && kpis.xirrPct > 0
      ? "text-success"
      : kpis.xirrPct != null && kpis.xirrPct < 0
        ? "text-destructive"
        : "";
  return (
    <Card className="p-0">
      <div className="grid divide-y divide-border/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="flex flex-col gap-1.5 p-5">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Valor total a precios de mercado: efectivo más posiciones valoradas."
          >
            Patrimonio total
          </span>
          <SensitiveValue className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatEur(kpis.totalNetWorthEur)}
          </SensitiveValue>
          <span className="text-xs text-muted-foreground">
            Efectivo <SensitiveValue>{formatEur(kpis.cashEur)}</SensitiveValue> · invertido{" "}
            <SensitiveValue>{formatEur(kpis.investedMarketValueEur)}</SensitiveValue>
          </span>
        </div>
        <div className="flex flex-col gap-1.5 p-5">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Diferencia entre el valor de mercado actual y lo que pagaste (comisiones incluidas). No tributa hasta que vendas."
          >
            Plusvalía latente
          </span>
          <span className="flex items-baseline gap-2">
            <SensitiveValue
              className={`text-3xl font-semibold tracking-tight tabular-nums ${pnlTone}`}
            >
              {formatEur(kpis.unrealizedPnlEur)}
            </SensitiveValue>
            {kpis.unrealizedPnlPct != null && (
              <span className={`text-sm font-medium tabular-nums ${pnlTone}`}>
                {`${kpis.unrealizedPnlPct >= 0 ? "+" : ""}${formatPercent(
                  kpis.unrealizedPnlPct,
                )}`}
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            Sobre el coste de compra — no tributa hasta vender.
          </span>
        </div>
        <div className="flex flex-col gap-1.5 p-5">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Rentabilidad anualizada de TUS flujos reales (XIRR): pondera cada euro por el tiempo que llevó invertido. La plusvalía % mide la cartera; esta cifra te mide a ti — tus fechas de entrada y el tamaño de cada aportación."
          >
            TIR personal
          </span>
          <span
            className={`text-3xl font-semibold tracking-tight tabular-nums ${xirrTone}`}
          >
            {kpis.xirrPct == null
              ? "—"
              : `${kpis.xirrPct >= 0 ? "+" : ""}${formatPercent(kpis.xirrPct)}`}
          </span>
          <span className="text-xs text-muted-foreground">
            Anualizada, con tus fechas y aportaciones reales.
          </span>
        </div>
      </div>
    </Card>
  );
}

async function NetWorthCard({
  filters,
  benchKeys,
}: {
  filters: Filters;
  benchKeys: BenchmarkKey[];
}) {
  const series = await getNetWorthSeries(filters);
  const benchmarks = await getBenchmarkSeries(
    benchKeys,
    series.map((p) => p.date),
  );
  return (
    <Card
      title="Evolución del patrimonio"
      action={<BenchmarkToggles active={benchKeys} />}
    >
      {series.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="Sin historial de valoraciones"
          description="Las valoraciones diarias aparecerán cuando se sincronicen precios y haya transacciones."
        />
      ) : (
        <NetWorthChart data={series} benchmarks={benchmarks} />
      )}
    </Card>
  );
}

async function TopPositionsCard({ filters }: { filters: Filters }) {
  const rows = await getTopPositions(filters, 10);
  return <TopPositionsTable rows={rows} />;
}

async function SavingsKpiRow({
  accountId,
  range,
}: {
  accountId: string;
  range: OverviewRange;
}) {
  const kpis = await getSavingsKpis(accountId, range);
  const rangeLabel = range === "ALL" ? "histórico" : `últimos ${range}`;
  return (
    <Card className="p-0">
      <div className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="flex flex-col gap-1.5 p-5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Saldo actual
          </span>
          <SensitiveValue className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatEur(kpis.balanceEur)}
          </SensitiveValue>
          <span className="text-xs text-muted-foreground">
            Ingresos <SensitiveValue>{formatEur(kpis.depositsEur)}</SensitiveValue> · retiradas{" "}
            <SensitiveValue>{formatEur(kpis.withdrawalsEur)}</SensitiveValue> ({rangeLabel})
          </span>
        </div>
        <div className="flex flex-col gap-1.5 p-5">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Rendimiento del capital mobiliario — tributa en la base del ahorro."
          >
            Intereses cobrados
          </span>
          <SensitiveValue className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatEur(kpis.interestEur)}
          </SensitiveValue>
          <span className="text-xs text-muted-foreground">Periodo: {rangeLabel}.</span>
        </div>
      </div>
    </Card>
  );
}

async function SavingsBalanceCard({
  accountId,
  range,
}: {
  accountId: string;
  range: OverviewRange;
}) {
  const series = await getSavingsBalanceSeries(accountId, range);
  return (
    <Card title="Evolución del saldo">
      {series.length < 2 ? (
        <StatesBlock
          mode="empty"
          title="Sin historial de saldo"
          description="Los movimientos aparecerán cuando esta cuenta tenga actividad."
        />
      ) : (
        <SavingsBalanceChart data={series} />
      )}
    </Card>
  );
}

async function SavingsMovementsCard({
  accountId,
  range,
}: {
  accountId: string;
  range: OverviewRange;
}) {
  const rows = await getSavingsMovements(accountId, range, 20);
  return <SavingsMovementsTable rows={rows} />;
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const rawAccountIds = parseAccountIds(params.accounts);

  const accountsList = await listAccounts();
  const validIds = new Set(accountsList.map((a) => a.id));
  const accountIds = rawAccountIds.filter((id) => validIds.has(id));
  const benchKeys = parseBenchmarkKeys(params.bench);
  const filters: Filters = { range, accountIds };
  const suspenseKey = `${range}:${accountIds.length === 0 ? "all" : accountIds.join(",")}`;

  const selectedAccount =
    accountIds.length === 1
      ? accountsList.find((a) => a.id === accountIds[0]) ?? null
      : null;
  const isSavingsView =
    selectedAccount?.accountType === "savings";

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resumen</h1>
          <p className="text-sm text-muted-foreground">
            Tu cartera a precios de mercado, en todas las cuentas.
          </p>
        </div>
        <Suspense fallback={null}>
          <OverviewFilters
            accounts={accountsList.map((a) => ({ id: a.id, name: a.name }))}
            range={range}
            accountIds={accountIds}
          />
        </Suspense>
      </header>

      {isSavingsView && selectedAccount ? (
        <>
          <Suspense key={`kpi:${suspenseKey}`} fallback={<KpiRowSkeleton />}>
            <SavingsKpiRow accountId={selectedAccount.id} range={range} />
          </Suspense>
          <Suspense
            key={`bal:${suspenseKey}`}
            fallback={<ChartCardSkeleton title="Evolución del saldo" heightClass="h-72" />}
          >
            <SavingsBalanceCard accountId={selectedAccount.id} range={range} />
          </Suspense>
          <Suspense
            key={`mov:${suspenseKey}`}
            fallback={<TableCardSkeleton title="Movimientos recientes" />}
          >
            <SavingsMovementsCard accountId={selectedAccount.id} range={range} />
          </Suspense>
        </>
      ) : (
        <>
          <Suspense key={`kpi:${suspenseKey}`} fallback={<KpiRowSkeleton cells={3} />}>
            <KpiRow filters={filters} />
          </Suspense>
          <Suspense
            key={`net:${suspenseKey}`}
            fallback={<ChartCardSkeleton title="Evolución del patrimonio" />}
          >
            <NetWorthCard filters={filters} benchKeys={benchKeys} />
          </Suspense>
          <Suspense
            key={`top:${suspenseKey}`}
            fallback={<TableCardSkeleton title="Posiciones" />}
          >
            <TopPositionsCard filters={filters} />
          </Suspense>
        </>
      )}
    </div>
  );
}
