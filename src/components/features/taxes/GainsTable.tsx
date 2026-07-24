"use client";

import React, { useState } from "react";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatDate, formatEur, formatQuantity } from "@/src/lib/format";
import type { SaleReportRow, TaxReport } from "@/src/server/tax/report";
import { GainsLotDetail } from "./GainsLotDetail";

type Props = {
  sales: SaleReportRow[];
  excludedSales?: TaxReport["excludedSales"];
  /** Nota bajo el título. El default apunta a la tabla Declaración del
   *  ejercicio — el detalle de activo pasa la suya. */
  hint?: string;
};

export function GainsTable({ sales, excludedSales, hint }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  if (sales.length === 0) {
    return (
      <Card title="Detalle por venta">
        <p className="p-4 text-sm text-muted-foreground">Sin ventas en el ejercicio.</p>
      </Card>
    );
  }

  // La columna de pérdidas no computables solo existe si algún ajuste por
  // recompra existe — el caso normal es que no haya ninguno.
  const hasWashSale = sales.some((s) => s.nonComputableLossEur !== 0);
  const cols = hasWashSale ? 9 : 8;

  return (
    <Card title={`Detalle por venta (${sales.length})`}>
      <p className="px-4 pb-2 text-xs text-muted-foreground">
        {hint ??
          "Una fila por venta, con sus lotes FIFO desplegables. Para transcribir a Rentanet usa la tabla Declaración, arriba."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th></th>
              <th className="text-left">Fecha</th>
              <th className="text-left">Activo</th>
              <th className="text-right">Cantidad</th>
              <th className="text-right" title="Importe bruto de la venta en EUR.">
                Transmisión
              </th>
              <th
                className="text-right"
                title="Coste de adquisición FIFO de los lotes consumidos, comisiones de compra incluidas."
              >
                Adquisición
              </th>
              <th className="text-right" title="Comisiones de la venta.">Gastos</th>
              {hasWashSale ? (
                <th
                  className="text-right"
                  title="Parte de la pérdida aplazada por recompra de valores homogéneos (art. 43 NF 13/2013)."
                >
                  Aplazado
                </th>
              ) : null}
              <th className="text-right" title="Transmisión − adquisición − gastos (lo que computa).">
                Resultado
              </th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => {
              const isOpen = expanded.has(s.transactionId);
              const tone =
                s.computableGainLossEur > 0
                  ? "text-success"
                  : s.computableGainLossEur < 0
                    ? "text-destructive"
                    : "";
              return (
                <React.Fragment key={s.transactionId}>
                  <tr className="border-t border-border/30 align-top">
                    <td>
                      <button
                        type="button"
                        className="px-2 text-muted-foreground hover:text-foreground"
                        onClick={() => toggle(s.transactionId)}
                        aria-expanded={isOpen}
                        aria-label="Ver lotes FIFO"
                      >
                        {isOpen ? "▾" : "▸"}
                      </button>
                    </td>
                    <td>{formatDate(s.tradedAt)}</td>
                    <td>
                      {s.assetName ?? s.assetId}
                      {s.valuationBasis === "market-fx" ? (
                        <Badge
                          variant="warning"
                          className="ml-1.5"
                          title="Permuta cripto: el valor EUR procede del cierre diario de mercado, no de datos introducidos a mano (DGT V0999-18)."
                        >
                          valor de mercado
                        </Badge>
                      ) : null}
                    </td>
                    <td className="text-right tabular-nums">{formatQuantity(s.quantity, { maximumFractionDigits: 6 })}</td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.proceedsEur)}</SensitiveValue>
                    </td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.costBasisEur)}</SensitiveValue>
                    </td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.feesEur)}</SensitiveValue>
                    </td>
                    {hasWashSale ? (
                      <td className="text-right tabular-nums">
                        {s.nonComputableLossEur !== 0 ? (
                          <SensitiveValue>{formatEur(s.nonComputableLossEur)}</SensitiveValue>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    ) : null}
                    <td className={`text-right font-medium tabular-nums ${tone}`}>
                      <SensitiveValue>{formatEur(s.computableGainLossEur)}</SensitiveValue>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td></td>
                      <td colSpan={cols} className="pb-3">
                        <GainsLotDetail sale={s} />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {excludedSales && excludedSales.count > 0 ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          Filtro de polvo: {excludedSales.count} microtransmisión
          {excludedSales.count === 1 ? "" : "es"} excluida
          {excludedSales.count === 1 ? "" : "s"} (transmisión{" "}
          <SensitiveValue>{formatEur(excludedSales.proceedsEur)}</SensitiveValue>, coste{" "}
          <SensitiveValue>{formatEur(excludedSales.costBasisEur)}</SensitiveValue>).
        </p>
      ) : null}
    </Card>
  );
}
