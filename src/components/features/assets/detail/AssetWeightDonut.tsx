"use client";

import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { sectorColor, sectorLabel } from "@/src/lib/sectors";
import { regionColor, regionLabel } from "@/src/lib/countries";
import type { AssetWeightSlice } from "@/src/server/sectors";

type TooltipEntry = { payload?: AssetWeightSlice };
type ChartTooltipProps = { active?: boolean; payload?: TooltipEntry[] };

/** Mini-donut de composición del propio activo (pesos del proveedor, no
 *  valores de cartera — no es dato sensible). `kind` resuelve etiqueta y
 *  color con los mismos mapas que los donuts del Extracto. */
export function AssetWeightDonut({
  slices,
  kind,
}: {
  slices: AssetWeightSlice[];
  kind: "sector" | "region";
}) {
  const label = kind === "sector" ? sectorLabel : regionLabel;
  const color = kind === "sector" ? sectorColor : regionColor;

  const renderTooltip = (props: ChartTooltipProps) => {
    const p = props.payload?.[0]?.payload;
    if (!props.active || !p) return null;
    return (
      <div className="rounded-md border border-border/70 bg-card/95 px-3 py-2 shadow-sm">
        <p className="text-xs text-muted-foreground">{label(p.label)}</p>
        <p className="text-sm font-semibold text-foreground">
          {(p.weight * 100).toFixed(1)}%
        </p>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="h-40">
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Tooltip
              content={renderTooltip as never}
              position={{ x: 0, y: 0 }}
              isAnimationActive={false}
              wrapperStyle={{ zIndex: 10, outline: "none" }}
            />
            <Pie
              data={slices.map((slice) => ({ ...slice, fill: color(slice.label) }))}
              dataKey="weight"
              nameKey="label"
              innerRadius={48}
              outerRadius={68}
              paddingAngle={slices.length > 1 ? 1.5 : 0}
              strokeWidth={0}
              isAnimationActive={false}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-col gap-1.5">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: color(slice.label) }}
            />
            <span className="truncate">{label(slice.label)}</span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {(slice.weight * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
