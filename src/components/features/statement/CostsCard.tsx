import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { formatEur } from "@/src/lib/format";
import { accountTypeLabel } from "@/src/lib/labels";
import type { CostsSummary } from "@/src/server/costs";

/** TER values are already percentages (0.22 → "0,22 %"), so format directly
 *  rather than through formatPercent (which assumes a 0–1 ratio). */
function formatTerPct(value: number): string {
  return `${value.toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

export function CostsCard({ summary }: { summary: CostsSummary }) {
  const { commissions, ter } = summary;
  const empty =
    commissions.totalEur === 0 && ter.lines.length === 0;

  if (empty) {
    return (
      <StatesBlock
        mode="empty"
        title="Sin costes registrados"
        description="Las comisiones aparecerán al registrar operaciones con coste, y el TER cuando lo asignes a tus fondos en Activos."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid divide-y divide-border/60 rounded-lg border border-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="flex flex-col gap-1.5 p-4">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Suma de todas las comisiones pagadas: compraventa más comisiones de cuenta."
          >
            Comisiones acumuladas
          </span>
          <SensitiveValue className="text-2xl font-semibold tracking-tight tabular-nums">
            {formatEur(commissions.totalEur)}
          </SensitiveValue>
          <span className="text-xs text-muted-foreground">
            Compraventa{" "}
            <SensitiveValue>{formatEur(commissions.tradingEur)}</SensitiveValue>
            {" · "}cuenta{" "}
            <SensitiveValue>{formatEur(commissions.accountFeesEur)}</SensitiveValue>
          </span>
        </div>
        <div className="flex flex-col gap-1.5 p-4">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Coste anual estimado de tus fondos según su TER, aplicado al valor de mercado actual."
          >
            Coste anual estimado (TER)
          </span>
          <span className="flex items-baseline gap-2">
            <SensitiveValue className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatEur(ter.annualCostEur)}
            </SensitiveValue>
            {ter.weightedTerPct != null && (
              <span className="text-sm font-medium tabular-nums text-muted-foreground">
                {formatTerPct(ter.weightedTerPct)} medio
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {ter.coveredValueEur > 0 ? (
              <>
                Sobre{" "}
                <SensitiveValue>{formatEur(ter.coveredValueEur)}</SensitiveValue> con
                TER asignado
                {ter.coveredValueEur < ter.valuedEur && (
                  <>
                    {" "}de{" "}
                    <SensitiveValue>{formatEur(ter.valuedEur)}</SensitiveValue>{" "}
                    valorados
                  </>
                )}
              </>
            ) : (
              "Asigna el TER a tus fondos en Activos para estimarlo."
            )}
          </span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Comisiones por año
          </h4>
          {commissions.byYear.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin comisiones registradas.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {commissions.byYear.map((y) => (
                <li
                  key={y.year}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="tabular-nums text-muted-foreground">{y.year}</span>
                  <SensitiveValue className="font-medium">
                    {formatEur(y.eur)}
                  </SensitiveValue>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Comisiones por cuenta
          </h4>
          {commissions.byAccount.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin comisiones registradas.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {commissions.byAccount.map((a) => (
                <li
                  key={a.accountId}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{a.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {accountTypeLabel(a.accountType)}
                    </span>
                  </span>
                  <SensitiveValue className="font-medium">
                    {formatEur(a.eur)}
                  </SensitiveValue>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {ter.lines.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Coste anual por fondo (TER)
          </h4>
          <ul className="flex flex-col gap-1.5">
            {ter.lines.map((line) => (
              <li
                key={line.assetId}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{line.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatTerPct(line.terPct)} sobre{" "}
                    <SensitiveValue>{formatEur(line.marketValueEur)}</SensitiveValue>
                  </span>
                </span>
                <SensitiveValue className="font-medium tabular-nums">
                  {formatEur(line.annualCostEur)}
                </SensitiveValue>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
