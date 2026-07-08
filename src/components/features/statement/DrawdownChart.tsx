"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatPercent } from "@/src/lib/format";
import type { DrawdownPoint } from "@/src/lib/risk";

type ChartPoint = { dateIso: string; drawdownPct: number };

type TooltipEntry = { payload?: ChartPoint };
type ChartTooltipProps = { active?: boolean; payload?: TooltipEntry[] };

function formatLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
  });
}

function formatTooltipDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function DrawdownChart({ data }: { data: DrawdownPoint[] }) {
  const points: ChartPoint[] = data.map((p) => ({
    dateIso: p.date,
    drawdownPct: p.drawdown * 100,
  }));

  const renderTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (!active || !payload || payload.length === 0) return null;
    const p = payload[0]?.payload;
    if (!p) return null;
    return (
      <div className="rounded-md border border-border/70 bg-card/95 px-3 py-2 shadow-sm">
        <p className="text-xs text-muted-foreground">{formatTooltipDate(p.dateIso)}</p>
        <p className="text-sm font-semibold text-destructive">
          {formatPercent(p.drawdownPct / 100)}
        </p>
        <p className="text-xs text-muted-foreground">bajo el máximo previo</p>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={points}>
        <defs>
          <linearGradient id="drawdownFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.05} />
            <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          strokeOpacity={0.45}
          vertical={false}
        />
        {/* dataKey único por punto: con etiquetas «dd MMM» repetidas el tooltip
            de eje resolvía el primer punto coincidente, no el apuntado. */}
        <XAxis
          dataKey="dateIso"
          tickFormatter={formatLabel}
          stroke="hsl(var(--muted-foreground))"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          minTickGap={48}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `${Math.round(v)}%`}
          width={40}
          domain={["dataMin", 0]}
        />
        <Tooltip content={renderTooltip as never} />
        <Area
          type="monotone"
          dataKey="drawdownPct"
          stroke="hsl(var(--destructive))"
          strokeWidth={1.5}
          isAnimationActive={false}
          fill="url(#drawdownFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
