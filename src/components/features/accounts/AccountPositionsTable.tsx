import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { formatEur, formatPercent, formatQuantity } from "@/src/lib/format";
import type { PositionRow } from "@/src/server/positions";

export function AccountPositionsTable({ rows }: { rows: PositionRow[] }) {
  if (rows.length === 0) {
    return (
      <Card title="Posiciones">
        <StatesBlock
          mode="empty"
          title="Sin posiciones"
          description="Esta cuenta no tiene posiciones abiertas."
        />
      </Card>
    );
  }

  return (
    <Card title="Posiciones">
      <DataTable<PositionRow>
        rows={rows}
        getRowKey={(r) => r.position.id}
        columns={[
          {
            key: "asset",
            header: "Activo",
            cell: (r) => (
              <span className="flex items-center gap-1.5">
                <span>{r.asset.symbol ?? r.asset.name}</span>
                <Badge className="px-1.5 py-0 text-[11px] tabular-nums">
                  {formatQuantity(r.position.quantity, {
                    maximumFractionDigits: 8,
                  })}
                </Badge>
              </span>
            ),
          },
          {
            key: "cost",
            header: "Comprar en",
            align: "right",
            cell: (r) => (
              <div className="flex flex-col items-end leading-tight">
                <SensitiveValue className="tabular-nums">
                  {formatEur(r.position.totalCostEur)}
                </SensitiveValue>
                <SensitiveValue className="text-xs tabular-nums text-muted-foreground">
                  {formatEur(r.position.averageCost, { maximumFractionDigits: 4 })}
                </SensitiveValue>
              </div>
            ),
          },
          {
            key: "value",
            header: "Posición",
            align: "right",
            cell: (r) =>
              r.valuationEur == null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <div className="flex flex-col items-end leading-tight">
                  <SensitiveValue className="tabular-nums">
                    {formatEur(r.valuationEur)}
                  </SensitiveValue>
                  <SensitiveValue className="text-xs tabular-nums text-muted-foreground">
                    {formatEur(r.valuationEur / r.position.quantity, {
                      maximumFractionDigits: 4,
                    })}
                  </SensitiveValue>
                </div>
              ),
          },
          {
            key: "pnl",
            header: "Plusvalía",
            align: "right",
            cell: (r) => {
              if (r.valuationEur == null) {
                return <span className="text-muted-foreground">—</span>;
              }
              // Stored cost pool, not quantity × pre-rounded average — keeps
              // this table in lockstep with overview and statement.
              const pnl = r.valuationEur - r.position.totalCostEur;
              const color =
                pnl > 0 ? "text-success" : pnl < 0 ? "text-destructive" : "";
              const pct =
                r.position.totalCostEur > 0 ? pnl / r.position.totalCostEur : null;
              return (
                <div className={`flex flex-col items-end leading-tight ${color}`}>
                  <SensitiveValue className="tabular-nums">
                    {formatEur(pnl)}
                  </SensitiveValue>
                  {pct != null && (
                    <span className="text-xs tabular-nums opacity-80">
                      {`${pct >= 0 ? "+" : ""}${formatPercent(pct)}`}
                    </span>
                  )}
                </div>
              );
            },
          },
        ]}
      />
    </Card>
  );
}
