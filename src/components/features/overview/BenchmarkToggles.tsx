"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { activateBenchmark } from "@/src/actions/benchmarks";
import { BENCHMARKS, type BenchmarkKey } from "@/src/lib/benchmarks";
import { cn } from "@/src/lib/cn";

export function BenchmarkToggles({ active }: { active: BenchmarkKey[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const setKeys = React.useCallback(
    (next: BenchmarkKey[]) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next.length === 0) params.delete("bench");
      else params.set("bench", next.join(","));
      const qs = params.toString();
      router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    },
    [router, searchParams],
  );

  const toggle = React.useCallback(
    (key: BenchmarkKey) => {
      setError(null);
      if (active.includes(key)) {
        setKeys(active.filter((k) => k !== key));
        return;
      }
      // Backfill/refresh history before the chart reads it; the action is
      // idempotent and a no-op when coverage is already fresh.
      startTransition(async () => {
        const result = await activateBenchmark({ key });
        if (!result.ok) {
          setError("No se pudo cargar el histórico del índice");
          return;
        }
        setKeys([...active, key]);
      });
    },
    [active, setKeys],
  );

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      <div
        role="group"
        aria-label="Líneas de referencia"
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1"
      >
        {BENCHMARKS.map((b) => {
          const on = active.includes(b.key);
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => toggle(b.key)}
              aria-pressed={on}
              disabled={isPending}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
                on
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: on ? `hsl(var(${b.colorVar}))` : "hsl(var(--border-strong))",
                }}
              />
              {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
