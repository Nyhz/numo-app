"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { setBillingCycleDay } from "@/src/actions/setBillingCycleDay";

export function BillingCycleEditor({ day }: { day: number }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(day);
  const [pending, startTransition] = React.useTransition();
  const router = useRouter();

  function save() {
    startTransition(async () => {
      const res = await setBillingCycleDay({ day: value });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        title="Día del mes en que se renueva tu crédito"
      >
        ciclo: día {day} ✎
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">día</span>
      <input
        type="number"
        min={1}
        max={31}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-14 rounded border border-border bg-background px-1 py-0.5 text-xs tabular-nums outline-none focus:ring-2 focus:ring-primary"
      />
      <button
        type="button"
        onClick={save}
        disabled={pending || value < 1 || value > 31}
        className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground disabled:opacity-50"
      >
        {pending ? "…" : "OK"}
      </button>
    </span>
  );
}
