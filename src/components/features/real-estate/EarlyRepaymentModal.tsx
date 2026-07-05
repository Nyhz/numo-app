"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { addMortgageEvent } from "@/src/actions/realEstate";
import { Button } from "@/src/components/ui/Button";
import { Modal } from "@/src/components/ui/Modal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { buildSchedule, nextPaymentAfter, outstandingAt, summarizeSchedule } from "@/src/lib/mortgage";
import type { PropertySummary } from "@/src/server/realEstate";
import { scheduleEventsOf, termsOf } from "./mortgageClient";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

export function EarlyRepaymentModal({
  summary,
  open,
  onOpenChange,
}: {
  summary: PropertySummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [date, setDate] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [mode, setMode] = React.useState<"reduce_term" | "reduce_installment">("reduce_term");
  const [note, setNote] = React.useState("");
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const terms = termsOf(summary);
  const amountEur = Number(amount);
  const existingSchedule = terms ? buildSchedule(terms, scheduleEventsOf(summary)) : [];
  const beforeFirstPayment = !!(
    terms &&
    date &&
    summary.mortgage &&
    date < summary.mortgage.firstPaymentDate
  );
  const pendingAtDate =
    terms && date && !beforeFirstPayment ? outstandingAt(terms, existingSchedule, date) : 0;
  let preview: string | null = null;
  let previewNote: string | null = null;
  if (terms && date && !beforeFirstPayment && amountEur > 0 && amountEur < pendingAtDate) {
    const hypothetical = buildSchedule(terms, [
      ...scheduleEventsOf(summary),
      { type: "early_repayment", eventDate: date, amountEur, mode },
    ]);
    const s = summarizeSchedule(terms, hypothetical);
    preview =
      mode === "reduce_term"
        ? `Misma cuota; el préstamo terminaría el ${s.endDate ?? "—"} (intereses totales ${formatEur(s.totalInterestEur)}).`
        : `Nueva cuota: ${formatEur(nextPaymentAfter(hypothetical, date)?.paymentEur ?? 0)} /mes; mismo vencimiento (${s.endDate ?? "—"}).`;
  } else if (beforeFirstPayment) {
    previewNote = "La fecha es anterior a la primera cuota.";
  } else if (date && amountEur > 0 && amountEur >= pendingAtDate) {
    previewNote = "El importe iguala o supera el capital pendiente a esa fecha.";
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!summary.mortgage) return;
    setBanner(null);
    startTransition(async () => {
      const res = await addMortgageEvent({
        type: "early_repayment",
        mortgageId: summary.mortgage!.id,
        eventDate: date,
        amountEur,
        mode,
        note: note || null,
      });
      if (res.ok) {
        onOpenChange(false);
        setDate("");
        setAmount("");
        setNote("");
        router.refresh();
        return;
      }
      setBanner(res.error.message);
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title="Amortización anticipada"
      description="Reduce el capital pendiente. Elige si prefieres acortar el plazo o bajar la cuota."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {banner ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {banner}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Fecha</span>
            <input
              type="date"
              className={inputClass}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Importe (€)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Efecto</span>
          <select
            className={inputClass}
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="reduce_term">Reducir plazo (misma cuota)</option>
            <option value="reduce_installment">Reducir cuota (mismo plazo)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Nota (opcional)</span>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {preview ? (
          <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
            <SensitiveValue>{preview}</SensitiveValue>
          </p>
        ) : previewNote ? (
          <p className="text-sm text-muted-foreground">{previewNote}</p>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={pending || !date || !(amountEur > 0)}>
            {pending ? "Guardando…" : "Confirmar amortización"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
