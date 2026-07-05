import { describe, expect, it } from "vitest";
import type { StatementReport } from "../../../server/statement";
import { buildStatementMd } from "../statement-md";

const sample = (asOf: string | null = null): StatementReport => ({
  generatedAt: Date.UTC(2026, 5, 9, 10, 30),
  asOf,
  pricesAsOf: "2026-06-08",
  totals: {
    investedMarketValueEur: 1700,
    investedCostEur: 1600,
    unrealizedPnlEur: 100,
    unrealizedPnlPct: 100 / 1600,
    cashEur: 500,
    netWorthEur: 2200,
    positionsCount: 2,
    accountsCount: 2,
  },
  groups: [
    {
      assetType: "etf",
      marketValueEur: 1200,
      costEur: 1000,
      pnlEur: 200,
      weight: 1200 / 1700,
      lines: [
        {
          assetId: "a1",
          name: "MSCI | World",
          assetType: "etf",
          symbol: "IWDA",
          isin: "IE00B4L5Y983",
          currency: "EUR",
          quantity: 10,
          unitPriceEur: 120,
          marketValueEur: 1200,
          costEur: 1000,
          pnlEur: 200,
          pnlPct: 0.2,
          weight: 1200 / 1700,
          valuationDate: "2026-06-08",
          valuedAtCost: false,
        },
      ],
    },
  ],
  accounts: [
    {
      accountId: "acc1",
      name: "Degiro",
      accountType: "broker",
      currency: "EUR",
      cashEur: 0,
      investedEur: 1200,
      totalEur: 1200,
    },
    {
      accountId: "acc2",
      name: "MyInvestor",
      accountType: "savings",
      currency: "EUR",
      cashEur: 500,
      investedEur: 0,
      totalEur: 500,
    },
  ],
});

describe("buildStatementMd", () => {
  it("titula con la fecha de generación y estructura el documento", () => {
    const md = buildStatementMd(sample());
    expect(md).toContain("# Extracto de cartera — 2026-06-09");
    expect(md).toContain("## Resumen");
    // es-ES (CLDR) no agrupa millares por debajo de 5 dígitos — misma
    // convención que fmtEur en el kit PDF.
    expect(md).toContain("| Patrimonio total | 2200,00 € |");
    expect(md).toContain("| Plusvalía latente | 100,00 € (+6,25 %) |");
    expect(md).toContain("### ETF — 70,6 % de lo invertido");
    // Sin columnas Símbolo ni Precio — no aportan en un extracto (2026-07-05).
    expect(md).toContain("| Activo | Cantidad | Valor | Coste | P/G |");
    expect(md).not.toContain("Símbolo");
    expect(md).toContain("## Cuentas");
    expect(md).toContain("**Patrimonio total: 2200,00 €**");
  });

  it("indica la fecha real de los precios junto a la de generación", () => {
    const md = buildStatementMd(sample());
    expect(md).toContain(
      "Generado el 2026-06-09 · precios a cierre del 2026-06-08 · 2 posiciones",
    );
  });

  it("omite la coletilla de precios cuando no hay posiciones valoradas", () => {
    const report = { ...sample(), pricesAsOf: null };
    const md = buildStatementMd(report);
    expect(md).not.toContain("precios a cierre");
    expect(md).toContain("Generado el 2026-06-09 · 2 posiciones");
  });

  it("titula con asOf cuando el extracto es a fecha", () => {
    const md = buildStatementMd(sample("2026-03-31"));
    expect(md).toContain("# Extracto de cartera — 2026-03-31");
    expect(md).toContain("Generado el 2026-06-09");
  });

  it("escapa pipes en nombres y formatea es-ES", () => {
    const md = buildStatementMd(sample());
    expect(md).toContain("MSCI \\| World");
    expect(md).toContain("1200,00 €");
    expect(md).toContain("+20,00 %");
  });

  it("una línea sin precio se valora a coste y se marca «a coste»", () => {
    const report = sample();
    const line = report.groups[0].lines[0];
    line.unitPriceEur = null;
    line.marketValueEur = line.costEur; // 1000: valorada a coste, no null
    line.pnlEur = 0;
    line.pnlPct = 0;
    line.valuedAtCost = true;
    line.valuationDate = null;
    const md = buildStatementMd(report);
    expect(md).toMatch(/MSCI \\\| World.*1000,00 € \(a coste\)/);
  });
});
