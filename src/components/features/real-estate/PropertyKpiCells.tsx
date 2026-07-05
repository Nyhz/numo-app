"use client";

import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { roundEur } from "@/src/lib/money";
import type { PropertySummary } from "@/src/server/realEstate";

export function PropertyKpiCells({ summary }: { summary: PropertySummary }) {
  const pct = Math.round(summary.ownedPct * 1000) / 10;
  const fiscalCostEur = roundEur(
    summary.property.purchasePriceEur + summary.property.purchaseCostsEur,
  );
  return (
    <Card className="p-0">
      <div className="grid divide-y divide-border/60 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <Cell
          label="Valor actual"
          tooltip="Última valoración manual; sin valoraciones, el precio de compra."
          value={formatEur(summary.currentValueEur)}
        >
          <span>
            {summary.currentValueAsOf
              ? `Valorado a ${summary.currentValueAsOf}`
              : "A precio de compra"}
          </span>
          {summary.property.purchaseCostsEur > 0 ? (
            <span>
              Adquisición fiscal{" "}
              <SensitiveValue>{formatEur(fiscalCostEur)}</SensitiveValue>
            </span>
          ) : null}
        </Cell>
        <Cell
          label="Capital pendiente"
          tooltip="Capital vivo de la hipoteca según el cuadro vigente. Los intereses futuros no son deuda patrimonial."
          value={formatEur(summary.outstandingEur)}
        >
          {summary.outstandingEur === 0 ? <span>Sin deuda.</span> : null}
        </Cell>
        <Cell
          label="Equity"
          tooltip="Valor actual menos capital pendiente: lo que suma a tu patrimonio."
          value={formatEur(summary.equityEur)}
          emphasis
        />
        <div className="flex flex-col gap-1.5 p-5">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Parte del valor del inmueble que ya es tuya."
          >
            En propiedad
          </span>
          <SensitiveValue className="text-3xl font-semibold tracking-tight tabular-nums">
            {pct.toLocaleString("es-ES")} %
          </SensitiveValue>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function Cell({
  label,
  tooltip,
  value,
  emphasis = false,
  children,
}: {
  label: string;
  tooltip: string;
  value: string;
  emphasis?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 p-5">
      <span
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        title={tooltip}
      >
        {label}
      </span>
      <SensitiveValue
        className={`text-3xl font-semibold tracking-tight tabular-nums ${
          emphasis ? "text-success" : ""
        }`}
      >
        {value}
      </SensitiveValue>
      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">{children}</div>
    </div>
  );
}
