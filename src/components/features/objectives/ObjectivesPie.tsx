"use client";

import * as React from "react";

export type PieSlice = {
  id: string;
  label: string;
  color: string;
  /** Raw stored target (may not sum 100 — the pie normalises for display). */
  targetPct: number;
  /** Real weight of the bucket today, 0–100. */
  actualPct: number;
};

const SIZE = 300;
const C = SIZE / 2;
// Outer ring: target plan (draggable boundaries). Inner ring: reality.
const TARGET_R0 = 112;
const TARGET_R1 = 138;
const ACTUAL_R0 = 64;
const ACTUAL_R1 = 106;
const HANDLE_R = (TARGET_R0 + TARGET_R1) / 2;
const STEP = 1; // drag snaps to whole points — a plan in integers

function polar(r: number, pct: number): { x: number; y: number } {
  // pct 0..100 → clockwise from 12 o'clock.
  const rad = (pct / 100) * 2 * Math.PI;
  return { x: C + r * Math.sin(rad), y: C - r * Math.cos(rad) };
}

function ringSlicePath(r0: number, r1: number, fromPct: number, toPct: number): string {
  const span = Math.min(99.999, Math.max(0, toPct - fromPct));
  if (span <= 0) return "";
  const large = span > 50 ? 1 : 0;
  const a = polar(r1, fromPct);
  const b = polar(r1, fromPct + span);
  const c = polar(r0, fromPct + span);
  const d = polar(r0, fromPct);
  return [
    `M ${a.x.toFixed(2)} ${a.y.toFixed(2)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
    `L ${c.x.toFixed(2)} ${c.y.toFixed(2)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${d.x.toFixed(2)} ${d.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/** Displayed shares: normalise raw targets to 100; equal split when the plan
 *  is still empty (all tags at 0). */
function toShares(slices: PieSlice[]): number[] {
  const sum = slices.reduce((s, x) => s + x.targetPct, 0);
  if (sum <= 0) return slices.map(() => 100 / slices.length);
  return slices.map((x) => (x.targetPct / sum) * 100);
}

export function ObjectivesPie({
  slices,
  unassignedActualPct,
  onCommit,
  center,
}: {
  slices: PieSlice[];
  /** Weight of positions without a tag — drawn on the reality ring only. */
  unassignedActualPct: number;
  onCommit: (targets: Array<{ id: string; targetPct: number }>) => void;
  center?: React.ReactNode;
}) {
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = React.useState<number | null>(null);
  // Shares are DERIVED from props on every render; the override only exists
  // while dragging (and until the committed refresh lands), so a change in
  // the number of slices can never leave a stale array behind.
  const [override, setOverride] = React.useState<{ baseKey: string; shares: number[] } | null>(
    null,
  );
  const dirtyRef = React.useRef(false);

  const propsKey = JSON.stringify(slices.map((s) => [s.id, s.targetPct]));
  // Render-phase cleanup (React's derived-state pattern): once the server
  // returns different targets than the drag started from, drop the override.
  if (override && override.baseKey !== propsKey && dragging === null) {
    setOverride(null);
  }

  const shares =
    override && override.shares.length === slices.length
      ? override.shares
      : toShares(slices);

  if (slices.length === 0) return null;

  const cumulative: number[] = [];
  let acc = 0;
  for (const s of shares) {
    acc += s;
    cumulative.push(acc);
  }

  function pctFromPointer(e: React.PointerEvent): number {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIZE - C;
    const y = ((e.clientY - rect.top) / rect.height) * SIZE - C;
    const rad = Math.atan2(x, -y); // clockwise from 12 o'clock
    const pct = (rad / (2 * Math.PI)) * 100;
    return (pct + 100) % 100;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragging === null) return;
    const lo = dragging === 0 ? 0 : cumulative[dragging - 1];
    const hi = cumulative[dragging + 1] ?? 100;
    const raw = pctFromPointer(e);
    // Clamp into the corridor between the neighbouring boundaries.
    const pct = Math.min(hi, Math.max(lo, Math.round(raw / STEP) * STEP));
    const next = [...shares];
    next[dragging] = pct - lo;
    next[dragging + 1] = hi - pct;
    dirtyRef.current = true;
    setOverride({ baseKey: propsKey, shares: next });
  }

  function endDrag() {
    if (dragging === null) return;
    setDragging(null);
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    // Snap the BOUNDARIES to whole points and derive the shares from them:
    // integers that sum exactly 100, and any legacy half-point targets get
    // normalised on the first drag.
    const snapped: number[] = [];
    let prev = 0;
    let cum = 0;
    for (let i = 0; i < shares.length; i++) {
      cum += shares[i];
      const boundary = i === shares.length - 1 ? 100 : Math.max(prev, Math.round(cum));
      snapped.push(boundary - prev);
      prev = boundary;
    }
    onCommit(slices.map((s, i) => ({ id: s.id, targetPct: snapped[i] })));
  }

  // Reality ring: tagged buckets first, the untagged remainder in grey.
  const actualSegments: Array<{ color: string; from: number; to: number; muted?: boolean }> = [];
  let actualAcc = 0;
  for (const s of slices) {
    actualSegments.push({ color: s.color, from: actualAcc, to: actualAcc + s.actualPct });
    actualAcc += s.actualPct;
  }
  if (unassignedActualPct > 0) {
    actualSegments.push({
      color: "hsl(var(--muted-foreground))",
      from: actualAcc,
      to: actualAcc + unassignedActualPct,
      muted: true,
    });
  }

  return (
    <div className="relative mx-auto w-full max-w-[320px]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`w-full touch-none select-none ${dragging !== null ? "cursor-grabbing" : ""}`}
        role="img"
        aria-label="Plan de asignación: anillo exterior objetivo (arrastrable), anillo interior peso real"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        {/* Reality ring (inner). A card-coloured stroke separates adjacent
            slices so warm colours don't bleed into one muddy band. */}
        {actualSegments.map((seg, i) => (
          <path
            key={`actual-${i}`}
            d={ringSlicePath(ACTUAL_R0, ACTUAL_R1, seg.from, seg.to)}
            fill={seg.color}
            opacity={seg.muted ? 0.35 : 0.82}
            stroke="hsl(var(--card))"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {/* Target ring (outer, draggable) */}
        {slices.map((s, i) => {
          const from = i === 0 ? 0 : cumulative[i - 1];
          const to = cumulative[i];
          return (
            <path
              key={s.id}
              d={ringSlicePath(TARGET_R0, TARGET_R1, from, to)}
              fill={s.color}
              stroke="hsl(var(--card))"
              strokeWidth={2}
              strokeLinejoin="round"
            >
              <title>{`${s.label}: objetivo ${Math.round(shares[i])} % · real ${s.actualPct.toFixed(1)} %`}</title>
            </path>
          );
        })}
        {/* Share labels on slices wide enough to hold them */}
        {slices.map((s, i) => {
          if (shares[i] < 7) return null;
          const mid = (i === 0 ? 0 : cumulative[i - 1]) + shares[i] / 2;
          const p = polar(HANDLE_R, mid);
          return (
            <text
              key={`label-${s.id}`}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="central"
              className="pointer-events-none fill-background text-[11px] font-semibold"
            >
              {Math.round(shares[i])}%
            </text>
          );
        })}
        {/* Drag handles on the boundaries between consecutive slices */}
        {slices.slice(0, -1).map((s, i) => {
          const p = polar(HANDLE_R, cumulative[i]);
          return (
            <g
              key={`handle-${s.id}`}
              className={dragging === i ? "cursor-grabbing" : "cursor-grab"}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setDragging(i);
              }}
            >
              {/* generous invisible hit area + visible knob */}
              <circle cx={p.x} cy={p.y} r={16} fill="transparent" />
              <circle
                cx={p.x}
                cy={p.y}
                r={7}
                className="fill-background stroke-foreground"
                strokeWidth={2}
              />
            </g>
          );
        })}
      </svg>
      {center && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-[100px] text-center">{center}</div>
        </div>
      )}
    </div>
  );
}
