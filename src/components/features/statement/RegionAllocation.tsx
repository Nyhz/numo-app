"use client";

import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { regionColor, regionLabel } from "@/src/lib/countries";

export type RegionSlice = {
  region: string;
  valueEur: number;
  weight: number;
};

type TooltipEntry = { payload?: RegionSlice };
type ChartTooltipProps = { active?: boolean; payload?: TooltipEntry[] };

/** Geographic composition donut, grouped by region. Stacked layout (donut over
 *  a single-column legend) so it fits the narrow statement grid column,
 *  mirroring `AllocationDonut`. */
export function RegionAllocation({
  slices,
  classifiedEur,
}: {
  slices: RegionSlice[];
  classifiedEur: number;
}) {
  const renderTooltip = (props: ChartTooltipProps) => {
    const p = props.payload?.[0]?.payload;
    if (!props.active || !p) return null;
    return (
      <div className="rounded-md border border-border/70 bg-card/95 px-3 py-2 shadow-sm">
        <p className="text-xs text-muted-foreground">{regionLabel(p.region)}</p>
        <p className="text-sm font-semibold text-foreground">
          <SensitiveValue>{formatEur(p.valueEur)}</SensitiveValue>
        </p>
        <p className="text-xs text-muted-foreground">
          {(p.weight * 100).toFixed(1)}% de lo clasificado
        </p>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-56">
        <ResponsiveContainer width="100%" height={224}>
          <PieChart>
            <Tooltip
              content={renderTooltip as never}
              // Pin to the top-left corner — outside the donut ring, so it
              // never drifts over the centred total on hover.
              position={{ x: 0, y: 0 }}
              isAnimationActive={false}
              wrapperStyle={{ zIndex: 10, outline: "none" }}
            />
            <Pie
              data={slices.map((slice) => ({
                ...slice,
                fill: regionColor(slice.region),
              }))}
              dataKey="valueEur"
              nameKey="region"
              innerRadius={68}
              outerRadius={96}
              paddingAngle={slices.length > 1 ? 1.5 : 0}
              strokeWidth={0}
              isAnimationActive={false}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Clasificado
          </span>
          <SensitiveValue className="text-lg font-semibold tracking-tight">
            {formatEur(classifiedEur)}
          </SensitiveValue>
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {slices.map((slice) => (
          <li key={slice.region} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: regionColor(slice.region) }}
            />
            <span className="truncate">{regionLabel(slice.region)}</span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {(slice.weight * 100).toFixed(1)}%
            </span>
            <SensitiveValue className="w-24 text-right text-sm font-medium tabular-nums">
              {formatEur(slice.valueEur)}
            </SensitiveValue>
          </li>
        ))}
      </ul>
    </div>
  );
}
