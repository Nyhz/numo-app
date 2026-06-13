import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { AdvisorCostSummary, AdvisorMarketStatus } from "@/src/server/advisor";
import { BillingCycleEditor } from "./BillingCycleEditor";
import { MarketIngestToggle } from "./MarketIngestToggle";

function relTime(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
  return `hace ${Math.floor(min / 1440)} d`;
}

function lastAnalysisLabel(market: AdvisorMarketStatus, enabled: boolean): string {
  if (market.lastUpdate == null) return enabled ? "Aún sin análisis" : "Pausado · sin análisis";
  if (!market.lastOk) return `⚠ último análisis con error · ${relTime(market.lastUpdate)}`;
  return `Último análisis: ${relTime(market.lastUpdate)}`;
}

function Tile({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="flex flex-col gap-1.5 p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <SensitiveValue className="text-2xl font-semibold tracking-tight tabular-nums">
        {formatEur(value)}
      </SensitiveValue>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

export function AdvisorCostBar({
  summary,
  market,
  marketIngest,
}: {
  summary: AdvisorCostSummary;
  market: AdvisorMarketStatus;
  marketIngest: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="grid gap-px sm:grid-cols-3 sm:divide-x sm:divide-border">
        <div className="flex flex-col gap-1.5 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Gasto del ciclo
            </span>
            <BillingCycleEditor day={summary.billingCycleDay} />
          </div>
          <SensitiveValue className="text-2xl font-semibold tracking-tight tabular-nums">
            {formatEur(summary.totalEur)}
          </SensitiveValue>
          <span className="text-xs text-muted-foreground">{summary.cycleLabel}</span>
        </div>

        <Tile label="Chat" value={summary.chatEur} hint="conversación + memoria" />

        <div className="flex flex-col gap-1.5 p-4">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Mercados
          </span>
          <SensitiveValue className="text-2xl font-semibold tracking-tight tabular-nums">
            {formatEur(summary.marketsEur)}
          </SensitiveValue>
          <MarketIngestToggle enabled={marketIngest} />
          <span className="text-xs text-muted-foreground">
            {lastAnalysisLabel(market, marketIngest)}
          </span>
        </div>
      </div>
    </div>
  );
}
