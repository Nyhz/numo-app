"use client";

import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatDate, formatEur, formatQuantity } from "@/src/lib/format";
import type { DeclarationRow } from "@/src/server/tax/report";

type Props = {
  rows: DeclarationRow[];
};

/**
 * The numbers to TYPE into Rentanet, one row per venta ↔ compra (FIFO) pair.
 * Historic values, untransformed: the foral renta program applies the
 * actualization coefficients itself from the dates entered here.
 */
export function DeclarationTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <Card title="Declaración — operaciones a transcribir">
        <p className="text-sm text-muted-foreground p-4">
          Sin transmisiones en el ejercicio.
        </p>
      </Card>
    );
  }

  // Visual grouping: alternate row background per sale.
  const bandBySale = new Map<string, boolean>();
  for (const r of rows) {
    if (!bandBySale.has(r.saleTransactionId)) {
      bandBySale.set(r.saleTransactionId, bandBySale.size % 2 === 1);
    }
  }

  return (
    <Card title={`Declaración — operaciones a transcribir en Rentanet (${rows.length})`}>
      <p className="px-4 pb-2 text-xs text-muted-foreground">
        Una fila por pareja venta ↔ compra (FIFO). Valores históricos sin
        actualizar: el programa de renta foral aplica los coeficientes de
        actualización a partir de las fechas.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left pl-4">Activo</th>
              <th className="text-right">F. adquisición</th>
              <th className="text-right">F. transmisión</th>
              <th className="text-right">Cantidad</th>
              <th className="text-right">Valor adquisición</th>
              <th className="text-right">Valor transmisión</th>
              <th className="text-right">Gastos venta</th>
              <th className="text-right pr-4">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              return (
                <tr
                  key={`${r.saleTransactionId}:${r.lotId}`}
                  className={`border-t border-border/30 align-top ${bandBySale.get(r.saleTransactionId) ? "bg-muted/20" : ""}`}
                >
                  <td className="pl-4">
                    {r.assetName ?? r.assetId}
                    {r.isin ? (
                      <span className="ml-1.5 text-xs text-muted-foreground">{r.isin}</span>
                    ) : null}
                    {r.recompra ? (
                      <Badge
                        variant="warning"
                        className="ml-1.5"
                        title="Recompra de valores homogéneos dentro de la ventana del art. 43 NF 13/2013 — marcar la norma antiaplicación en esta operación."
                      >
                        recompra
                      </Badge>
                    ) : null}
                  </td>
                  <td className="text-right tabular-nums">{formatDate(r.acquiredAt)}</td>
                  <td className="text-right tabular-nums">{formatDate(r.soldAt)}</td>
                  <td className="text-right tabular-nums">{formatQuantity(r.qty, { maximumFractionDigits: 6 })}</td>
                  <td className="text-right tabular-nums">
                    <SensitiveValue>{formatEur(r.valorAdquisicionEur)}</SensitiveValue>
                  </td>
                  <td className="text-right tabular-nums">
                    <SensitiveValue>{formatEur(r.valorTransmisionEur)}</SensitiveValue>
                  </td>
                  <td className="text-right tabular-nums">
                    <SensitiveValue>{formatEur(r.gastosTransmisionEur)}</SensitiveValue>
                  </td>
                  <td className="text-right tabular-nums font-medium pr-4">
                    <SensitiveValue>{formatEur(r.resultadoEur)}</SensitiveValue>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
