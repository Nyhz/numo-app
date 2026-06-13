"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { MemoryProposalCard, type Proposal } from "./MemoryProposalCard";

type Msg = { role: "user" | "assistant"; content: string };

export function AdvisorChat({ initialProposals = [] }: { initialProposals?: Proposal[] }) {
  const [sessionId] = React.useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
  );
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [proposals, setProposals] = React.useState<Proposal[]>(initialProposals);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const router = useRouter();

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setError(null);
    setInput("");
    const history = messages.slice(-40);
    setMessages((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "" }]);
    setBusy(true);

    try {
      const res = await fetch("/api/advisor/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, sessionId }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const evt = JSON.parse(line.slice(6)) as
            | { type: "delta"; text: string }
            | { type: "done"; proposals: Proposal[] }
            | { type: "error"; message: string };
          if (evt.type === "delta") {
            setMessages((m) => {
              const next = [...m];
              next[next.length - 1] = {
                role: "assistant",
                content: next[next.length - 1].content + evt.text,
              };
              return next;
            });
          } else if (evt.type === "done") {
            setProposals(evt.proposals ?? []);
            // Refresh server components (cost bar, profile) with the new spend.
            router.refresh();
          } else if (evt.type === "error") {
            setError(evt.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de conexión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {proposals.length > 0 && (
        <div className="flex flex-col gap-2">
          {proposals.map((p) => (
            <MemoryProposalCard
              key={p.id}
              proposal={p}
              onResolved={(id) => setProposals((list) => list.filter((x) => x.id !== id))}
            />
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-card p-4"
      >
        {messages.length === 0 && (
          <p className="m-auto max-w-md text-center text-sm text-muted-foreground">
            Pregúntame por tu cartera, riesgos, oportunidades o cualquier duda financiera. Tengo
            tus posiciones en vivo y tu perfil.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "self-end max-w-[85%] rounded-lg bg-accent px-3 py-2 text-sm"
                : "self-start max-w-[90%] whitespace-pre-wrap text-sm leading-relaxed"
            }
          >
            {m.content || (busy && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Escribe tu pregunta…  (Enter para enviar, Shift+Enter salto de línea)"
          className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !input.trim()}>
          {busy ? "…" : "Enviar"}
        </Button>
      </form>
    </div>
  );
}
