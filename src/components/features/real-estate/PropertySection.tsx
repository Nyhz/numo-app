"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteProperty } from "@/src/actions/realEstate";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { buildSchedule } from "@/src/lib/mortgage";
import { toastResult } from "@/src/lib/toast";
import type { PropertySummary, PropertySummaryPayload } from "@/src/server/realEstate";
import { AmortizationTable } from "./AmortizationTable";
import { EquityChart } from "./EquityChart";
import { MortgageCard } from "./MortgageCard";
import { PropertyKpiCells } from "./PropertyKpiCells";
import { ValuationsCard } from "./ValuationsCard";
import { scheduleEventsOf, termsOf } from "./mortgageClient";

export function PropertySection({ summary: payload }: { summary: PropertySummaryPayload }) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);

  // El cuadro completo no viaja en el payload RSC: se deriva aquí una vez con
  // el motor puro (mismo cálculo determinista que hace el servidor) y los
  // hijos siguen recibiendo el summary con schedule como siempre.
  const summary: PropertySummary = React.useMemo(() => {
    const terms = termsOf(payload);
    return {
      ...payload,
      schedule: terms ? buildSchedule(terms, scheduleEventsOf(payload)) : [],
    };
  }, [payload]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold tracking-tight">{summary.property.name}</h2>
          {summary.property.address ? (
            <span className="text-xs text-muted-foreground">{summary.property.address}</span>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
          Eliminar
        </Button>
      </div>
      <PropertyKpiCells summary={summary} />
      <div className="grid gap-6 lg:grid-cols-2">
        <MortgageCard summary={summary} />
        <ValuationsCard summary={summary} />
      </div>
      <EquityChart summary={summary} />
      <AmortizationTable summary={summary} />
      <ConfirmModal
        open={deleting}
        onOpenChange={setDeleting}
        title="Eliminar inmueble"
        description="Se eliminarán también su hipoteca, los eventos y las valoraciones. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={async () => {
          const res = await deleteProperty({ id: summary.property.id });
          if (toastResult(res, "Inmueble eliminado")) router.refresh();
        }}
      />
    </section>
  );
}
