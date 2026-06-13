"use client";

import * as React from "react";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import {
  projectDecumulation,
  simulate,
  solveMonthlyContribution,
  solveYearsToTarget,
  type SimulatorInput,
} from "@/src/lib/simulator";
import { applySavingsScale, savingsScaleForYear } from "@/src/server/tax/cuota";
import { ProjectionChart, type ProjectionPoint } from "./ProjectionChart";
import { ResultsSummary } from "./ResultsSummary";
import { YearTable } from "./YearTable";

type Frequency = "monthly" | "annual";

type FormState = {
  initialCapitalEur: number;
  contribution: number;
  frequency: Frequency;
  contributionGrowthPct: number;
  annualReturnPct: number;
  years: number;
  inflationPct: number;
  scenarioSpreadPct: number;
  applyTax: boolean;
  fireEnabled: boolean;
  annualExpensesEur: number;
  safeWithdrawalRatePct: number;
  targetEur: number;
};

export function SimulatorPanel({
  initialCapitalEur,
  baseYear,
}: {
  initialCapitalEur: number;
  baseYear: number;
}) {
  const [form, setForm] = React.useState<FormState>({
    initialCapitalEur: Math.max(0, Math.round(initialCapitalEur)),
    contribution: 1200,
    frequency: "monthly",
    contributionGrowthPct: 0,
    annualReturnPct: 7.5,
    years: 20,
    inflationPct: 2.5,
    scenarioSpreadPct: 2.5,
    applyTax: true,
    fireEnabled: false,
    annualExpensesEur: 24_000,
    safeWithdrawalRatePct: 4,
    targetEur: 500_000,
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const derived = React.useMemo(() => {
    const monthlyContributionEur =
      form.frequency === "monthly" ? form.contribution : form.contribution / 12;
    const input: SimulatorInput = {
      initialCapitalEur: form.initialCapitalEur,
      monthlyContributionEur,
      contributionGrowthPct: form.contributionGrowthPct,
      annualReturnPct: form.annualReturnPct,
      years: Math.max(1, Math.min(60, Math.round(form.years))),
      inflationPct: form.inflationPct,
      scenarioSpreadPct: Math.max(0, form.scenarioSpreadPct),
      annualExpensesEur: form.fireEnabled ? form.annualExpensesEur : 0,
      safeWithdrawalRatePct: form.safeWithdrawalRatePct,
    };

    const taxFn = (gainEur: number) =>
      applySavingsScale(gainEur, savingsScaleForYear(baseYear + input.years));
    const result = simulate(input, form.applyTax ? taxFn : undefined);

    const points: ProjectionPoint[] = result.base.map((p, i) => ({
      year: p.year,
      label: String(baseYear + p.year),
      contributedEur: p.contributedEur,
      gainEur: Math.max(0, p.gainEur),
      valueEur: p.valueEur,
      pessimisticEur: result.pessimistic[i]?.valueEur ?? p.valueEur,
      optimisticEur: result.optimistic[i]?.valueEur ?? p.valueEur,
    }));

    // Reverse mode targets real (today's) euros so it speaks the same language as
    // the FIRE block and the "Valor real" KPI — otherwise the two contradict.
    const { monthlyContributionEur: _drop, ...inputNoMonthly } = input;
    void _drop;
    const requiredMonthly = solveMonthlyContribution(inputNoMonthly, form.targetEur, "real");
    const yearsToTarget = solveYearsToTarget(input, form.targetEur, "real");

    // Decumulation starts the moment you reach FIRE (not at the horizon end), so
    // it answers "if I retire as soon as I can, does it last?". Modelled in today's
    // euros: real return strips inflation and the withdrawal stays constant.
    let decumulation = null;
    if (form.fireEnabled) {
      const fireYear = result.summary.fire.reachedYear;
      const startPoint =
        fireYear != null
          ? result.base.find((p) => p.year === fireYear)
          : result.base[result.base.length - 1];
      const startRealEur = startPoint ? startPoint.realValueEur : 0;
      const realReturnPct =
        ((1 + form.annualReturnPct / 100) / (1 + form.inflationPct / 100) - 1) * 100;
      decumulation = projectDecumulation({
        startEur: startRealEur,
        annualWithdrawalEur: form.annualExpensesEur,
        annualReturnPct: realReturnPct,
        inflationPct: 0,
        horizonYears: 40,
      });
    }

    return { input, result, points, requiredMonthly, yearsToTarget, decumulation };
  }, [form, baseYear]);

  const { result, points, requiredMonthly, yearsToTarget, decumulation } = derived;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card title="Parámetros">
          <div className="flex flex-col gap-4">
            <NumberField
              label="Capital inicial"
              value={form.initialCapitalEur}
              onChange={(v) => set("initialCapitalEur", v)}
              step={1000}
              min={0}
              suffix="€"
              hint="Prerellenado con tu patrimonio actual"
            />

            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Aportación</span>
              <div className="flex items-center gap-2">
                <NumberInput
                  value={form.contribution}
                  onChange={(v) => set("contribution", v)}
                  className={inputClass}
                />
                <select
                  value={form.frequency}
                  onChange={(e) => set("frequency", e.target.value as Frequency)}
                  className={selectClass}
                >
                  <option value="monthly">€/mes</option>
                  <option value="annual">€/año</option>
                </select>
              </div>
            </div>

            <NumberField
              label="Crecimiento de la aportación"
              value={form.contributionGrowthPct}
              onChange={(v) => set("contributionGrowthPct", v)}
              step={0.5}
              suffix="%/año"
              hint="Sube tu aportación con el tiempo (sueldo, IPC…)"
            />

            <NumberField
              label="Rentabilidad esperada"
              value={form.annualReturnPct}
              onChange={(v) => set("annualReturnPct", v)}
              step={0.1}
              suffix="%/año"
            />

            <NumberField
              label="Horizonte"
              value={form.years}
              onChange={(v) => set("years", v)}
              step={1}
              min={1}
              suffix="años"
            />

            <NumberField
              label="Inflación"
              value={form.inflationPct}
              onChange={(v) => set("inflationPct", v)}
              step={0.1}
              suffix="%/año"
              hint="Para el valor real (poder adquisitivo de hoy)"
            />

            <NumberField
              label="Amplitud de escenarios"
              value={form.scenarioSpreadPct}
              onChange={(v) => set("scenarioSpreadPct", v)}
              step={0.5}
              min={0}
              suffix="± %"
              hint="Distancia de las curvas pesimista y optimista"
            />

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.applyTax}
                onChange={(e) => set("applyTax", e.target.checked)}
              />
              <span>Aplicar fiscalidad foral (Bizkaia) al rescate</span>
            </label>

            <div className="flex flex-col gap-3 rounded-md border border-border/60 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={form.fireEnabled}
                  onChange={(e) => set("fireEnabled", e.target.checked)}
                />
                <span>Modo FIRE (vivir de las rentas)</span>
              </label>
              {form.fireEnabled && (
                <>
                  <NumberField
                    label="Gasto anual objetivo"
                    value={form.annualExpensesEur}
                    onChange={(v) => set("annualExpensesEur", v)}
                    step={1000}
                    min={0}
                    suffix="€/año"
                  />
                  <NumberField
                    label="Tasa de retiro seguro"
                    value={form.safeWithdrawalRatePct}
                    onChange={(v) => set("safeWithdrawalRatePct", v)}
                    step={0.1}
                    min={0.1}
                    suffix="%"
                    hint="Regla del 4% por defecto"
                  />
                </>
              )}
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          <Card title="Proyección del patrimonio">
            <ProjectionChart points={points} />
          </Card>
          <Card title="Resultados">
            <ResultsSummary
              result={result}
              applyTax={form.applyTax}
              decumulation={decumulation}
            />
          </Card>
        </div>
      </div>

      <Card title="Modo inverso — ¿cuánto y cuándo?">
        <div className="flex flex-col gap-4">
          <NumberField
            label="Objetivo de patrimonio"
            value={form.targetEur}
            onChange={(v) => set("targetEur", v)}
            step={10_000}
            min={0}
            suffix="€"
            hint="En € de hoy — mismo criterio que «Valor real» y FIRE"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-lg border border-border/60 p-4">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Aportación necesaria
              </span>
              <span className="text-xl font-semibold tabular-nums">
                {requiredMonthly == null ? (
                  "Inalcanzable"
                ) : (
                  <>
                    <SensitiveValue>{formatEur(requiredMonthly)}</SensitiveValue>
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      /mes
                    </span>
                  </>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                Para llegar a{" "}
                <SensitiveValue>{formatEur(form.targetEur)}</SensitiveValue> (de hoy) en{" "}
                {derived.input.years} años
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-border/60 p-4">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Tiempo hasta el objetivo
              </span>
              <span className="text-xl font-semibold tabular-nums">
                {yearsToTarget == null
                  ? "+100 años"
                  : `${yearsToTarget.toLocaleString("es-ES", {
                      maximumFractionDigits: 1,
                    })} años`}
              </span>
              <span className="text-xs text-muted-foreground">
                Con tu aportación actual y rentabilidad esperada (en € de hoy)
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Detalle anual">
        <YearTable rows={result.base} baseYear={baseYear} />
      </Card>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";
const selectClass =
  "rounded-md border border-border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

/**
 * Spanish-decimal aware input that holds its own text buffer while focused, so
 * clearing the field shows an empty box (not a sticky "0") and you can retype
 * freely. It normalises back to the numeric value on blur. Empty/partial input
 * reports 0 to the calculation but keeps the box as typed.
 */
function NumberInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  // While editing, `draft` holds the raw text (may be empty/partial); otherwise
  // null and we show the canonical numeric value. No effect needed — on blur we
  // drop the draft so an empty box settles back to its value. This is what lets
  // you clear the field and retype instead of fighting a sticky "0".
  const [draft, setDraft] = React.useState<string | null>(null);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? String(value)}
      className={className}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = Number(raw.replace(",", "."));
        onChange(raw.trim() === "" || Number.isNaN(parsed) ? 0 : parsed);
      }}
    />
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  hint?: string;
  // Accepted for call-site ergonomics; the text input ignores spinner hints.
  step?: number;
  min?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <NumberInput value={value} onChange={onChange} className={inputClass} />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
