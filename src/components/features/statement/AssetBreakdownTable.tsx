import { AssetLogo } from "@/src/components/ui/AssetLogo";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatPercent, formatQuantity } from "@/src/lib/format";
import { assetTypeLabel } from "@/src/lib/labels";
import type { StatementAssetLine, StatementGroup } from "@/src/server/statement";
import { RETURN_PERIODS, type PeriodReturns, type ReturnPeriod } from "@/src/server/returns";

const PERIOD_LABEL: Record<ReturnPeriod, string> = {
  "1m": "1m",
  "3m": "3m",
  "6m": "6m",
  ytd: "YTD",
  "1y": "1a",
};

function ReturnCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  const color = value > 0 ? "text-success" : value < 0 ? "text-destructive" : "";
  return (
    <span className={`tabular-nums text-xs ${color}`}>
      {value >= 0 ? "+" : ""}
      {formatPercent(value)}
    </span>
  );
}

export function AssetBreakdownTable({
  groups,
  returnsByAsset,
  pricesAsOf,
}: {
  groups: StatementGroup[];
  returnsByAsset: Record<string, PeriodReturns>;
  pricesAsOf: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.assetType} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {assetTypeLabel(group.assetType)}
          </h3>
          <DataTable<StatementAssetLine>
            rows={group.lines}
            getRowKey={(l) => l.assetId}
            // table-fixed + anchos por columna: las cuatro tablas apiladas
            // comparten geometría — sin él, cada grupo reparte el ancho según
            // sus nombres y las columnas quedan desalineadas entre tipos.
            tableClassName="table-fixed"
            columns={[
              {
                key: "asset",
                header: "Activo",
                cell: (l) => (
                  <span className="flex min-w-0 items-center gap-2">
                    <AssetLogo name={l.name} logoUrl={l.logoUrl} size={20} />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate font-medium">{l.name}</span>
                      {l.symbol && (
                        <span className="truncate text-xs text-muted-foreground tabular-nums">
                          {l.symbol}
                        </span>
                      )}
                    </span>
                    {l.valuationDate && pricesAsOf && l.valuationDate < pricesAsOf && (
                      <span
                        title={`Último precio: ${l.valuationDate}`}
                        className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                      />
                    )}
                  </span>
                ),
              },
              {
                key: "quantity",
                header: "Cant.",
                align: "right",
                className: "w-[7%]",
                cell: (l) => (
                  <span className="tabular-nums text-xs">
                    {formatQuantity(l.quantity, { maximumFractionDigits: 8 })}
                  </span>
                ),
              },
              {
                key: "price",
                header: "Precio",
                align: "right",
                className: "w-[8%]",
                cell: (l) =>
                  l.unitPriceEur != null ? (
                    <SensitiveValue className="tabular-nums text-xs">
                      {formatEur(l.unitPriceEur)}
                    </SensitiveValue>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  ),
              },
              {
                key: "value",
                header: "Valor",
                align: "right",
                className: "w-[10%]",
                cell: (l) => (
                  <SensitiveValue className="tabular-nums">
                    {formatEur(l.marketValueEur ?? l.costEur)}
                  </SensitiveValue>
                ),
              },
              {
                key: "pnl",
                header: "Plusvalía",
                align: "right",
                className: "w-[10%]",
                cell: (l) => {
                  if (l.valuedAtCost || l.pnlEur == null) {
                    return <span className="text-muted-foreground">—</span>;
                  }
                  const color =
                    l.pnlEur > 0 ? "text-success" : l.pnlEur < 0 ? "text-destructive" : "";
                  return (
                    <div className={`flex flex-col items-end leading-tight ${color}`}>
                      <SensitiveValue className="tabular-nums">
                        {formatEur(l.pnlEur)}
                      </SensitiveValue>
                      {l.pnlPct != null && (
                        <span className="text-xs tabular-nums opacity-80">
                          {l.pnlPct >= 0 ? "+" : ""}
                          {formatPercent(l.pnlPct)}
                        </span>
                      )}
                    </div>
                  );
                },
              },
              {
                key: "weight",
                header: "Peso",
                align: "right",
                className: "w-[7%]",
                cell: (l) =>
                  l.weight != null ? (
                    <span className="tabular-nums text-xs">{formatPercent(l.weight)}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  ),
              },
              ...RETURN_PERIODS.map((period) => ({
                key: `ret_${period}`,
                header: PERIOD_LABEL[period],
                align: "right" as const,
                className: "w-[6.5%]",
                cell: (l: StatementAssetLine) => (
                  <ReturnCell value={returnsByAsset[l.assetId]?.[period] ?? null} />
                ),
              })),
            ]}
          />
        </div>
      ))}
    </div>
  );
}
