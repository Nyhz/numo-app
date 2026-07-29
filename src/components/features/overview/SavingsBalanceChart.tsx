"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatEurCompact } from "@/src/lib/format";
import type { SavingsBalancePoint } from "@/src/server/savings";

type Point = { dateIso: string; balanceEur: number };

function formatLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
  });
}

function formatTooltipDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function SavingsBalanceChart({ data }: { data: SavingsBalancePoint[] }) {
  const points: Point[] = useMemo(
    () =>
      data.map((p) => ({
        dateIso: p.date,
        balanceEur: Math.round(p.balanceEur * 100) / 100,
      })),
    [data],
  );

  const values = points.map((p) => p.balanceEur);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const pad = Math.max((max - min) * 0.08, 0.5);
  const domain: [number, number] = [Math.max(0, min - pad), max + pad];

  const stroke = "hsl(var(--primary))";

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <defs>
            <linearGradient id="savingsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="95%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="2 4"
            stroke="hsl(var(--border))"
            strokeOpacity={0.4}
            vertical={false}
          />
          {/* Clave única (ISO) — un label "17 jul" repetido en dos años hace
              que el tooltip salte al primer duplicado. */}
          <XAxis
            dataKey="dateIso"
            tickFormatter={formatLabel}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            className="sensitive"
            domain={domain}
            tickFormatter={(v: number) => formatEurCompact(v)}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip
            cursor={{ stroke: "hsl(var(--border))" }}
            content={(props) => {
              if (!props.active || !props.payload?.length) return null;
              const p = props.payload[0]?.payload as Point | undefined;
              if (!p) return null;
              return (
                <div className="rounded-md border border-border bg-background/90 px-3 py-2 text-xs shadow-sm">
                  <div className="text-muted-foreground">
                    {formatTooltipDate(p.dateIso)}
                  </div>
                  <SensitiveValue as="div" className="font-medium">
                    {formatEur(p.balanceEur)}
                  </SensitiveValue>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="balanceEur"
            stroke={stroke}
            strokeWidth={1.5}
            fill="url(#savingsFill)"
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
