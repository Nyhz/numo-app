"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteMortgageEvent, setMortgageExpectedInterest } from "@/src/actions/realEstate";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { roundEur } from "@/src/lib/money";
import { toast, toastResult } from "@/src/lib/toast";
import type { PropertySummary } from "@/src/server/realEstate";
import { EarlyRepaymentModal } from "./EarlyRepaymentModal";
import { PaymentOverrideModal } from "./PaymentOverrideModal";
import { RateChangeModal } from "./RateChangeModal";

const RATE_TYPE_LABELS: Record<string, string> = {
  fixed: "Fija",
  variable: "Variable",
  mixed: "Mixta",
};

export function MortgageCard({ summary }: { summary: PropertySummary }) {
  const router = useRouter();
  const [repaying, setRepaying] = React.useState(false);
  const [changingRate, setChangingRate] = React.useState(false);
  const [overridingPayment, setOverridingPayment] = React.useState(false);
  const [deletingEvent, setDeletingEvent] = React.useState<string | null>(null);
  const { mortgage, loan, events } = summary;

  if (!mortgage) {
    return (
      <Card title="Hipoteca">
        <p className="text-sm text-muted-foreground">Sin hipoteca — compra al contado.</p>
      </Card>
    );
  }
  if (!loan) {
    // Compra con fecha futura: la invariante histórica deja el préstamo fuera
    // del patrimonio hasta ese día, pero la hipoteca YA está registrada.
    return (
      <Card title="Hipoteca">
        <p className="text-sm text-muted-foreground">
          Registrada ({RATE_TYPE_LABELS[mortgage.rateType]} · TIN {mortgage.nominalRatePct} %
          {mortgage.lender ? ` · ${mortgage.lender}` : ""}) — computa desde la fecha de compra,{" "}
          {summary.property.purchaseDate}.
        </p>
      </Card>
    );
  }

  const settled = summary.outstandingEur === 0;

  return (
    <Card
      title="Hipoteca"
      action={
        settled ? null : (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setOverridingPayment(true)}>
              Modificar cuota
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setRepaying(true)}>
              Amortización anticipada
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setChangingRate(true)}>
              Revisión de tipo
            </Button>
          </div>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Row label="Cuota mensual">
          <SensitiveValue>{settled ? "—" : formatEur(loan.paymentEur)}</SensitiveValue>
        </Row>
        <Row label="Próxima cuota">
          {loan.nextPayment ? (
            <>
              {loan.nextPayment.date} ·{" "}
              <SensitiveValue>{formatEur(loan.nextPayment.interestEur)}</SensitiveValue> interés /{" "}
              <SensitiveValue>{formatEur(loan.nextPayment.principalEur)}</SensitiveValue> capital
            </>
          ) : (
            "—"
          )}
        </Row>
        <Row label="Tipo">
          {RATE_TYPE_LABELS[mortgage.rateType]} · TIN {mortgage.nominalRatePct} %
          {mortgage.lender ? ` · ${mortgage.lender}` : ""}
        </Row>
        <Row label="Fin del préstamo">{loan.endDate ?? "—"}</Row>
        <Row label="Intereses pagados / restantes">
          <SensitiveValue>{formatEur(loan.interestPaidEur)}</SensitiveValue> /{" "}
          <SensitiveValue>{formatEur(loan.interestRemainingEur)}</SensitiveValue>
        </Row>
        <Row label="Coste total del préstamo">
          <SensitiveValue>{formatEur(loan.totalLoanCostEur)}</SensitiveValue>
        </Row>
      </dl>

      {!settled && loan ? (
        <ScheduleValidation
          mortgageId={mortgage.id}
          expectedTotalInterestEur={mortgage.expectedTotalInterestEur}
          derivedTotalInterestEur={loan.totalInterestEur}
        />
      ) : null}

      {events.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-4">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Eventos
          </span>
          {events.map((e) => (
            <div key={e.id} className="flex items-center justify-between text-sm">
              <span>
                {e.eventDate} —{" "}
                {e.type === "early_repayment" ? (
                  <>
                    Amortización de{" "}
                    <SensitiveValue>{formatEur(e.amountEur ?? 0)}</SensitiveValue>{" "}
                    ({e.mode === "reduce_term" ? "reduce plazo" : "reduce cuota"})
                  </>
                ) : e.type === "payment_override" ? (
                  <>
                    Cuota fijada en{" "}
                    <SensitiveValue>{formatEur(e.amountEur ?? 0)}</SensitiveValue> /mes
                  </>
                ) : (
                  <>Revisión de tipo al {e.newRatePct} %</>
                )}
                {e.note ? (
                  <span className="text-muted-foreground"> · {e.note}</span>
                ) : null}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setDeletingEvent(e.id)}>
                Eliminar
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <EarlyRepaymentModal summary={summary} open={repaying} onOpenChange={setRepaying} />
      <RateChangeModal summary={summary} open={changingRate} onOpenChange={setChangingRate} />
      <PaymentOverrideModal
        summary={summary}
        open={overridingPayment}
        onOpenChange={setOverridingPayment}
      />
      <ConfirmModal
        open={deletingEvent !== null}
        onOpenChange={(open) => !open && setDeletingEvent(null)}
        title="Eliminar evento"
        description="El cuadro de amortización se recalculará sin este evento."
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!deletingEvent) return;
          const res = await deleteMortgageEvent({ id: deletingEvent });
          if (toastResult(res, "Evento eliminado")) {
            setDeletingEvent(null);
            router.refresh();
          }
        }}
      />
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </>
  );
}

