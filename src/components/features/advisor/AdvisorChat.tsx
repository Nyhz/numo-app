"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { Markdown } from "@/src/components/ui/Markdown";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { MemoryProposalCard, type Proposal } from "./MemoryProposalCard";
import { AdvisorConversationTabs } from "./AdvisorConversationTabs";
import {
  createConversation,
  deleteConversation,
  renameConversation,
} from "@/src/actions/advisorConversations";
import type { ConversationWithMessages } from "@/src/server/advisorConversations";

type Msg = { role: "user" | "assistant"; content: string };
type Conv = { id: string; title: string | null; messages: Msg[] };

/** Same truncation as the server's deriveTitle, so the optimistic tab label
 *  matches what gets persisted. */
function clientTitle(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat || "Nueva conversación";
}

export function AdvisorChat({
  initialProposals = [],
  initialConversations = [],
}: {
  initialProposals?: Proposal[];
  initialConversations?: ConversationWithMessages[];
}) {
  const [conversations, setConversations] = React.useState<Conv[]>(() =>
    initialConversations.map((c) => ({ id: c.id, title: c.title, messages: c.messages })),
  );
  const [activeId, setActiveId] = React.useState<string | null>(
    () => initialConversations[0]?.id ?? null,
  );
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [proposals, setProposals] = React.useState<Proposal[]>(initialProposals);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const router = useRouter();

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeConv?.messages ?? [];

  const lastContent = messages[messages.length - 1]?.content ?? "";
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeId, messages.length, lastContent]);

  function patchConv(id: string, fn: (c: Conv) => Conv) {
    setConversations((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  }

  async function handleNew() {
    if (busy) return;
    setError(null);
    const res = await createConversation();
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setConversations((cs) => [{ id: res.data.id, title: null, messages: [] }, ...cs]);
    setActiveId(res.data.id);
  }

  function handleRename(id: string, title: string) {
    const prev = conversations.find((c) => c.id === id)?.title ?? null;
    patchConv(id, (c) => ({ ...c, title }));
    void renameConversation({ id, title }).then((res) => {
      if (!res.ok) {
        patchConv(id, (c) => ({ ...c, title: prev }));
        setError(res.error.message);
      }
    });
  }

  function handleEnd(id: string) {
    setConversations((cs) => {
      const next = cs.filter((c) => c.id !== id);
      setActiveId((cur) => (cur === id ? next[0]?.id ?? null : cur));
      return next;
    });
    void deleteConversation({ id }).then((res) => {
      if (!res.ok) setError(res.error.message);
    });
  }

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setError(null);

    // Ensure a conversation exists to attach this exchange to.
    let convId = activeId;
    if (!convId) {
      const res = await createConversation();
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      convId = res.data.id;
      setConversations((cs) => [{ id: res.data.id, title: null, messages: [] }, ...cs]);
      setActiveId(convId);
    }
    const targetId = convId;

    setInput("");
    setBusy(true);
    const history = (conversations.find((c) => c.id === targetId)?.messages ?? []).slice(-40);
    patchConv(targetId, (c) => ({
      ...c,
      title: c.title ?? clientTitle(message),
      messages: [...c.messages, { role: "user", content: message }, { role: "assistant", content: "" }],
    }));

    try {
      const res = await fetch("/api/advisor/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, conversationId: targetId }),
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
            patchConv(targetId, (c) => {
              const next = [...c.messages];
              next[next.length - 1] = {
                role: "assistant",
                content: next[next.length - 1].content + evt.text,
              };
              return { ...c, messages: next };
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
        // Capped + scrollable so a burst of proposals can't squeeze the chat
        // area (the flex-1 sibling below) into nothing.
        <div className="flex max-h-56 shrink-0 flex-col gap-2 overflow-y-auto">
          {proposals.map((p) => (
            <MemoryProposalCard
              key={p.id}
              proposal={p}
              onResolved={(id) => setProposals((list) => list.filter((x) => x.id !== id))}
            />
          ))}
        </div>
      )}

      <AdvisorConversationTabs
        conversations={conversations.map((c) => ({ id: c.id, title: c.title }))}
        activeId={activeId}
        busy={busy}
        onSelect={setActiveId}
        onNew={handleNew}
        onRename={handleRename}
        onEnd={handleEnd}
      />

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-card p-4"
      >
        {messages.length === 0 && (
          <p className="m-auto max-w-md text-center text-[15px] text-muted-foreground">
            Pregúntame por tu cartera, riesgos, oportunidades o cualquier duda financiera. Tengo
            tus posiciones en vivo y tu perfil.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "self-end max-w-[85%] whitespace-pre-wrap rounded-lg bg-accent px-3.5 py-2.5 text-[15px]"
                : "self-start max-w-[90%]"
            }
          >
            {m.role === "assistant" ? (
              m.content ? (
                // Las respuestas citan cifras reales de la cartera: el modo
                // sensible debe cubrirlas igual que a cualquier KPI.
                <SensitiveValue as="div">
                  <Markdown>{m.content}</Markdown>
                </SensitiveValue>
              ) : (
                <span className="text-[15px] text-muted-foreground">
                  {busy && i === messages.length - 1 ? "…" : ""}
                </span>
              )
            ) : (
              <SensitiveValue as="div">{m.content}</SensitiveValue>
            )}
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
          rows={3}
          placeholder="Escribe tu pregunta…  (Enter para enviar, Shift+Enter salto de línea)"
          className="flex-1 resize-none rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] leading-relaxed outline-none focus:ring-2 focus:ring-primary"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !input.trim()}>
          {busy ? "…" : "Enviar"}
        </Button>
      </form>
    </div>
  );
}
