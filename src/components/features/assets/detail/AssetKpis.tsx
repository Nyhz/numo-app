import { Card } from "@/src/components/ui/Card";
import { KPICard } from "@/src/components/ui/KPICard";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatPercent, formatQuantity } from "@/src/lib/format";
import { RETURN_PERIODS, type ReturnPeriod } from "@/src/server/returns";
import type { AssetDetail } from "@/src/server/assetDetail";

const PERIOD_LABEL: Record<ReturnPeriod, string> = {
  "1m": "1m",
  "3m": "3m",
  "6m": "6m",
  ytd: "YTD",
  "1y": "1a",
};

function direction(n: number): "up" | "down" | "flat" {
  return n > 0 ? "up" : n < 0 ? "down" : "flat";
}

function ReturnsCard({ detail }: { detail: AssetDetail }) {
  return (
    <Card className="p-0">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Retorno por ventana
        </span>
        <dl className="grid grid-cols-5 gap-2">
          {RETURN_PERIODS.map((period) => {
            const value = detail.periodReturns[period];
            const color =
              value == null
                ? "text-muted-foreground"
                : value > 0
                  ? "text-success"
                  : value < 0
                    ? "text-destructive"
                    : "";
            return (
              <div key={period} className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{PERIOD_LABEL[period]}</dt>
                <dd className={`text-sm font-semibold tabular-nums ${color}`}>
                  {value == null
                    ? "—"
                    : `${value >= 0 ? "+" : ""}${formatPercent(value)}`}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </Card>
  );
}

export function AssetKpis({ detail }: { detail: AssetDetail }) {
  if (detail.state === "closed" && detail.realized) {
    const { realized } = detail;
    return (
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KPICard
          label="P&L realizado"
          value={formatEur(realized.totalRawEur)}
          delta={{
            value: "Resultado histórico de todas las ventas",
            direction: direction(realized.totalRawEur),
          }}
        />
        <KPICard
          label="Computable fiscal"
          value={formatEur(realized.totalComputableEur)}
          delta={{ value: "Tras antiaplicación y filtro de polvo" }}
        />
        <KPICard label="Ventas" value={String(realized.sales.length)} />
      </section>
    );
  }

  const pnl = detail.latentPnl;
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <KPICard
        label="Valor de mercado"
        value={detail.marketValueEur != null ? formatEur(detail.marketValueEur) : "—"}
      />
      <KPICard
        label="Plusvalía latente"
        value={pnl ? formatEur(pnl.eur) : "—"}
        delta={
          pnl
            ? {
                value: `${pnl.pct >= 0 ? "+" : ""}${formatPercent(pnl.pct)} sobre coste`,
                direction: direction(pnl.eur),
              }
            : undefined
        }
      />
      <KPICard
        label="Peso en cartera"
        value={detail.portfolioWeight != null ? formatPercent(detail.portfolioWeight) : "—"}
      />
      <KPICard
        label="Unidades"
        value={formatQuantity(detail.position?.quantity ?? 0, { maximumFractionDigits: 8 })}
      />
      <KPICard
        label="Coste medio"
        value={detail.averageCostEur != null ? formatEur(detail.averageCostEur) : "—"}
        delta={
          detail.position
            ? {
                value: (
                  <>
                    Coste total{" "}
                    <SensitiveValue>{formatEur(detail.position.totalCostEur)}</SensitiveValue>
                  </>
                ),
              }
            : undefined
        }
      />
      <ReturnsCard detail={detail} />
    </section>
  );
}
