import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { advisorRuns, fxRates } from "../db/schema";
import { readAdvisorConfig } from "../lib/advisor/config";
import { formatEur, formatPercent } from "../lib/format";
import { advisorPaths } from "../lib/advisor/paths";
import { readDigest, readProfile } from "../lib/advisor/memory";
import { getCostsSummary } from "./costs";
import { getObjectivesAllocation } from "./objectives";
import { getOverviewKpis } from "./overview";
import { getStatementReport } from "./statement";

const ASSET_TYPE_ES: Record<string, string> = {
  etf: "ETF",
  stock: "Acción",
  crypto: "Cripto",
  fund: "Fondo",
  bond: "Bono",
  cash: "Efectivo",
  commodity: "Materia prima",
  other: "Otro",
};
const typeLabel = (t: string) => ASSET_TYPE_ES[t] ?? t;
const pp = (n: number, d = 1) => n.toLocaleString("es-ES", { maximumFractionDigits: d });

/**
 * A compact markdown snapshot of the live portfolio, injected into every chat so
 * the advisor reasons over real numbers (not memory). Read-only; pulls from the
 * existing server helpers.
 */
export async function getAdvisorContext(dbc: DB = defaultDb): Promise<string> {
  const [report, kpis, costs, objectives] = await Promise.all([
    getStatementReport(dbc),
    getOverviewKpis({ range: "ALL", accountIds: [] }, dbc),
    getCostsSummary(dbc),
    getObjectivesAllocation(dbc),
  ]);
  const t = report.totals;
  const out: string[] = [];

  out.push("## Cartera (datos en vivo)");
  out.push(
    `- Patrimonio total: ${formatEur(t.netWorthEur)} (efectivo ${formatEur(t.cashEur)}, invertido ${formatEur(t.investedMarketValueEur)})`,
  );
  out.push(
    `- Plusvalía latente: ${formatEur(t.unrealizedPnlEur)}${t.unrealizedPnlPct != null ? ` (${formatPercent(t.unrealizedPnlPct)})` : ""}`,
  );
  if (kpis.xirrPct != null) out.push(`- TIR personal (XIRR): ${pp(kpis.xirrPct * 100)} %`);

  const valuedGroups = report.groups.filter((g) => g.marketValueEur > 0);
  if (valuedGroups.length) {
    out.push("\n### Reparto por tipo de activo");
    for (const g of valuedGroups) {
      out.push(`- ${typeLabel(g.assetType)}: ${formatEur(g.marketValueEur)} (${pp(g.weight * 100)} %)`);
    }
  }

  const positions = report.groups
    .flatMap((g) => g.lines)
    .filter((l) => l.marketValueEur != null)
    .sort((a, b) => (b.marketValueEur ?? 0) - (a.marketValueEur ?? 0));
  if (positions.length) {
    out.push("\n### Posiciones");
    for (const l of positions) {
      const pnl =
        l.pnlEur != null
          ? ` · P&L ${formatEur(l.pnlEur)}${l.pnlPct != null ? ` (${formatPercent(l.pnlPct)})` : ""}`
          : "";
      out.push(`- ${l.name}${l.symbol ? ` (${l.symbol})` : ""} — ${formatEur(l.marketValueEur ?? 0)}${pnl}`);
    }
  }

  const realBuckets = objectives.buckets.filter((b) => b.objective != null || b.valueEur > 0);
  if (realBuckets.length) {
    out.push("\n### Objetivos");
    for (const b of realBuckets) {
      const name = b.objective?.name ?? "Sin objetivo asignado";
      const tgt = b.objective ? ` (objetivo ${pp(b.objective.targetPct)} %)` : "";
      const drift =
        b.driftPct != null ? `, desvío ${b.driftPct >= 0 ? "+" : ""}${pp(b.driftPct)} pp` : "";
      out.push(`- ${name}: ${pp(b.weightPct)} %${tgt}${drift}`);
    }
  }

  out.push("\n### Costes");
  out.push(`- Comisiones acumuladas: ${formatEur(costs.commissions.totalEur)}`);
  out.push(
    `- Coste anual estimado (TER): ${formatEur(costs.ter.annualCostEur)}${costs.ter.weightedTerPct != null ? ` (${pp(costs.ter.weightedTerPct, 2)} % medio)` : ""}`,
  );

  return out.join("\n");
}

/** Compact holdings list to steer the market scanner's search toward the
 *  Commander's actual exposure (tickers, types). No financial figures. */
export async function getScanFocus(dbc: DB = defaultDb): Promise<string> {
  const report = await getStatementReport(dbc);
  const lines = report.groups
    .flatMap((g) => g.lines)
    .filter((l) => (l.marketValueEur ?? 0) > 0)
    .sort((a, b) => (b.marketValueEur ?? 0) - (a.marketValueEur ?? 0));

  const out: string[] = ["Activos en cartera (foco de búsqueda):"];
  for (const l of lines) {
    out.push(`- ${l.name}${l.symbol ? ` (${l.symbol})` : ""} [${typeLabel(l.assetType)}]`);
  }
  const types = [
    ...new Set(report.groups.filter((g) => g.marketValueEur > 0).map((g) => typeLabel(g.assetType))),
  ];
  out.push(`Exposición por tipo: ${types.join(", ")}.`);
  return out.join("\n");
}

