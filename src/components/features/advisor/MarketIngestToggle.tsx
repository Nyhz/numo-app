"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { setMarketIngest } from "@/src/actions/setMarketIngest";

export function MarketIngestToggle({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = React.useTransition();
  const router = useRouter();

  function toggle() {
    startTransition(async () => {
      const res = await setMarketIngest({ enabled: !enabled });
      if (res.ok) router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      title={
        enabled
          ? "Análisis de mercado activos — pulsa para pausarlos (vacaciones, límite de créditos…)"
          : "Análisis de mercado pausados — pulsa para reactivarlos"
      }
      className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
        enabled
          ? "border-success/30 bg-success/10 text-success"
          : "border-destructive/30 bg-destructive/10 text-destructive"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${enabled ? "bg-success" : "bg-destructive"}`}
        aria-hidden
      />
      {pending ? "…" : enabled ? "Análisis activos" : "Análisis pausados"}
    </button>
  );
}
