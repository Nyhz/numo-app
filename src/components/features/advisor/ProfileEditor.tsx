"use client";

import * as React from "react";
import { Button } from "@/src/components/ui/Button";
import { saveAdvisorProfile } from "@/src/actions/saveAdvisorProfile";

export function ProfileEditor({
  initialContent,
  defaultOpen = false,
}: {
  initialContent: string;
  defaultOpen?: boolean;
}) {
  const [content, setContent] = React.useState(initialContent);
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await saveAdvisorProfile({ content });
      setMsg(res.ok ? "Perfil guardado." : res.error.message);
    });
  }

  return (
    <details open={defaultOpen} className="rounded-lg border border-border bg-card">
      <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
        Perfil del asesor (lo que sabe de ti)
      </summary>
      <div className="flex flex-col gap-3 border-t border-border p-5">
        <p className="text-xs text-muted-foreground">
          Edad, situación, horizonte temporal, tolerancia al riesgo, objetivos. El asesor lo lee
          en cada conversación y lo mantiene al día.
        </p>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          placeholder="Ej.: 34 años, ingeniero. Horizonte 25 años. Tolerancia al riesgo alta. Objetivo: independencia financiera a los 55…"
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={pending || !content.trim()}>
            {pending ? "Guardando…" : "Guardar perfil"}
          </Button>
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        </div>
      </div>
    </details>
  );
}
