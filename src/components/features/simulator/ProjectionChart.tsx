"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatEurCompact } from "@/src/lib/format";

export type ProjectionPoint = {
  year: number;
  label: string;
  contributedEur: number;
  gainEur: number;
  valueEur: number;
  pessimisticEur: number;
  optimisticEur: number;
};

type TooltipEntry = { payload?: ProjectionPoint };
type ChartTooltipProps = { active?: boolean; payload?: TooltipEntry[] };

export function ProjectionChart({ points }: { points: ProjectionPoint[] }) {
  const renderTooltip = (props: ChartTooltipProps) => {
    const { active, payload } = props;
    const p = payload?.[0]?.payload;
    if (!active || !p) return null;
    return (
      <div className="rounded-md border border-border/70 bg-card/95 px-3 py-2 shadow-sm">
        <p className="text-xs text-muted-foreground">{p.label}</p>
        <p className="text-sm font-semibold text-foreground">
          Valor: <SensitiveValue>{formatEur(p.valueEur)}</SensitiveValue>
        </p>
        <p className="text-xs text-muted-foreground">
          Aportado: <SensitiveValue>{formatEur(p.contributedEur)}</SensitiveValue> · intereses{" "}
          <SensitiveValue>{formatEur(p.gainEur)}</SensitiveValue>
        </p>
        <p className="text-xs text-muted-foreground">
          Escenarios: <SensitiveValue>{formatEur(p.pessimisticEur)}</SensitiveValue> …{" "}
          <SensitiveValue>{formatEur(p.optimisticEur)}</SensitiveValue>
        </p>
      </div>
    );
  };

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={points}>
          <defs>
            <linearGradient id="simValueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.38} />
              <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="simContributedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.55} />
              <stop offset="95%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.18} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            strokeOpacity={0.45}
            vertical={false}
          />
          <XAxis
            dataKey="label"
            stroke="hsl(var(--muted-foreground))"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
            minTickGap={28}
          />
          <YAxis
            className="sensitive"
            stroke="hsl(var(--muted-foreground))"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
            tickFormatter={formatEurCompact}
            width={64}
            domain={["auto", "auto"]}
          />
          <Tooltip content={renderTooltip as never} />
          {/* Two overlapping areas (NOT stacked): the blue is the total value, so
              its top edge reads directly off the axis and matches the "Valor final"
              KPI. The grey "Aportado" sits in front; the blue visible above it is
              the accumulated gain. */}
          <Area
            type="monotone"
            dataKey="valueEur"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2}
            isAnimationActive={false}
            fill="url(#simValueFill)"
          />
          <Area
            type="monotone"
            dataKey="contributedEur"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1.5}
            isAnimationActive={false}
            fill="url(#simContributedFill)"
          />
          <Line
            type="monotone"
            dataKey="pessimisticEur"
            stroke="hsl(var(--chart-3))"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="optimisticEur"
            stroke="hsl(var(--chart-2))"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-chart-1" aria-hidden />
          Valor (escenario base)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-muted-foreground" aria-hidden />
          Aportado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-chart-2" aria-hidden />
          Optimista
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-chart-3" aria-hidden />
          Pesimista
        </span>
      </div>
    </div>
  );
}
