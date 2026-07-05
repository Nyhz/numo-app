"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteMortgageEvent } from "@/src/actions/realEstate";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { PropertySummary } from "@/src/server/realEstate";
import { EarlyRepaymentModal } from "./EarlyRepaymentModal";
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
  const [deletingEvent, setDeletingEvent] = React.useState<string | null>(null);
  const { mortgage, loan, events } = summary;

  if (!mortgage || !loan) {
    return (
      <Card title="Hipoteca">
        <p className="text-sm text-muted-foreground">Sin hipoteca — compra al contado.</p>
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
      <ConfirmModal
        open={deletingEvent !== null}
        onOpenChange={(open) => !open && setDeletingEvent(null)}
        title="Eliminar evento"
        description="El cuadro de amortización se recalculará sin este evento."
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!deletingEvent) return;
          const res = await deleteMortgageEvent({ id: deletingEvent });
          if (res.ok) {
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
