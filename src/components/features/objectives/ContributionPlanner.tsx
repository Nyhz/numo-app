"use client";

import * as React from "react";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { formatEur, formatPercent } from "@/src/lib/format";
import { resolveObjectiveColor } from "@/src/lib/objective-colors";
import type { ObjectiveBucket } from "@/src/server/objectives";

/** Single-shot strategy: the whole monthly contribution goes to ONE asset of
 *  the most-lagging tag (one order = one fee). The ranking is by EUR below
 *  target — what a contribution can actually close. */
export function ContributionPlanner({
  buckets,
  totalValuedEur,
}: {
  buckets: ObjectiveBucket[]; // tagged buckets, display order
  totalValuedEur: number;
}) {
  const [amount, setAmount] = React.useState("1200");
  const parsed = Number(amount.replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed > 0;

  const planReady = buckets.some((b) => (b.objective?.targetPct ?? 0) > 0);

  const ranked = [...buckets]
    .map((b) => ({ b, index: buckets.indexOf(b) }))
    .sort((x, y) => (y.b.driftEur ?? -Infinity) - (x.b.driftEur ?? -Infinity));
  const winner = ranked[0] ?? null;
  const winnerLagging = winner != null && (winner.b.driftEur ?? 0) > 0;

  // Post-contribution preview for the winner.
  let preview: { weightPct: number; remainingEur: number } | null = null;
  if (winner && valid) {
    const newTotal = totalValuedEur + parsed;
    const newValue = winner.b.valueEur + parsed;
    const targetPct = winner.b.objective!.targetPct;
    preview = {
      weightPct: newTotal > 0 ? (newValue / newTotal) * 100 : 0,
      remainingEur: (targetPct / 100) * newTotal - newValue,
    };
  }

  return (
    <Card title="Dónde aportar">
      {buckets.length === 0 || !planReady ? (
        <StatesBlock
          mode="empty"
          title="Plan sin pesos"
          description="Crea tags y reparte sus pesos arrastrando el gráfico para obtener la recomendación del mes."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {winner && (
            <div className="rounded-lg border border-border bg-accent/40 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {winnerLagging ? "Este mes, todo a" : "Nada rezagado — el menos pasado es"}
              </p>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: resolveObjectiveColor(
                      winner.b.objective!.color,
                      winner.index,
                    ),
                  }}
                />
                {winner.b.objective!.name}
              </p>
              {winner.b.driftEur != null && (
                <SensitiveValue
                  className={`text-sm tabular-nums ${winnerLagging ? "text-warning" : "text-muted-foreground"}`}
                >
                  {winner.b.driftEur > 0
                    ? `faltan ${formatEur(winner.b.driftEur)} para su objetivo`
                    : `${formatEur(-winner.b.driftEur)} por encima de su objetivo`}
                </SensitiveValue>
              )}
              {winner.b.assets.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 border-t border-border/60 pt-2">
                  {winner.b.assets.map((a) => (
                    <li key={a.assetId} className="flex items-center justify-between text-sm">
                      <span className="truncate">{a.symbol ?? a.name}</span>
                      <SensitiveValue className="text-xs text-muted-foreground tabular-nums">
                        {formatEur(a.valueEur)}
                      </SensitiveValue>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Aportación del mes (€)</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={50}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          {winner && preview && (
            <p className="text-xs text-muted-foreground">
              Tras aportar <SensitiveValue>{formatEur(parsed)}</SensitiveValue> a{" "}
              {winner.b.objective!.name} quedaría al{" "}
              <span className="tabular-nums">{formatPercent(preview.weightPct / 100)}</span>{" "}
              (objetivo {formatPercent(winner.b.objective!.targetPct / 100)})
              {preview.remainingEur > 1 ? (
                <>
                  {" "}
                  — aún faltarían{" "}
                  <SensitiveValue>{formatEur(preview.remainingEur)}</SensitiveValue>.
                </>
              ) : (
                <> — objetivo cubierto.</>
              )}
            </p>
          )}

          {ranked.length > 1 && (
            <ul className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
              {ranked.slice(1).map(({ b, index }) => (
                <li key={b.objective!.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span
                      aria-hidden
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor: resolveObjectiveColor(b.objective!.color, index),
                      }}
                    />
                    {b.objective!.name}
                  </span>
                  {b.driftEur != null && (
                    <SensitiveValue className="text-xs tabular-nums text-muted-foreground">
                      {b.driftEur > 0
                        ? `faltan ${formatEur(b.driftEur)}`
                        : `sobran ${formatEur(-b.driftEur)}`}
                    </SensitiveValue>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Una sola orden al mes = una sola comisión: todo al tag más rezagado en
            euros. El siguiente mes, el ranking se recalcula solo.
          </p>
        </div>
      )}
    </Card>
  );
}
