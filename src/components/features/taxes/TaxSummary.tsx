import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { TaxReport } from "@/src/server/tax/report";
import type { Prevision } from "@/src/server/tax/prevision";
import type { TaxInterest } from "@/src/server/tax/interest";

/**
 * El ejercicio en tres cifras, en el orden en que el Commander se hace las
 * preguntas: ¿cuánto gané vendiendo? ¿cuánto cobré de dividendos/intereses?
 * ¿cuánto me va a costar? Todo lo demás (retenciones, no-computables,
 * desgloses) aparece como contexto debajo de su cifra — y solo si no es cero.
 */
export function TaxSummary({
  report,
  prevision,
  interest,
}: {
  report: TaxReport;
  prevision: Prevision;
  interest: TaxInterest;
}) {
  const t = report.totals;
  const est = prevision.cuota;

  const salesCount = report.sales.length;
  const dividendsCount = report.dividends.length;
  const rcmGross = t.dividendsGrossEur + interest.grossEur;
  const withholdings =
    t.withholdingOrigenTotalEur + t.withholdingDestinoTotalEur + interest.withholdingEur;

  const net = t.netComputableEur;
  const netTone = net > 0 ? "text-success" : net < 0 ? "text-destructive" : "";
  const resultado = est.resultadoEstimadoEur;

  return (
    <Card className="p-0">
      <div className="grid divide-y divide-border/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {/* 1 · Resultado de ventas */}
        <div className="flex flex-col gap-1.5 p-5">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Saldo neto computable de ganancias y pérdidas patrimoniales: transmisión − adquisición − gastos, con FIFO y la norma de recompra aplicadas."
          >
            Resultado de ventas
          </span>
          <SensitiveValue className={`text-3xl font-semibold tracking-tight tabular-nums ${netTone}`}>
            {formatEur(net)}
          </SensitiveValue>
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {salesCount === 0 ? (
              <span>Sin ventas en el ejercicio.</span>
            ) : (
              <span>
                {salesCount} venta{salesCount === 1 ? "" : "s"}
                {t.realizedGainsEur > 0 && t.realizedLossesComputableEur < 0 ? (
                  <>
                    {" "}· <SensitiveValue>{formatEur(t.realizedGainsEur)}</SensitiveValue> ganancias,{" "}
                    <SensitiveValue>{formatEur(t.realizedLossesComputableEur)}</SensitiveValue> pérdidas
                  </>
                ) : null}
              </span>
            )}
            {t.nonComputableLossesEur > 0 ? (
              <span>
                <Badge
                  variant="warning"
                  title="Pérdidas no computables este año por recompra de valores homogéneos (art. 43 NF 13/2013). Se recuperan al vender definitivamente los valores recomprados."
                >
                  recompra
                </Badge>{" "}
                <SensitiveValue>{formatEur(t.nonComputableLossesEur)}</SensitiveValue> en pérdidas
                aplazadas
              </span>
            ) : null}
          </div>
        </div>

        {/* 2 · Dividendos e intereses */}
        <div className="flex flex-col gap-1.5 p-5">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Rendimientos del capital mobiliario: dividendos brutos más intereses de cuentas remuneradas."
          >
            Dividendos e intereses
          </span>
          <SensitiveValue className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatEur(rcmGross)}
          </SensitiveValue>
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {rcmGross === 0 ? (
              <span>Sin dividendos ni intereses en el ejercicio.</span>
            ) : (
              <>
                {t.dividendsGrossEur > 0 ? (
                  <span>
                    Dividendos <SensitiveValue>{formatEur(t.dividendsGrossEur)}</SensitiveValue> (
                    {dividendsCount} pago{dividendsCount === 1 ? "" : "s"})
                    {interest.grossEur > 0 ? (
                      <>
                        {" "}· intereses <SensitiveValue>{formatEur(interest.grossEur)}</SensitiveValue>
                      </>
                    ) : null}
                  </span>
                ) : (
                  <span>
                    Intereses <SensitiveValue>{formatEur(interest.grossEur)}</SensitiveValue>
                  </span>
                )}
                {withholdings > 0 ? (
                  <span title="Impuestos ya pagados sobre estos cobros: en origen (el país extranjero, recuperable vía deducción por doble imposición) y en destino (pago a cuenta español).">
                    Ya retenido: <SensitiveValue>{formatEur(withholdings)}</SensitiveValue>
                  </span>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* 3 · Cuota estimada */}
        <div className="flex flex-col gap-1.5 p-5">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Previsión del resultado en el programa de renta foral: base del ahorro con coeficientes de actualización, exención de dividendos, escala y deducciones. Estimación orientativa."
          >
            {resultado >= 0 ? "A pagar (estimado)" : "A devolver (estimado)"}
          </span>
          <SensitiveValue className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatEur(Math.abs(resultado))}
          </SensitiveValue>
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {est.baseAhorroEur === 0 ? (
              <span>Sin base del ahorro este ejercicio.</span>
            ) : (
              <span>
                Base <SensitiveValue>{formatEur(est.baseAhorroEur)}</SensitiveValue> · cuota{" "}
                <SensitiveValue>{formatEur(est.cuotaIntegraEur)}</SensitiveValue>
                {est.ddiCreditEur > 0 || est.withholdingDestinoEur > 0 || est.interestWithholdingEur > 0 ? (
                  <>
                    {" "}−{" "}
                    <SensitiveValue>
                      {formatEur(est.ddiCreditEur + est.withholdingDestinoEur + est.interestWithholdingEur)}
                    </SensitiveValue>{" "}
                    ya pagado
                  </>
                ) : null}
              </span>
            )}
            <span>Previsión foral con coeficientes — detalle más abajo.</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
