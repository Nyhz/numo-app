import type { StatementReport } from "../../server/statement";

function csvField(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(",");
}

function money(value: number | null): string {
  // Serialize money at exactly 2dp — raw doubles leak artifacts (audit T9).
  return value == null ? "" : value.toFixed(2);
}

function pct(ratio: number | null): string {
  return ratio == null ? "" : (ratio * 100).toFixed(2);
}

export function buildStatementCsv(report: StatementReport): string {
  const out: string[] = [];

  out.push(csvRow(["generated_at", new Date(report.generatedAt).toISOString()]));
  out.push(csvRow(["prices_as_of", report.pricesAsOf]));
  out.push(csvRow(["net_worth_eur", money(report.totals.netWorthEur)]));
  out.push(csvRow(["cash_eur", money(report.totals.cashEur)]));
  out.push(csvRow(["invested_market_value_eur", money(report.totals.investedMarketValueEur)]));
  out.push(csvRow(["invested_cost_eur", money(report.totals.investedCostEur)]));
  out.push(csvRow(["unrealized_pnl_eur", money(report.totals.unrealizedPnlEur)]));
  out.push(csvRow(["unrealized_pnl_pct", pct(report.totals.unrealizedPnlPct)]));
  out.push("");

  out.push(
    csvRow([
      "asset_type",
      "name",
      "symbol",
      "isin",
      "currency",
      "quantity",
      "unit_price_eur",
      "market_value_eur",
      "cost_eur",
      "pnl_eur",
      "pnl_pct",
      "weight_pct",
      "valuation_date",
    ]),
  );
  for (const group of report.groups) {
    for (const line of group.lines) {
      out.push(
        csvRow([
          line.assetType,
          line.name,
          line.symbol,
          line.isin,
          line.currency,
          line.quantity,
          money(line.unitPriceEur),
          money(line.marketValueEur),
          money(line.costEur),
          money(line.pnlEur),
          pct(line.pnlPct),
          pct(line.weight),
          line.valuationDate,
        ]),
      );
    }
    out.push(
      csvRow([
        group.assetType,
        `TOTAL ${group.assetType}`,
        null,
        null,
        "EUR",
        null,
        null,
        money(group.marketValueEur),
        money(group.costEur),
        money(group.pnlEur),
        null,
        pct(group.weight),
        null,
      ]),
    );
  }
  out.push("");

  out.push(
    csvRow(["account_name", "account_type", "currency", "cash_eur", "invested_eur", "total_eur"]),
  );
  for (const account of report.accounts) {
    out.push(
      csvRow([
        account.name,
        account.accountType,
        account.currency,
        money(account.cashEur),
        money(account.investedEur),
        money(account.totalEur),
      ]),
    );
  }

  return `\uFEFF${out.join("\n")}\n`;
}
