"use client";

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatEurCompact, formatQuantity } from "@/src/lib/format";
import type { AssetPricePoint, AssetTradeMarker } from "@/src/server/assetDetail";

type Point = {
  label: string;
  dateIso: string;
  unitPriceEur: number;
  markers?: AssetTradeMarker[];
};

type TooltipEntry = { payload?: Point };
type ChartTooltipProps = { active?: boolean; payload?: TooltipEntry[] };

function formatLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function formatTooltipDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** Triángulo ▲ (compra, success) / ▼ (venta, destructive) sobre la curva.
 *  La forma redunda el color — identidad legible también sin visión de color. */
function MarkerDot({
  cx,
  cy,
  markers,
}: {
  cx: number;
  cy: number;
  markers: AssetTradeMarker[];
}) {
  const size = 5.5;
  return (
    <g>
      {markers.map((m, i) => {
        const up = m.type === "buy";
        // Compra debajo de la curva apuntando arriba; venta encima apuntando
        // abajo. Con ambos en el mismo punto, cada uno queda en su lado.
        const baseY = up ? cy + 9 : cy - 9;
        const tipY = up ? baseY - size * 1.6 : baseY + size * 1.6;
        return (
          <polygon
            key={`${m.type}-${i}`}
            points={`${cx - size},${baseY} ${cx + size},${baseY} ${cx},${tipY}`}
            fill={up ? "hsl(var(--success))" : "hsl(var(--destructive))"}
            stroke="hsl(var(--card))"
            strokeWidth={1}
          />
        );
      })}
    </g>
  );
}

type DotProps = { cx?: number; cy?: number; payload?: Point; index?: number };

export function AssetPriceChart({
  data,
  averageCostEur,
}: {
  data: AssetPricePoint[];
  averageCostEur: number | null;
}) {
  const points: Point[] = useMemo(
    () =>
      data.map((p) => ({
        label: formatLabel(p.date),
        dateIso: p.date,
        unitPriceEur: p.unitPriceEur,
        markers: p.markers,
      })),
    [data],
  );
  const hasBuys = useMemo(
    () => points.some((p) => p.markers?.some((m) => m.type === "buy")),
    [points],
  );
  const hasSells = useMemo(
    () => points.some((p) => p.markers?.some((m) => m.type === "sell")),
    [points],
  );

  const renderDot = (props: DotProps) => {
    const markers = props.payload?.markers;
    if (!markers || markers.length === 0 || props.cx == null || props.cy == null) {
      return <g key={`d-${props.index}`} />;
    }
    return <MarkerDot key={`d-${props.index}`} cx={props.cx} cy={props.cy} markers={markers} />;
  };

  const renderTooltip = (props: ChartTooltipProps) => {
    const { active, payload } = props;
    const p = payload?.[0]?.payload;
    if (!active || !p) return null;
    return (
      <div className="rounded-md border border-border/70 bg-card/95 px-3 py-2 shadow-sm">
        <p className="text-xs text-muted-foreground">{formatTooltipDate(p.dateIso)}</p>
        <p className="text-sm font-semibold text-foreground">
          Precio: <SensitiveValue>{formatEur(p.unitPriceEur)}</SensitiveValue>
        </p>
        {p.markers?.map((m, i) => (
          <p
            key={i}
            className={`text-xs ${m.type === "buy" ? "text-success" : "text-destructive"}`}
          >
            {m.type === "buy" ? "Compra" : "Venta"} de{" "}
            <SensitiveValue>{formatQuantity(m.quantity, { maximumFractionDigits: 8 })}</SensitiveValue>{" "}
            uds a <SensitiveValue>{formatEur(m.unitPriceEur)}</SensitiveValue>
            {!m.exact && <span className="text-muted-foreground"> (fecha aproximada)</span>}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={points}>
          <defs>
            <linearGradient id="assetPriceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
              <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
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
            minTickGap={32}
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
          {averageCostEur != null && (
            <ReferenceLine
              y={averageCostEur}
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              ifOverflow="extendDomain"
              // Solo el texto — la cifra la dan el tooltip y los KPIs, ambos
              // bajo SensitiveValue; una label numérica aquí rompería el modo
              // sensible.
              label={{
                value: "Coste medio",
                position: "insideBottomLeft",
                fontSize: 11,
                fill: "hsl(var(--muted-foreground))",
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="unitPriceEur"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2}
            isAnimationActive={false}
            fill="url(#assetPriceFill)"
            dot={renderDot as never}
            activeDot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex items-center gap-5 px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-chart-1" aria-hidden />
          Precio (EUR)
        </span>
        {averageCostEur != null && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-muted-foreground" aria-hidden />
            Coste medio
          </span>
        )}
        {hasBuys && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="text-success">▲</span>
            Compra
          </span>
        )}
        {hasSells && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="text-destructive">▼</span>
            Venta
          </span>
        )}
      </div>
    </div>
  );
}
