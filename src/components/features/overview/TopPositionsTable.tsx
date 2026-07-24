import Link from "next/link";
import { AssetLogo } from "@/src/components/ui/AssetLogo";
import { AssetTypeStripe } from "@/src/components/ui/AssetTypeBadge";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { formatEur, formatPercent, formatQuantity } from "@/src/lib/format";
import type { TopPositionRow } from "@/src/server/overview";
import { PositionSparkline } from "./PositionSparkline";

function formatUnit(value: number | null): string {
  if (value == null) return "—";
  return formatEur(value, { maximumFractionDigits: 4 });
}

export function TopPositionsTable({ rows }: { rows: TopPositionRow[] }) {
  if (rows.length === 0) {
    return (
      <Card title="Posiciones">
        <StatesBlock
          mode="empty"
          title="Sin posiciones"
          description="No hay posiciones abiertas con los filtros seleccionados."
        />
      </Card>
    );
  }

  return (
    <Card title="Posiciones">
      <DataTable<TopPositionRow>
        rows={rows}
        getRowKey={(r) => r.position.position.id}
        columns={[
          {
            key: "asset",
            header: "Activo",
            cell: (r) => {
              const a = r.position.asset;
              const symbol = a.symbol ?? a.providerSymbol ?? "";
              return (
                <Link
                  href={`/assets/${a.id}`}
                  className="flex items-stretch gap-3 hover:underline"
                >
                  <AssetTypeStripe type={a.assetType} />
                  <div className="flex items-center">
                    <AssetLogo name={a.name} logoUrl={a.logoUrl} size={24} />
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="font-medium">{a.name}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {symbol}
                      </span>
                      <Badge className="px-1.5 py-0 text-[11px] tabular-nums">
                        {formatQuantity(r.position.position.quantity, {
                          maximumFractionDigits: 8,
                        })}
                      </Badge>
                    </span>
                  </div>
                </Link>
              );
            },
          },
          {
            key: "cost",
            header: "Comprar en",
            align: "right",
            cell: (r) => (
              <div className="flex flex-col items-end leading-tight">
                <SensitiveValue className="tabular-nums">
                  {formatEur(r.position.position.totalCostEur)}
                </SensitiveValue>
                <SensitiveValue className="text-xs tabular-nums text-muted-foreground">
                  {formatUnit(r.averageCostEur)}
                </SensitiveValue>
              </div>
            ),
          },
          {
            key: "value",
            header: "Posición",
            align: "right",
            cell: (r) => (
              <div className="flex flex-col items-end leading-tight">
                <SensitiveValue className="tabular-nums">
                  {formatEur(r.position.marketOrCostEur)}
                </SensitiveValue>
                {r.position.valuedAtCost ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    a coste
                  </span>
                ) : (
                  <SensitiveValue className="text-xs tabular-nums text-muted-foreground">
                    {formatUnit(r.unitPriceEur)}
                  </SensitiveValue>
                )}
              </div>
            ),
          },
          {
            key: "pnl",
            header: "Plusvalía",
            align: "right",
            cell: (r) => {
              if (r.pnlEur == null) {
                return <span className="text-muted-foreground">—</span>;
              }
              const color =
                r.pnlEur > 0
                  ? "text-success"
                  : r.pnlEur < 0
                    ? "text-destructive"
                    : "";
              const pctLabel =
                r.pnlPct == null
                  ? null
                  : `${r.pnlPct >= 0 ? "+" : ""}${formatPercent(r.pnlPct)}`;
              return (
                <div className={`flex flex-col items-end leading-tight ${color}`}>
                  <SensitiveValue className="tabular-nums">
                    {formatEur(r.pnlEur)}
                  </SensitiveValue>
                  {pctLabel && (
                    <span className="text-xs tabular-nums opacity-80">
                      {pctLabel}
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            key: "graph",
            header: "Gráfica",
            align: "right",
            className: "w-[260px]",
            cell: (r) => (
              <div className="flex justify-end">
                <PositionSparkline
                  id={r.position.position.id}
                  data={r.sparkline}
                />
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}
