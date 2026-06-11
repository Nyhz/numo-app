import { describe, expect, it } from "vitest";
import { txEur } from "../../money-types";
import type { TaxReport, SaleReportRow, DividendReportRow } from "../../../server/tax/report";
import { buildTaxReportPdf } from "../tax-report";

function sale(partial: Partial<SaleReportRow> & { assetId: string }): SaleReportRow {
  return {
    transactionId: `tx-${Math.abs(partial.tradedAt ?? 1)}-${partial.assetId}`,
    valuationBasis: null,
    tradedAt: Date.UTC(2025, 5, 1),
    accountId: "acc-1",
    quantity: 1,
    proceedsEur: txEur(100),
    feesEur: txEur(1),
    costBasisEur: txEur(80),
    rawGainLossEur: txEur(19),
    nonComputableLossEur: txEur(0),
    computableGainLossEur: txEur(19),
    consumedLots: [],
    assetName: partial.assetId,
    isin: null,
    assetClassTax: null,
    ...partial,
  };
}

function dividend(partial: Partial<DividendReportRow> & { assetId: string }): DividendReportRow {
  return {
    transactionId: `dv-${partial.assetId}`,
    tradedAt: Date.UTC(2025, 7, 1),
    accountId: "acc-1",
    assetName: partial.assetId,
    isin: null,
    sourceCountry: "US",
    grossNative: 100,
    grossEur: txEur(90),
    withholdingOrigenEur: txEur(13.5),
    withholdingDestinoEur: txEur(0),
    netEur: txEur(76.5),
    ...partial,
  };
}

function report(sales: SaleReportRow[], dividends: DividendReportRow[]): TaxReport {
  const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
  const gains = sales.map((s) => s.computableGainLossEur).filter((n) => n >= 0);
  const losses = sales.map((s) => s.computableGainLossEur).filter((n) => n < 0);
  return {
    year: 2025,
    sales,
    dividends,
    yearEndBalances: [],
    totals: {
      realizedGainsEur: txEur(sum(gains)),
      realizedLossesComputableEur: txEur(sum(losses)),
      nonComputableLossesEur: txEur(sum(sales.map((s) => s.nonComputableLossEur))),
      netComputableEur: txEur(sum(sales.map((s) => s.computableGainLossEur))),
      proceedsEur: txEur(sum(sales.map((s) => s.proceedsEur))),
      costBasisEur: txEur(sum(sales.map((s) => s.costBasisEur))),
      feesEur: txEur(sum(sales.map((s) => s.feesEur))),
      dividendsGrossEur: txEur(sum(dividends.map((d) => d.grossEur))),
      withholdingOrigenTotalEur: txEur(sum(dividends.map((d) => d.withholdingOrigenEur))),
      withholdingDestinoTotalEur: txEur(sum(dividends.map((d) => d.withholdingDestinoEur))),
    },
  };
}

const emptyModels = { m720: { blocks: [] }, m721: { blocks: [] } };

describe("buildTaxReportPdf", () => {
  it("builds a non-empty PDF for an empty year", () => {
    const pdf = buildTaxReportPdf({
      year: 2025,
      report: report([], []),
      models: emptyModels,
      sealedAt: null,
      interestEur: 0,
    });
    expect(pdf.byteLength).toBeGreaterThan(500);
    expect(String.fromCharCode(...pdf.slice(0, 5))).toBe("%PDF-");
  });

  it("groups many sales of the same asset without throwing and paginates", () => {
    const sales = Array.from({ length: 20 }, (_, i) =>
      sale({ assetId: "ETF-World", tradedAt: Date.UTC(2025, 0, 1 + i) }),
    ).concat(Array.from({ length: 60 }, (_, i) => sale({ assetId: `Stock-${i}` })));
    const dividends = Array.from({ length: 12 }, () => dividend({ assetId: "ETF-World" }));
    const pdf = buildTaxReportPdf({
      year: 2025,
      report: report(sales, dividends),
      models: emptyModels,
      sealedAt: Date.UTC(2026, 3, 1),
      interestEur: 120.5,
    });
    expect(pdf.byteLength).toBeGreaterThan(2000);
  });
});
