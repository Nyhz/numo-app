"use client";

import { useState } from "react";
import { Button } from "@/src/components/ui/Button";

const formats: { label: string; format: string }[] = [
  { label: "Informe PDF", format: "pdf" },
  { label: "Libro Excel (.xlsx)", format: "xlsx" },
  { label: "CSV", format: "csv" },
  { label: "Markdown (.md)", format: "md" },
];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function StatementExportMenu() {
  const [open, setOpen] = useState(false);
  const [asOf, setAsOf] = useState(todayIso());
  const today = todayIso();
  // Fecha = hoy ⇒ extracto actual (sin asOf); pasada ⇒ reconstrucción a fecha.
  const suffix = asOf && asOf !== today ? `&asOf=${asOf}` : "";
  return (
    <div className="relative">
      <Button onClick={() => setOpen((s) => !s)}>Generar extracto ▾</Button>
      {open ? (
        <div className="absolute right-0 mt-1 w-64 rounded-md border border-border bg-popover p-1 shadow-lg z-10">
          <label className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              A día de
            </span>
            <input
              type="date"
              value={asOf}
              max={today}
              onChange={(e) => setAsOf(e.target.value)}
              className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground [color-scheme:light] dark:[color-scheme:dark]"
            />
          </label>
          <div className="my-1 h-px bg-border" />
          {formats.map((it) => (
            <a
              key={it.format}
              href={`/api/exports/statement?format=${it.format}${suffix}`}
              className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
              onClick={() => setOpen(false)}
            >
              {it.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