export function readProfileForPrompt(): string {
  const p = readProfile().trim();
  return (
    p ||
    "(Sin perfil definido todavía. Cuando sea relevante, pregunta al Commander por su edad, situación, horizonte y objetivos.)"
  );
}

export function readDigestForPrompt(): string {
  const d = readDigest().trim();
  return d || "(Sin datos de mercado todavía — el escáner automático se activa en una fase posterior.)";
}

export type AdvisorCostSummary = {
  /** Human range of the current billing cycle, e.g. "8 jun – 7 jul". */
  cycleLabel: string;
  billingCycleDay: number;
  totalEur: number;
  /** Conversación: chat + extracción de memoria. */
  chatEur: number;
  /** Mercados: scans + curación + compactación de chats + telegram. */
  marketsEur: number;
  runs: number;
};

const FALLBACK_USD_TO_EUR = 0.92; // EUR per USD, used until FX is synced

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}
function anchor(y: number, m: number, day: number): Date {
  return new Date(y, m, Math.min(day, daysInMonth(y, m)), 0, 0, 0, 0);
}
function billingCycle(now: Date, day: number): { start: Date; end: Date } {
  const thisAnchor = anchor(now.getFullYear(), now.getMonth(), day);
  const start =
    now.getTime() >= thisAnchor.getTime()
      ? thisAnchor
      : anchor(now.getFullYear(), now.getMonth() - 1, day);
  const end = anchor(start.getFullYear(), start.getMonth() + 1, day);
  return { start, end };
}

/** Latest known EUR-per-USD rate from synced FX, with a sane fallback. */
function usdToEurRate(dbc: DB): number {
  const row = dbc
    .select({ rate: fxRates.rateToEur })
    .from(fxRates)
    .where(eq(fxRates.currency, "USD"))
    .orderBy(desc(fxRates.date))
    .limit(1)
    .get();
  return row?.rate ?? FALLBACK_USD_TO_EUR;
}

/** Advisor spend in the current billing cycle, in EUR, grouped by area. */
export function getAdvisorCostSummary(dbc: DB = defaultDb): AdvisorCostSummary {
  const now = new Date();
  const day = readAdvisorConfig().billingCycleDay;
  const { start, end } = billingCycle(now, day);
  const rate = usdToEurRate(dbc);

  const rows = dbc
    .select({
      kind: advisorRuns.kind,
      cost: sql<number>`COALESCE(SUM(${advisorRuns.costUsd}), 0)`,
      n: sql<number>`COUNT(*)`,
    })
    .from(advisorRuns)
    .where(gte(advisorRuns.startedAt, start.getTime()))
    .groupBy(advisorRuns.kind)
    .all();

  const eur: Record<string, number> = {};
  let runs = 0;
  for (const r of rows) {
    eur[r.kind] = r.cost * rate;
    runs += r.n;
  }
  const chatEur = (eur.chat ?? 0) + (eur.memory ?? 0);
  const marketsEur =
    (eur.scan ?? 0) + (eur.curate ?? 0) + (eur.chat_compact ?? 0) + (eur.telegram ?? 0);

  const fmt = (d: Date) => d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  const endLabel = new Date(end.getTime() - 86_400_000); // last day of the cycle

  return {
    cycleLabel: `${fmt(start)} – ${fmt(endLabel)}`,
    billingCycleDay: day,
    totalEur: chatEur + marketsEur,
    chatEur,
    marketsEur,
    runs,
  };
}

export type AdvisorMarketStatus = {
  /** started_at of the most recent successful scan/curation, or null. */
  lastUpdate: number | null;
  /** Whether the most recent scan/curation (any) succeeded. */
  lastOk: boolean;
};

/** Freshness + health of the market digest, for the UI indicator. */
export function getAdvisorMarketStatus(dbc: DB = defaultDb): AdvisorMarketStatus {
  const kinds = ["scan", "curate"];
  const latest = dbc
    .select({ status: advisorRuns.status })
    .from(advisorRuns)
    .where(inArray(advisorRuns.kind, kinds))
    .orderBy(desc(advisorRuns.startedAt))
    .limit(1)
    .get();
  const lastOk = dbc
    .select({ startedAt: advisorRuns.startedAt })
    .from(advisorRuns)
    .where(and(inArray(advisorRuns.kind, kinds), eq(advisorRuns.status, "ok")))
    .orderBy(desc(advisorRuns.startedAt))
    .limit(1)
    .get();
  return {
    lastUpdate: lastOk?.startedAt ?? null,
    lastOk: latest ? latest.status === "ok" : true,
  };
}

/** Recent weekly chat summaries (conversational continuity). */
export function readRecentChatSummaries(limit = 4): string {
  try {
    const files = readdirSync(advisorPaths.chatsWeeklyDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .slice(-limit);
    if (!files.length) return "";
    return files
      .map((f) => readFileSync(resolve(advisorPaths.chatsWeeklyDir, f), "utf8"))
      .join("\n\n");
  } catch {
    return "";
  }
}
