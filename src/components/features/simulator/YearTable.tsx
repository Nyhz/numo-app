import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { YearPoint } from "@/src/lib/simulator";

export function YearTable({
  rows,
  baseYear,
}: {
  rows: YearPoint[];
  baseYear: number;
}) {
  return (
    <DataTable<YearPoint>
      rows={rows}
      getRowKey={(r) => String(r.year)}
      columns={[
        {
          key: "year",
          header: "Año",
          cell: (r) => (
            <span className="tabular-nums">
              {baseYear + r.year}
              <span className="ml-1 text-xs text-muted-foreground">+{r.year}</span>
            </span>
          ),
        },
        {
          key: "contributed",
          header: "Aportado",
          align: "right",
          cell: (r) => (
            <SensitiveValue className="text-sm">{formatEur(r.contributedEur)}</SensitiveValue>
          ),
        },
        {
          key: "value",
          header: "Valor",
          align: "right",
          cell: (r) => (
            <SensitiveValue className="text-sm font-medium">
              {formatEur(r.valueEur)}
            </SensitiveValue>
          ),
        },
        {
          key: "gain",
          header: "Intereses",
          align: "right",
          cell: (r) => (
            <SensitiveValue className="text-sm text-success">
              {formatEur(r.gainEur)}
            </SensitiveValue>
          ),
        },
        {
          key: "real",
          header: "Valor real (hoy)",
          align: "right",
          cell: (r) => (
            <SensitiveValue className="text-sm text-muted-foreground">
              {formatEur(r.realValueEur)}
            </SensitiveValue>
          ),
        },
      ]}
    />
  );
}
