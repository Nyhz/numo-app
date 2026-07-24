"use client";

import { Badge } from "@/src/components/ui/Badge";
import { CollapsibleCard } from "@/src/components/ui/CollapsibleCard";
import { DataTable, type DataTableColumn } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { roundEur } from "@/src/lib/money";
import { nextPaymentAfter, type ScheduleRow } from "@/src/lib/mortgage";
import type { PropertySummary } from "@/src/server/realEstate";

export function AmortizationTable({ summary }: { summary: PropertySummary }) {
  if (summary.schedule.length === 0) return null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const current = nextPaymentAfter(summary.schedule, todayIso);

  const byYear = new Map<string, ScheduleRow[]>();
  for (const row of summary.schedule) {
    const year = row.date.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), row]);
  }

  const columns: DataTableColumn<ScheduleRow>[] = [
    {
      key: "date",
      header: "Fecha",
      cell: (r) => (
        <span className="flex items-center gap-2">
          {r.date}
          {r.kind === "early_repayment" ? <Badge variant="warning">amortización</Badge> : null}
          {current && r.date === current.date && r.kind === "payment" ? (
            <Badge>actual</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "payment",
      header: "Cuota",
      align: "right",
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {r.overridden ? (
            <Badge variant="neutral" title="Cuota fijada manualmente (recibo real)">
              ajustada
            </Badge>
          ) : null}
          <SensitiveValue>{formatEur(r.paymentEur)}</SensitiveValue>
        </span>
      ),
    },
    {
      key: "interest",
      header: "Interés",
      align: "right",
      cell: (r) => <SensitiveValue>{formatEur(r.interestEur)}</SensitiveValue>,
    },
    {
      key: "principal",
      header: "Capital",
      align: "right",
      cell: (r) => <SensitiveValue>{formatEur(r.principalEur)}</SensitiveValue>,
    },
    {
      key: "remaining",
      header: "Pendiente",
      align: "right",
      cell: (r) => <SensitiveValue>{formatEur(r.remainingEur)}</SensitiveValue>,
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold tracking-tight">Cuadro de amortización</h3>
      {[...byYear.entries()].map(([year, rows]) => {
        const interest = roundEur(rows.reduce((s, r) => s + r.interestEur, 0));
        const principal = roundEur(rows.reduce((s, r) => s + r.principalEur, 0));
        const isCurrentYear = current?.date.slice(0, 4) === year;
        return (
          <CollapsibleCard
            key={year}
            defaultOpen={isCurrentYear}
            title={
              <span className="flex items-center gap-2">
                {year}
                {isCurrentYear ? <Badge>en curso</Badge> : null}
              </span>
            }
            action={
              <span className="flex gap-6 text-xs text-muted-foreground tabular-nums">
                <span>
                  Interés <SensitiveValue>{formatEur(interest)}</SensitiveValue>
                </span>
                <span>
                  Capital <SensitiveValue>{formatEur(principal)}</SensitiveValue>
                </span>
                <span>
                  Pendiente{" "}
                  <SensitiveValue>{formatEur(rows[rows.length - 1].remainingEur)}</SensitiveValue>
                </span>
              </span>
            }
          >
            <DataTable columns={columns} rows={rows} getRowKey={(r) => `${r.index}`} />
          </CollapsibleCard>
        );
      })}
    </div>
  );
}
