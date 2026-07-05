import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatDate, formatEur, formatQuantity } from "@/src/lib/format";
import type { SaleReportRow } from "@/src/server/tax/report";

export function GainsLotDetail({ sale }: { sale: SaleReportRow }) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/40 p-3 text-sm">
      <div className="mb-2 font-medium">Lotes FIFO consumidos</div>
      <table className="w-full">
        <thead className="text-muted-foreground">
          <tr>
            <th className="text-left">Comprado el</th>
            <th className="text-right">Cantidad</th>
            <th className="text-right">Coste de adquisición</th>
          </tr>
        </thead>
        <tbody>
          {sale.consumedLots.map((l) => (
            <tr key={l.lotId} className="border-t border-border/20">
              <td>{formatDate(l.acquiredAt)}</td>
              <td className="text-right tabular-nums">{formatQuantity(l.qtyConsumed, { maximumFractionDigits: 6 })}</td>
              <td className="text-right tabular-nums">
                <SensitiveValue>{formatEur(l.costBasisEur)}</SensitiveValue>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sale.nonComputableLossEur > 0 ? (
        <div className="mt-2 text-destructive">
          Recompra de valores homogéneos (art. 43 NF 13/2013): pérdida aplazada de{" "}
          <SensitiveValue>{formatEur(sale.nonComputableLossEur)}</SensitiveValue> — se
          recupera al vender definitivamente los valores recomprados.
        </div>
      ) : null}
    </div>
  );
}
