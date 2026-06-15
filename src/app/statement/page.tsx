export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { ChartCardSkeleton } from "@/src/components/features/overview/skeletons";
import { AllocationDonut } from "@/src/components/features/statement/AllocationDonut";
import { CostsCard } from "@/src/components/features/statement/CostsCard";
import { DrawdownChart } from "@/src/components/features/statement/DrawdownChart";
import { SectorAllocation } from "@/src/components/features/statement/SectorAllocation";
import { RegionAllocation } from "@/src/components/features/statement/RegionAllocation";
import { ObjectiveAllocation } from "@/src/components/features/statement/ObjectiveAllocation";
import { StatementExportMenu } from "@/src/components/features/statement/StatementExportMenu";
import { StatementValueChart } from "@/src/components/features/statement/StatementValueChart";
import { cn } from "@/src/lib/cn";
import { formatDateTime, formatEur, formatPercent } from "@/src/lib/format";
import { computeRiskMetrics, drawdownSeries } from "@/src/lib/risk";
import { accountTypeLabel } from "@/src/lib/labels";
import {
  OVERVIEW_RANGES,
  getNetWorthSeries,
  type OverviewRange,
} from "@/src/server/overview";
import {
  getStatementReport,
  type StatementAccountLine,
  type StatementReport,
} from "@/src/server/statement";
import { getSectorAllocation } from "@/src/server/sectors";
import { getCountryAllocation } from "@/src/server/countries";
import { getObjectivesAllocation } from "@/src/server/objectives";
import { getCostsSummary } from "@/src/server/costs";
import { resolveObjectiveColor } from "@/src/lib/objective-colors";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function parseRange(value: string | string[] | undefined): OverviewRange {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && (OVERVIEW_RANGES as string[]).includes(raw)) {
    return raw as OverviewRange;
  }
  return "ALL";
}

function RangeTabs({ range }: { range: OverviewRange }) {
  return (
    <div className="flex items-center gap-1">
      {OVERVIEW_RANGES.map((r) => (
        <Link
          key={r}
          href={r === "ALL" ? "/statement" : `/statement?range=${r}`}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            r === range
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {r === "ALL" ? "Todo" : r}
        </Link>
      ))}
    </div>
  );
}

function KpiRow({ report }: { report: StatementReport }) {
  const { totals } = report;
  const pnlTone =
    totals.unrealizedPnlEur > 0
      ? "text-success"
      : totals.unrealizedPnlEur < 0
        ? "text-destructive"
        : "";
  return (
    <Card className="p-0">
      <div className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="flex flex-col gap-1.5 p-5">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Valor total a precios de mercado: efectivo más posiciones valoradas."
          >
            Patrimonio total
          </span>
          <SensitiveValue className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatEur(totals.netWorthEur)}
          </SensitiveValue>
          <span className="text-xs text-muted-foreground">
            Efectivo <SensitiveValue>{formatEur(totals.cashEur)}</SensitiveValue> · invertido{" "}
            <SensitiveValue>{formatEur(totals.investedMarketValueEur)}</SensitiveValue>
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
              {formatEur(totals.unrealizedPnlEur)}
            </SensitiveValue>
            {totals.unrealizedPnlPct != null && (
              <span className={`text-sm font-medium tabular-nums ${pnlTone}`}>
                {`${totals.unrealizedPnlPct >= 0 ? "+" : ""}${formatPercent(
                  totals.unrealizedPnlPct,
                )}`}
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            Sobre el coste de compra — no tributa hasta vender.
          </span>
        </div>
      </div>
    </Card>
  );
}

async function ValueChartCard({ range }: { range: OverviewRange }) {
  const series = await getNetWorthSeries({ range, accountIds: [] });
  return (
    <Card title="Evolución del valor" action={<RangeTabs range={range} />}>
      {series.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="Sin historial de valoraciones"
          description="Las valoraciones diarias aparecerán cuando se sincronicen precios y haya transacciones."
        />
      ) : (
        <StatementValueChart data={series} />
      )}
    </Card>
  );
}

