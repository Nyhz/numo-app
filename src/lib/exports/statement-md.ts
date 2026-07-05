import type { StatementReport } from "../../server/statement";
import { accountTypeLabel, assetTypeLabel } from "../labels";

function eur(value: number | null): string {
  if (value == null) return "—";
  return `${value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function pct(ratio: number | null): string {
  if (ratio == null) return "—";
  const value = ratio * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2).replace(".", ",")} %`;
}

function weightPct(ratio: number | null): string {
  return ratio == null ? "—" : `${(ratio * 100).toFixed(1).replace(".", ",")} %`;
}

function qty(value: number): string {
  return value.toLocaleString("es-ES", { maximumFractionDigits: 8 });
}

/** Los pipes rompen las tablas Markdown; los nombres de activo pueden traerlos. */
function esc(value: string | null): string {
  return value == null ? "—" : value.replace(/\|/g, "\\|");
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function buildStatementMd(report: StatementReport): string {
  const t = report.totals;
  const stamp = report.asOf ?? isoDate(report.generatedAt);
  const out: string[] = [];

  out.push(`# Extracto de cartera — ${stamp}`);
  out.push("");
  out.push(
    `Generado el ${isoDate(report.generatedAt)} · ${t.positionsCount} posiciones abiertas en ${t.accountsCount} cuenta${t.accountsCount === 1 ? "" : "s"} · valoración en EUR`,
  );
  out.push("");

  out.push("## Resumen");
  out.push("");
  out.push("| Concepto | Valor |");
  out.push("| --- | ---: |");
  out.push(`| Patrimonio total | ${eur(t.netWorthEur)} |`);
  out.push(`| Efectivo | ${eur(t.cashEur)} |`);
  out.push(`| Invertido (valor de mercado) | ${eur(t.investedMarketValueEur)} |`);
  out.push(`| Coste de lo invertido | ${eur(t.investedCostEur)} |`);
  out.push(
    `| Plusvalía latente | ${eur(t.unrealizedPnlEur)}${t.unrealizedPnlPct != null ? ` (${pct(t.unrealizedPnlPct)})` : ""} |`,
  );
  out.push("");

  if (report.groups.length > 0) {
    out.push("## Posiciones");
    out.push("");
    for (const group of report.groups) {
      out.push(
        `### ${assetTypeLabel(group.assetType)} — ${weightPct(group.weight)} de lo invertido`,
      );
      out.push("");
      out.push("| Activo | Cantidad | Valor | Coste | P/G |");
      out.push("| --- | ---: | ---: | ---: | ---: |");
      for (const line of group.lines) {
        out.push(
          `| ${esc(line.name)} | ${qty(line.quantity)} | ${eur(line.marketValueEur)} | ${eur(line.costEur)} | ${pct(line.pnlPct)} |`,
        );
      }
      out.push(
        `| **Subtotal ${esc(assetTypeLabel(group.assetType))}** | | **${eur(group.marketValueEur)}** | **${eur(group.costEur)}** | **${eur(group.pnlEur)}** |`,
      );
      out.push("");
    }
  }

  out.push("## Cuentas");
  out.push("");
  out.push("| Cuenta | Tipo | Efectivo | Invertido | Total |");
  out.push("| --- | --- | ---: | ---: | ---: |");
  for (const account of report.accounts) {
    out.push(
      `| ${esc(account.name)} | ${accountTypeLabel(account.accountType)} | ${eur(account.cashEur)} | ${eur(account.investedEur)} | ${eur(account.totalEur)} |`,
    );
  }
  out.push("");
  out.push(`**Patrimonio total: ${eur(t.netWorthEur)}**`);
  out.push("");

  return out.join("\n");
}
