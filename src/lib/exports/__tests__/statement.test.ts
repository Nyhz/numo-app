import { describe, expect, it } from "vitest";
import type { StatementReport } from "../../../server/statement";
import { buildStatementCsv } from "../statement-csv";
import { buildStatementXlsx } from "../statement-xlsx";
import { buildStatementReportPdf } from "../../pdf/statement-report";

const sample = (): StatementReport => ({
  generatedAt: Date.UTC(2026, 5, 9, 10, 30),
  asOf: null,
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
          name: 'MSCI "World", Acc',
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
        },
      ],
    },
    {
      assetType: "crypto",
      marketValueEur: 500,
      costEur: 600,
      pnlEur: -100,
      weight: 500 / 1700,
      lines: [
        {
          assetId: "a2",
          name: "Bitcoin",
          assetType: "crypto",
          symbol: "BTC",
          isin: null,
          currency: "EUR",
          quantity: 2,
          unitPriceEur: 250,
          marketValueEur: 500,
          costEur: 600,
          pnlEur: -100,
          pnlPct: -100 / 600,
          weight: 500 / 1700,
          valuationDate: "2026-06-08",
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

describe("buildStatementCsv", () => {
  it("emits BOM, totals, asset rows with 2dp money, subtotals and accounts", () => {
    const csv = buildStatementCsv(sample());
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("net_worth_eur,2200.00");
    expect(csv).toContain("unrealized_pnl_pct,6.25");
    // Quoted field with comma and escaped quotes (RFC 4180).
    expect(csv).toContain('"MSCI ""World"", Acc"');
    expect(csv).toContain("etf,TOTAL etf");
    expect(csv).toContain("crypto,Bitcoin,BTC,,EUR,2,250.00,500.00,600.00,-100.00");
    expect(csv).toContain("MyInvestor,savings,EUR,500.00,0.00,500.00");
  });
});

describe("buildStatementXlsx", () => {
  it("produces a valid zip container (xlsx magic bytes) with content", async () => {
    const bytes = await buildStatementXlsx(sample());
    expect(bytes.length).toBeGreaterThan(1000);
    // XLSX is a zip: PK\x03\x04.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});

describe("buildStatementReportPdf", () => {
  it("produces a PDF with the %PDF header", () => {
    const bytes = buildStatementReportPdf(sample());
    expect(bytes.length).toBeGreaterThan(500);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });
});
