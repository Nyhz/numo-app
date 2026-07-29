"use client";

import { Area, AreaChart, YAxis } from "recharts";

const EDGE_PADDING_RATIO = 0.08;
const MIN_EDGE_PADDING = 0.5;

/** `data` llega del servidor ya normalizado: índice de precio base 100,
 *  decimado a lo que un sparkline de 224px puede mostrar. */
export function PositionSparkline({ data, id }: { data: number[]; id: string }) {
  if (data.length < 2) {
    return <span className="text-muted-foreground">—</span>;
  }
  const series = data.map((marketIndex) => ({ marketIndex }));

  const stroke = "hsl(var(--primary))";
  const gradientId = `spark-${id}`;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const spread = max - min;
  const pad =
    spread === 0
      ? Math.max(Math.abs(max) * 0.005, MIN_EDGE_PADDING)
      : Math.max(spread * EDGE_PADDING_RATIO, MIN_EDGE_PADDING);
  const domain: [number, number] = [min - pad, max + pad];

  return (
    <div className="h-12 w-56">
      <AreaChart
        width={224}
        height={48}
        data={series}
        margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
      >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={stroke} stopOpacity={0.38} />
              <stop offset="95%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis hide domain={domain} />
          <Area
            type="monotone"
            dataKey="marketIndex"
            stroke={stroke}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
            activeDot={false}
          />
      </AreaChart>
    </div>
  );
}
