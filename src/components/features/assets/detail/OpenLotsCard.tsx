import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatDate, formatEur, formatQuantity } from "@/src/lib/format";
import { actualizationCoefficient } from "@/src/server/tax/coeficientes";
import type { OpenLotRow } from "@/src/server/tax/openLots";
import type { SellTodayEstimate } from "@/src/server/assetDetail";

type LotLine = OpenLotRow & {
  coefficient: number | null;
  currentValueEur: number | null;
  foralGainEur: number | null;
};

function gainTone(n: number): string {
  return n > 0 ? "text-success" : n < 0 ? "text-destructive" : "";
}

/** Lotes FIFO abiertos + estimación «si vendieras hoy» (previsión foral
 *  marginal). La cifra vinculante la da Rentanet — esto es orientativo. */
export function OpenLotsCard({
  lots,
  lastPriceEur,
  sellToday,
}: {
  lots: OpenLotRow[];
  lastPriceEur: number | null;
  sellToday: SellTodayEstimate | null;
}) {
  const year = sellToday?.year ?? new Date().getUTCFullYear();
  const lines: LotLine[] = lots.map((lot) => {
    const coefficient = actualizationCoefficient(
      year,
      new Date(lot.acquiredAt).getUTCFullYear(),
    );
    const currentValueEur = lastPriceEur != null ? lot.remainingQty * lastPriceEur : null;
    return {
      ...lot,
      coefficient,
      currentValueEur,
      foralGainEur:
        currentValueEur != null
          ? currentValueEur - lot.remainingCostEur * (coefficient ?? 1)
          : null,
    };
  });
  const totalBasis = lots.reduce((s, l) => s + l.remainingCostEur, 0);
  const totalQty = lots.reduce((s, l) => s + l.remainingQty, 0);

  return (
    <Card
      title="Lotes FIFO abiertos"
      action={
        sellToday && !sellToday.coefficientsAvailable ? (
          <Badge variant="warning">Tabla de coeficientes {year} sin publicar</Badge>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <DataTable<LotLine>
          rows={lines}
          getRowKey={(l) => l.lotId}
          emptyState="Sin lotes abiertos."
          columns={[
            {
              key: "acquired",
              header: "Adquirido",
              cell: (l) => (
                <span className="flex items-center gap-1.5">
                  <span className="tabular-nums">{formatDate(l.acquiredAt)}</span>
                  {l.deferredLossAddedEur > 0 && (
                    <Badge
                      variant="warning"
                      title="Base incrementada por pérdida diferida (norma antiaplicación)"
                    >
                      recompra
                    </Badge>
                  )}
                </span>
              ),
            },
            {
              key: "qty",
              header: "Cant. restante",
              align: "right",
              cell: (l) => (
                <span className="tabular-nums text-xs">
                  {formatQuantity(l.remainingQty, { maximumFractionDigits: 8 })}
                </span>
              ),
            },
            {
              key: "basis",
              header: "Coste restante",
              align: "right",
              cell: (l) => (
                <SensitiveValue className="tabular-nums text-xs">
                  {formatEur(l.remainingCostEur)}
                </SensitiveValue>
              ),
            },
            {
              key: "coef",
              header: `Coef. ${year}`,
              align: "right",
              cell: (l) => (
                <span className="tabular-nums text-xs text-muted-foreground">
                  {l.coefficient != null ? l.coefficient.toFixed(3) : "—"}
                </span>
              ),
            },
            {
              key: "value",
              header: "Valor actual",
              align: "right",
              cell: (l) =>
                l.currentValueEur != null ? (
                  <SensitiveValue className="tabular-nums text-xs">
                    {formatEur(l.currentValueEur)}
                  </SensitiveValue>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                ),
            },
            {
              key: "gain",
              header: "G/P foral",
              align: "right",
              cell: (l) =>
                l.foralGainEur != null ? (
                  <SensitiveValue
                    className={`tabular-nums text-xs ${gainTone(l.foralGainEur)}`}
                  >
                    {formatEur(l.foralGainEur)}
                  </SensitiveValue>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                ),
            },
          ]}
          footer={
            <span className="flex w-full items-center justify-between tabular-nums">
              <span>
                {lots.length} lote{lots.length === 1 ? "" : "s"} ·{" "}
                <SensitiveValue>
                  {formatQuantity(totalQty, { maximumFractionDigits: 8 })}
                </SensitiveValue>{" "}
                uds
              </span>
              <span>
                Base total{" "}
                <SensitiveValue className="font-medium">
                  {formatEur(totalBasis)}
                </SensitiveValue>
              </span>
            </span>
          }
        />

        {sellToday && (
          <div className="flex flex-col gap-3 rounded-md border border-border/70 bg-accent/30 p-4">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Si vendieras hoy
            </span>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Venta estimada</dt>
                <dd>
                  <SensitiveValue className="text-sm font-semibold tabular-nums">
                    {formatEur(sellToday.proceedsEur)}
                  </SensitiveValue>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Base restante</dt>
                <dd>
                  <SensitiveValue className="text-sm font-semibold tabular-nums">
                    {formatEur(sellToday.remainingBasisEur)}
                  </SensitiveValue>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground" title="Con coeficientes de actualización aplicados a la base">
                  Ganancia foral
                </dt>
                <dd>
                  <SensitiveValue
                    className={`text-sm font-semibold tabular-nums ${gainTone(sellToday.foralGainEur)}`}
                  >
                    {formatEur(sellToday.foralGainEur)}
                  </SensitiveValue>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground" title="Diferencia de cuota del ejercicio con y sin esta venta — negativo significa ahorro">
                  Impacto en cuota {year}
                </dt>
                <dd>
                  <SensitiveValue
                    className={`text-sm font-semibold tabular-nums ${
                      sellToday.cuotaDeltaEur > 0
                        ? "text-destructive"
                        : sellToday.cuotaDeltaEur < 0
                          ? "text-success"
                          : ""
                    }`}
                  >
                    {formatEur(sellToday.cuotaDeltaEur)}
                  </SensitiveValue>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Neto estimado</dt>
                <dd>
                  <SensitiveValue className="text-sm font-semibold tabular-nums">
                    {formatEur(sellToday.netIfSoldEur)}
                  </SensitiveValue>
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Estimación orientativa al último precio, sin comisiones de venta, sobre la
              previsión foral del ejercicio {year}. El cálculo vinculante es el del
              programa de renta de la Hacienda Foral.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
