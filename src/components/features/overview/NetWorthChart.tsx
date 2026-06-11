"use client";

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatPercent } from "@/src/lib/format";
import type { NetWorthPoint } from "@/src/server/overview";
import type { BenchmarkSeries } from "@/src/server/benchmarks";

type TooltipEntry = { value?: number | string; payload?: Point };
type ChartTooltipProps = {
  active?: boolean;
  payload?: TooltipEntry[];
};

type Point = {
  label: string;
  marketIndex: number;
  totalValue: number;
  dateIso: string;
} & Record<`bench_${string}`, number | undefined>;

const BASELINE = 100;
const CHART_EDGE_PADDING_RATIO = 0.02;
const MIN_CHART_EDGE_PADDING = 0.05;

function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const fraction = rawStep / 10 ** exponent;
  let niceFraction = 1;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * 10 ** exponent;
}

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

function formatIndexPercent(index: number): string {
  const pct = index - BASELINE;
  return `${pct >= 0 ? "+" : ""}${formatPercent(pct / 100)}`;
}

export function NetWorthChart({
  data,
  benchmarks = [],
}: {
  data: NetWorthPoint[];
  benchmarks?: BenchmarkSeries[];
}) {
  const points: Point[] = useMemo(
    () =>
      data.map((p) => {
        const point: Point = {
          label: formatLabel(p.date),
          dateIso: p.date,
          totalValue: p.valueEur,
          // Time-weighted return index from the server: 100 = flat, deposits
          // and withdrawals do not move the line — only market performance does.
          marketIndex: p.performanceIndex,
        };
        for (const b of benchmarks) {
          point[`bench_${b.key}`] = b.indexByDate[p.date];
        }
        return point;
      }),
    [data, benchmarks],
  );

  const yAxis = useMemo<{ domain: [number, number]; ticks: number[] }>(() => {
    const values = points
      .flatMap((p) => [
        p.marketIndex,
        ...benchmarks.map((b) => p[`bench_${b.key}`]),
      ])
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (values.length === 0) return { domain: [0, 1], ticks: [0, 1] };

    const min = Math.min(...values);
    const max = Math.max(...values);

    let minBound = min;
    let maxBound = max;
    if (min === max) {
      const basePadding = Math.max(Math.abs(min) * 0.0025, MIN_CHART_EDGE_PADDING);
      minBound = min - basePadding;
      maxBound = max + basePadding;
    } else {
      const spread = max - min;
      const edgePadding = Math.max(
        spread * CHART_EDGE_PADDING_RATIO,
        MIN_CHART_EDGE_PADDING,
      );
      minBound = min - edgePadding;
      maxBound = max + edgePadding;
    }

    const visibleRange = Math.max(maxBound - minBound, 1e-6);
    const step = niceStep(visibleRange / 5);
    const firstTick = Math.ceil(minBound / step) * step;
    const lastTick = Math.floor(maxBound / step) * step;
    const ticks: number[] = [];
    if (firstTick <= lastTick) {
      for (let v = firstTick; v <= lastTick + step * 0.01; v += step) {
        ticks.push(v);
      }
    }
    if (ticks.length < 2) ticks.push(Math.round(minBound), Math.round(maxBound));
    return { domain: [minBound, maxBound], ticks };
  }, [points, benchmarks]);

  const formatYAxisTick = (value: number) =>
    `${Math.round(value - BASELINE)}%`;

  const renderTooltip = (props: ChartTooltipProps) => {
    const { active, payload } = props;
    if (!active || !payload || payload.length === 0) return null;
    const p = payload[0]?.payload;
    if (!p || !Number.isFinite(p.marketIndex)) return null;
    return (
      <div className="rounded-md border border-border/70 bg-card/95 px-3 py-2 shadow-sm">
        <p className="text-xs text-muted-foreground">
          {formatTooltipDate(p.dateIso)}
        </p>
        <p className="text-sm font-semibold text-foreground">
          <SensitiveValue>{formatEur(p.totalValue)}</SensitiveValue>
        </p>
        <p className="text-xs text-muted-foreground">
          ({formatIndexPercent(p.marketIndex)})
        </p>
        {benchmarks.map((b) => {
          const v = p[`bench_${b.key}`];
          if (v == null || !Number.isFinite(v)) return null;
          return (
            <p key={b.key} className="mt-0.5 flex items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: `hsl(var(${b.colorVar}))` }}
              />
              <span className="text-muted-foreground">{b.label}</span>
              <span className="tabular-nums text-foreground">
                {formatIndexPercent(v)}
              </span>
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="w-full px-5 pb-5">
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={points}>
          <defs>
            <linearGradient id="portfolioPerfFill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="hsl(var(--primary))"
                stopOpacity={0.38}
              />
              <stop
                offset="95%"
                stopColor="hsl(var(--primary))"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            strokeOpacity={0.45}
            vertical={false}
          />
          <ReferenceLine
            y={BASELINE}
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity={0.55}
            strokeDasharray="4 4"
          />
          <XAxis
            dataKey="label"
            stroke="hsl(var(--muted-foreground))"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
            minTickGap={32}
          />
          <YAxis
            domain={yAxis.domain}
            ticks={yAxis.ticks}
            stroke="hsl(var(--muted-foreground))"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
            tickFormatter={formatYAxisTick}
            width={56}
          />
          <Tooltip content={renderTooltip as never} />
          <Area
            type="monotone"
            dataKey="marketIndex"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            isAnimationActive={false}
            fill="url(#portfolioPerfFill)"
          />
          {benchmarks.map((b) => (
            <Line
              key={b.key}
              type="monotone"
              dataKey={`bench_${b.key}`}
              stroke={`hsl(var(${b.colorVar}))`}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
