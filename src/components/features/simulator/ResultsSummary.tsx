import type { ReactNode } from "react";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { DecumulationResult, SimulatorResult } from "@/src/lib/simulator";

function pct(value: number): string {
  return `${value.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "success" | "muted";
}) {
  const valueTone = tone === "success" ? "text-success" : "";
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/60 p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={`text-xl font-semibold tracking-tight tabular-nums ${valueTone}`}>
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function ResultsSummary({
  result,
  applyTax,
  decumulation,
}: {
  result: SimulatorResult;
  applyTax: boolean;
  decumulation: DecumulationResult | null;
}) {
  const s = result.summary;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          label="Valor final"
          value={<SensitiveValue>{formatEur(s.finalValueEur)}</SensitiveValue>}
          hint="Nominal, al final del horizonte"
        />
        <Tile
          label="Valor real (hoy)"
          value={<SensitiveValue>{formatEur(s.finalRealValueEur)}</SensitiveValue>}
          hint="Ajustado por inflación — poder adquisitivo de hoy"
        />
        {applyTax ? (
          <Tile
            label="Neto tras Hacienda"
            value={<SensitiveValue>{formatEur(s.netFinalValueEur)}</SensitiveValue>}
            hint={
              s.effectiveTaxRatePct != null ? (
                <>
                  Impuesto{" "}
                  <SensitiveValue>{formatEur(s.taxOnGainEur)}</SensitiveValue> ·{" "}
                  {pct(s.effectiveTaxRatePct)} efectivo
                </>
              ) : (
                "Sin plusvalía sujeta"
              )
            }
          />
        ) : (
          <Tile
            label="Intereses generados"
            value={
              <SensitiveValue className="text-success">
                {formatEur(s.totalGainEur)}
              </SensitiveValue>
            }
            hint="Lo que aporta el mercado"
          />
        )}
        <Tile
          label="Total aportado"
          value={<SensitiveValue>{formatEur(s.totalContributedEur)}</SensitiveValue>}
          hint="Capital inicial + aportaciones"
        />
        {applyTax && (
          <Tile
            label="Intereses generados"
            value={
              <SensitiveValue className="text-success">
                {formatEur(s.totalGainEur)}
              </SensitiveValue>
            }
            hint="Lo que aporta el mercado"
          />
        )}
        <Tile
          label="Año bola de nieve"
          value={s.snowballYear != null ? `Año ${s.snowballYear}` : "—"}
          hint={
            s.snowballYear != null
              ? "Cuando los intereses anuales superan tu aportación"
              : "No se alcanza en el horizonte"
          }
        />
      </div>

      {s.fire.enabled && (
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-accent/30 p-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold">Independencia financiera (FIRE)</h4>
            <span className="text-xs text-muted-foreground">
              Regla del {pct(result.input.safeWithdrawalRatePct)}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile
              label="Número FIRE"
              value={
                s.fire.fireNumberEur != null ? (
                  <SensitiveValue>{formatEur(s.fire.fireNumberEur)}</SensitiveValue>
                ) : (
                  "—"
                )
              }
              hint="Patrimonio para vivir de las rentas"
            />
            <Tile
              label="Lo alcanzas"
              value={s.fire.reachedYear != null ? `Año ${s.fire.reachedYear}` : "No en el horizonte"}
              hint={
                s.fire.reachedYear != null
                  ? "Valor real ≥ número FIRE"
                  : "Sube aportación, rentabilidad o años"
              }
              tone={s.fire.reachedYear != null ? "success" : "muted"}
            />
            {decumulation && (
              <Tile
                label="Duración de los retiros"
                value={
                  decumulation.sustainable
                    ? "Sostenible"
                    : `${decumulation.yearsLasting} años`
                }
                hint={
                  decumulation.sustainable ? (
                    <>
                      Retirando desde el punto FIRE, tras 40 años quedarían{" "}
                      <SensitiveValue>
                        {formatEur(decumulation.endRealValueEur)}
                      </SensitiveValue>{" "}
                      (en € de hoy)
                    </>
                  ) : (
                    `Retirando desde el punto FIRE, se agotaría en ${decumulation.yearsLasting} años`
                  )
                }
                tone={decumulation.sustainable ? "success" : "muted"}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
