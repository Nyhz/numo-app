"use client";

import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { acknowledgeAlertEvent } from "@/src/actions/acknowledgeAlertEvent";
import { toastResult } from "@/src/lib/toast";
import type { ActiveAlertEvent } from "@/src/server/alerts";

const POLL_MS = 60_000;

function message(ev: ActiveAlertEvent): React.ReactNode {
  const verb = ev.kind === "price_below" ? "ha bajado de" : "ha subido a";
  const tag = ev.assetSymbol ? ` (${ev.assetSymbol})` : "";
  const when = new Date(ev.triggeredAt).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <span>
      <strong>{ev.assetName}</strong>
      {tag} {verb}{" "}
      <SensitiveValue>
        {ev.threshold.toLocaleString("es-ES", { maximumFractionDigits: 4 })} {ev.currency}
      </SensitiveValue>{" "}
      — precio{" "}
      <SensitiveValue>
        {ev.priceAtTrigger.toLocaleString("es-ES", { maximumFractionDigits: 4 })} {ev.currency}
      </SensitiveValue>{" "}
      <span className="text-warning-foreground/70">· {when}</span>
    </span>
  );
}

export function AlertBanner({ initialEvents }: { initialEvents: ActiveAlertEvent[] }) {
  const [events, setEvents] = React.useState<ActiveAlertEvent[]>(initialEvents);
  const [dismissing, setDismissing] = React.useState<Set<string>>(new Set());

  // Poll so a freshly fired alert appears without navigating. The cron that
  // fires alerts runs in a separate process, so the open page must pull.
  React.useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/watchlist/alerts", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { events: ActiveAlertEvent[] };
        if (alive) setEvents(data.events);
      } catch {
        // best-effort; keep the last known set
      }
    }
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function dismiss(id: string) {
    setDismissing((prev) => new Set(prev).add(id));
    setEvents((prev) => prev.filter((e) => e.id !== id)); // optimistic
    const res = await acknowledgeAlertEvent({ id });
    if (!toastResult(res, "Alerta confirmada")) {
      // Re-fetch to restore truth if the ack failed.
      try {
        const r = await fetch("/api/watchlist/alerts", { cache: "no-store" });
        if (r.ok) setEvents(((await r.json()) as { events: ActiveAlertEvent[] }).events);
      } catch {
        /* noop */
      }
    }
  }

  if (events.length === 0) return null;

  return (
    <div className="alert-glow alert-shimmer z-50 border-b border-warning/60 bg-warning/15">
      <ul className="flex flex-col divide-y divide-warning/20">
        {events.map((ev) => (
          <li key={ev.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <Link href="/watchlist" className="flex items-center gap-2 hover:underline">
              <span aria-hidden className="text-base">🔔</span>
              {message(ev)}
            </Link>
            <button
              type="button"
              onClick={() => dismiss(ev.id)}
              disabled={dismissing.has(ev.id)}
              aria-label="Descartar alerta"
              className="shrink-0 rounded-md p-1 text-warning hover:bg-warning/20 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
