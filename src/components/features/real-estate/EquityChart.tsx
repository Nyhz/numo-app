"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatEurCompact } from "@/src/lib/format";
import { currentValueAt } from "@/src/lib/mortgage";
import type { PropertySummary } from "@/src/server/realEstate";

type Point = {
  date: string;
  pendienteEur: number;
  equityPastEur: number | null;
  equityFutureEur: number | null;
};

export function EquityChart({ summary }: { summary: PropertySummary }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const valuations = summary.valuations.map((v) => ({
    valuationDate: v.valuationDate,
    valueEur: v.valueEur,
  }));

  const points: Point[] = React.useMemo(() => {
    const base: { date: string; pendienteEur: number }[] = [
      {
        date: summary.property.purchaseDate,
        pendienteEur: summary.mortgage?.principalEur ?? 0,
      },
      ...summary.schedule.map((r) => ({ date: r.date, pendienteEur: r.remainingEur })),
    ];
    return base.map(({ date, pendienteEur }) => {
      const { valueEur } = currentValueAt(summary.property.purchasePriceEur, valuations, date);
      const equity = valueEur - pendienteEur;
      return {
        date,
        pendienteEur,
        equityPastEur: date <= todayIso ? equity : null,
        // Solapa un punto para que las dos series enlacen sin hueco.
        equityFutureEur: date >= todayIso || date === base.at(-1)?.date ? equity : null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  if (summary.schedule.length === 0) return null;

  return (
    <Card title="Evolución — equity y capital pendiente">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              strokeOpacity={0.45}
              vertical={false}
            />
            <XAxis
              dataKey="date"
              stroke="hsl(var(--muted-foreground))"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
              tickFormatter={(d: string) => d.slice(0, 4)}
              minTickGap={48}
            />
            <YAxis
              className="sensitive"
              stroke="hsl(var(--muted-foreground))"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
              tickFormatter={formatEurCompact}
              width={64}
              domain={[0, "auto"]}
            />
            <Tooltip content={renderTooltip as never} />
            <Line
              type="monotone"
              dataKey="pendienteEur"
              stroke="hsl(var(--chart-2))"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="equityPastEur"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="equityFutureEur"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Equity en sólido (pasado) y discontinuo (proyección); capital pendiente en la serie fina.
        Las valoraciones manuales aparecen como escalones.
      </p>
    </Card>
  );
}

type TooltipPayload = { payload?: Point };

function renderTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const equity = p.equityPastEur ?? p.equityFutureEur;
  return (
    <div className="rounded-md border border-border/70 bg-card/95 px-3 py-2 text-xs shadow-sm">
      <div className="font-medium">{p.date}</div>
      {equity != null ? (
        <div>
          Equity: <SensitiveValue>{formatEur(equity)}</SensitiveValue>
        </div>
      ) : null}
      <div>
        Pendiente: <SensitiveValue>{formatEur(p.pendienteEur)}</SensitiveValue>
      </div>
    </div>
  );
}
