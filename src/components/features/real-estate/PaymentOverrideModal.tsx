"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { addMortgageEvent } from "@/src/actions/realEstate";
import { Button } from "@/src/components/ui/Button";
import { Modal } from "@/src/components/ui/Modal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { buildSchedule, summarizeSchedule } from "@/src/lib/mortgage";
import type { PropertySummary } from "@/src/server/realEstate";
import { scheduleEventsOf, termsOf } from "./mortgageClient";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

/** Registra la cuota real del recibo cuando difiere del cuadro teórico:
 *  aplica a la cuota de la fecha indicada y se hereda hacia delante. */
export function PaymentOverrideModal({
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
  const [note, setNote] = React.useState("");
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const terms = termsOf(summary);
  const amountEur = Number(amount);
  const beforeFirstPayment = !!(
    terms &&
    date &&
    summary.mortgage &&
    date < summary.mortgage.firstPaymentDate
  );
  // Cálculo separado del render: la regla react-hooks/error-boundaries
  // prohíbe construir JSX dentro de try/catch.
  type PreviewData =
    | { ok: true; endDate: string | null; totalInterestEur: number; deltaInterestEur: number }
    | { ok: false };
  let previewData: PreviewData | null = null;
  if (terms && date && !beforeFirstPayment && amount !== "" && amountEur > 0) {
    try {
      const baseRows = buildSchedule(terms, scheduleEventsOf(summary));
      const rows = buildSchedule(terms, [
        ...scheduleEventsOf(summary),
        { type: "payment_override", eventDate: date, paymentEur: amountEur },
      ]);
      const base = summarizeSchedule(terms, baseRows);
      const s = summarizeSchedule(terms, rows);
      previewData = {
        ok: true,
        endDate: s.endDate,
        totalInterestEur: s.totalInterestEur,
        deltaInterestEur: s.totalInterestEur - base.totalInterestEur,
      };
    } catch {
      previewData = { ok: false };
    }
  }
  const preview: React.ReactNode = previewData ? (
    previewData.ok ? (
      <>
        Cuota de <SensitiveValue>{formatEur(amountEur)}</SensitiveValue> desde el {date}, heredada
        hasta el próximo cambio. Fin del préstamo: {previewData.endDate ?? "—"}. Intereses totales:{" "}
        <SensitiveValue>{formatEur(previewData.totalInterestEur)}</SensitiveValue>{" "}
        <span className={previewData.deltaInterestEur > 0 ? "text-destructive" : "text-success"}>
          ({previewData.deltaInterestEur >= 0 ? "+" : ""}
          <SensitiveValue>{formatEur(previewData.deltaInterestEur)}</SensitiveValue>)
        </span>
        .
      </>
    ) : (
      <span className="text-destructive">
        Esa cuota no cubre los intereses del mes — el préstamo nunca amortizaría.
      </span>
    )
  ) : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!summary.mortgage) return;
    setBanner(null);
    startTransition(async () => {
      const res = await addMortgageEvent({
        type: "payment_override",
        mortgageId: summary.mortgage!.id,
        eventDate: date,
        amountEur,
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
      title="Modificar cuota"
      description="Registra la cuota real del recibo (p. ej. el primer mes prorrateado). Se aplica a la cuota de esa fecha y a las siguientes, hasta el próximo cambio de cuota, revisión de tipo o amortización que reduzca cuota."
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
            <span className="font-medium">Fecha de la cuota</span>
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
          <span className="font-medium">Nota (opcional)</span>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {beforeFirstPayment ? (
          <p className="text-sm text-destructive">
            La fecha no puede ser anterior a la primera cuota.
          </p>
        ) : null}
        {preview ? (
          <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
            {preview}
          </p>
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
          <Button type="submit" disabled={pending || !date || amount === "" || beforeFirstPayment}>
            {pending ? "Guardando…" : "Confirmar cuota"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