/** Contraste del cuadro derivado contra el total de intereses de la oferta
 *  del banco (FEIN). Tolerancia de 1 € por redondeos de cuota. */
function ScheduleValidation({
  mortgageId,
  expectedTotalInterestEur,
  derivedTotalInterestEur,
}: {
  mortgageId: string;
  expectedTotalInterestEur: number | null;
  derivedTotalInterestEur: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const delta =
    expectedTotalInterestEur != null
      ? roundEur(derivedTotalInterestEur - expectedTotalInterestEur)
      : null;
  const matches = delta != null && Math.abs(delta) <= 1;

  function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setBanner(null);
    startTransition(async () => {
      const res = await setMortgageExpectedInterest({
        mortgageId,
        expectedTotalInterestEur: parsed,
      });
      if (res.ok) {
        toast.success("Total de intereses del banco guardado");
        setEditing(false);
        setValue("");
        router.refresh();
        return;
      }
      setBanner(res.error.message);
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Validación del cuadro
      </span>
      {banner ? <p className="text-sm text-destructive">{banner}</p> : null}
      {expectedTotalInterestEur != null && !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="tabular-nums">
            Banco <SensitiveValue>{formatEur(expectedTotalInterestEur)}</SensitiveValue> · cuadro{" "}
            <SensitiveValue>{formatEur(derivedTotalInterestEur)}</SensitiveValue>
            {matches ? (
              <Badge variant="success" className="ml-2">
                cuadra
              </Badge>
            ) : (
              <Badge variant="warning" className="ml-2" title="Diferencia cuadro − banco. Revisa cuotas modificadas, revisiones de TIN o el plazo.">
                desvío{" "}
                <SensitiveValue>
                  {`${delta != null && delta >= 0 ? "+" : ""}${formatEur(delta ?? 0)}`}
                </SensitiveValue>
              </Badge>
            )}
          </span>
          <Button size="sm" variant="ghost" onClick={() => {
            setValue(String(expectedTotalInterestEur));
            setEditing(true);
          }}>
            Editar
          </Button>
        </div>
      ) : (
        <form onSubmit={save} className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Total intereses según el banco (€)"
            className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button size="sm" type="submit" variant="secondary" disabled={pending || value === ""}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
          {editing ? (
            <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
              Cancelar
            </Button>
          ) : null}
        </form>
      )}
    </div>
  );
}