async function RiskCard({ range }: { range: OverviewRange }) {
  const series = await getNetWorthSeries({ range, accountIds: [] });
  const indexPoints = series.map((p) => ({ date: p.date, index: p.performanceIndex }));
  const metrics = computeRiskMetrics(indexPoints);
  const dd = drawdownSeries(indexPoints);
  if (!metrics || dd.length === 0) {
    return (
      <StatesBlock
        mode="empty"
        title="Sin historial suficiente"
        description="Las métricas de riesgo aparecerán con más días de valoraciones."
      />
    );
  }
  const stats: Array<{ label: string; value: string; hint?: string }> = [
    {
      label: "Drawdown máx.",
      value: formatPercent(metrics.maxDrawdown),
      hint: metrics.maxDrawdownDate ?? undefined,
    },
    {
      label: "Volatilidad anual",
      value:
        metrics.annualizedVolatility == null
          ? "—"
          : formatPercent(metrics.annualizedVolatility),
    },
    {
      label: "Peor día",
      value: metrics.worstDay ? formatPercent(metrics.worstDay.dailyReturn) : "—",
      hint: metrics.worstDay?.date,
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <DrawdownChart data={dd} />
      <dl className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground" title={s.hint}>
              {s.label}
            </dt>
            <dd className="text-sm font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AccountsTable({ accounts }: { accounts: StatementAccountLine[] }) {
  return (
    <DataTable<StatementAccountLine>
      rows={accounts}
      getRowKey={(a) => a.accountId}
      columns={[
        {
          key: "name",
          header: "Cuenta",
          cell: (a) => (
            <div className="flex flex-col">
              <span className="font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground">
                {accountTypeLabel(a.accountType)} · {a.currency}
              </span>
            </div>
          ),
        },
        {
          key: "cash",
          header: "Efectivo",
          align: "right",
          cell: (a) => (
            <SensitiveValue className="text-sm">{formatEur(a.cashEur)}</SensitiveValue>
          ),
        },
        {
          key: "invested",
          header: "Invertido",
          align: "right",
          cell: (a) => (
            <SensitiveValue className="text-sm">{formatEur(a.investedEur)}</SensitiveValue>
          ),
        },
        {
          key: "total",
          header: "Total",
          align: "right",
          cell: (a) => (
            <SensitiveValue className="text-sm font-medium">
              {formatEur(a.totalEur)}
            </SensitiveValue>
          ),
        },
      ]}
    />
  );
}

export default async function StatementPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const [report, sectorAllocation, countryAllocation, objectivesAllocation, costs] =
    await Promise.all([
      getStatementReport(),
      getSectorAllocation(),
      getCountryAllocation(),
      getObjectivesAllocation(),
      getCostsSummary(),
    ]);
  const hasPositions = report.totals.positionsCount > 0;

  // Portfolio split by allocation objective (live: reflects new objectives,
  // reassigned assets, and target edits on the next render). The unassigned
  // bucket (objective === null) renders in a neutral muted tone.
  const objectiveSlices = objectivesAllocation.buckets
    .map((bucket, i) => ({
      id: bucket.objective?.id ?? "unassigned",
      label: bucket.objective?.name ?? "Sin objetivo",
      valueEur: bucket.valueEur,
      weight: bucket.weightPct / 100,
      color: bucket.objective
        ? resolveObjectiveColor(bucket.objective.color, i)
        : "hsl(var(--muted-foreground))",
    }))
    .filter((slice) => slice.valueEur > 0)
    .sort((a, b) => b.valueEur - a.valueEur);

  const slices = report.groups
    .filter((g) => g.marketValueEur > 0)
    .map((g) => ({
      assetType: g.assetType,
      valueEur: g.marketValueEur,
      weight: g.weight,
    }));
  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Extracto</h1>
          <p className="text-sm text-muted-foreground">
            Extracto completo de la cartera a {formatDateTime(report.generatedAt)} — todas
            las cuentas y activos, valorados en EUR.
          </p>
        </div>
        <StatementExportMenu />
      </header>

      <KpiRow report={report} />

      <Suspense
        key={`value:${range}`}
        fallback={<ChartCardSkeleton title="Evolución del valor" />}
      >
        <ValueChartCard range={range} />
      </Suspense>

      {hasPositions ? (
        <section className="grid gap-6 lg:grid-cols-3">
          <Card title="Reparto por tipo de activo">
            {slices.length === 0 ? (
              <StatesBlock
                mode="empty"
                title="Sin posiciones valoradas"
                description="El reparto aparecerá cuando las posiciones tengan precio sincronizado."
              />
            ) : (
              <AllocationDonut
                slices={slices}
                totalEur={report.totals.investedMarketValueEur}
              />
            )}
          </Card>
          <Card
            title="Composición por regiones"
            action={
              countryAllocation.asOf != null ? (
                <span className="text-xs text-muted-foreground">
                  Datos a {formatDateTime(countryAllocation.asOf)}
                </span>
              ) : undefined
            }
          >
            {countryAllocation.slices.length === 0 ? (
              <StatesBlock
                mode="empty"
                title="Sin datos geográficos"
                description="La composición por regiones aparecerá tras la próxima sincronización de tus ETFs y fondos."
              />
            ) : (
              <RegionAllocation
                slices={countryAllocation.slices}
                classifiedEur={countryAllocation.classifiedEur}
              />
            )}
          </Card>
          <Card title="Riesgo — caída desde máximos">
            <Suspense
              key={`risk:${range}`}
              fallback={<Skeleton className="h-44 w-full" />}
            >
              <RiskCard range={range} />
            </Suspense>
          </Card>
        </section>
      ) : (
        <StatesBlock
          mode="empty"
          title="Sin posiciones abiertas"
          description="Registra transacciones para construir tu extracto."
        />
      )}

      {hasPositions && (
        <section className="grid gap-6 lg:grid-cols-3">
          <Card title="Composición por objetivos" className="lg:col-span-1">
            {objectiveSlices.length === 0 ? (
              <StatesBlock
                mode="empty"
                title="Sin objetivos"
                description="Asigna tus activos a objetivos en /objectives para ver el reparto aquí."
              />
            ) : (
              <ObjectiveAllocation
                slices={objectiveSlices}
                totalEur={objectivesAllocation.totalValuedEur}
              />
            )}
          </Card>
          <Card
            title="Composición por sectores"
            className="lg:col-span-2"
            action={
              sectorAllocation.asOf != null ? (
                <span className="text-xs text-muted-foreground">
                  Datos a {formatDateTime(sectorAllocation.asOf)}
                </span>
              ) : undefined
            }
          >
            {sectorAllocation.slices.length === 0 ? (
              <StatesBlock
                mode="empty"
                title="Sin datos sectoriales"
                description="La composición por sectores aparecerá tras la próxima sincronización de precios de tus ETFs y fondos."
              />
            ) : (
              <SectorAllocation
                slices={sectorAllocation.slices}
                classifiedEur={sectorAllocation.classifiedEur}
              />
            )}
          </Card>
        </section>
      )}

      <Card title="Costes — comisiones y TER">
        <CostsCard summary={costs} />
      </Card>

      <Card title="Cuentas">
        {report.accounts.length === 0 ? (
          <StatesBlock
            mode="empty"
            title="Sin cuentas"
            description="Crea una cuenta para empezar a registrar tu cartera."
          />
        ) : (
          <AccountsTable accounts={report.accounts} />
        )}
      </Card>
    </div>
  );
}
