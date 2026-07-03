import { marketEur } from "../../../lib/money-types";
import { describe, expect, it } from "vitest";
import { aggregateBlocksFromBalances } from "../m720Aggregate";
import type { YearEndBalance } from "../report";

describe("aggregateBlocksFromBalances", () => {
  it("aggregates securities per account country and asset class", () => {
    const balances: YearEndBalance[] = [
      { accountId: "a", accountName: "DEGIRO", accountCountry: "NL", accountType: "broker", assetId: "x", assetName: "UNH", isin: "US91324P1021", assetClassTax: "listed_security", quantity: 3, valueEur: marketEur(900), valuationDate: "2025-12-31", priceSource: "test", unvalued: false, staleValuation: false },
      { accountId: "a", accountName: "DEGIRO", accountCountry: "NL", accountType: "broker", assetId: "y", assetName: "VWCE", isin: "IE00BK5BQT80", assetClassTax: "etf", quantity: 200, valueEur: marketEur(25_000), valuationDate: "2025-12-31", priceSource: "test", unvalued: false, staleValuation: false },
      { accountId: "b", accountName: "BINANCE", accountCountry: "MT", accountType: "crypto_exchange", assetId: "z", assetName: "BTC", isin: null, assetClassTax: "crypto", quantity: 1, valueEur: marketEur(60_000), valuationDate: "2025-12-31", priceSource: "test", unvalued: false, staleValuation: false },
    ];
    const blocks = aggregateBlocksFromBalances(balances);
    const nl = blocks.find((b) => b.country === "NL" && b.type === "broker-securities");
    expect(nl?.valueEur).toBeCloseTo(25_900, 2);
    const mt = blocks.find((b) => b.country === "MT" && b.type === "crypto");
    expect(mt?.valueEur).toBeCloseTo(60_000, 2);
  });

  // Audit fix 3: balances without a country must not silently escape the
  // threshold checks — they land in a tainted "??" sentinel block.
  it("routes balances with no country into a tainted '??' sentinel block", () => {
    const blocks = aggregateBlocksFromBalances([
      { accountId: "a", accountName: "X", accountCountry: null, accountType: "broker", assetId: "y", assetName: "VWCE", isin: "IE00BK5BQT80", assetClassTax: "etf", quantity: 1, valueEur: marketEur(100), valuationDate: "2025-12-31", priceSource: "test", unvalued: false, staleValuation: false },
      { accountId: "b", accountName: "Y", accountCountry: null, accountType: "bank", assetId: "z", assetName: "CASH", isin: null, assetClassTax: "cash", quantity: 1, valueEur: marketEur(500), valuationDate: "2025-12-31", priceSource: "test", unvalued: false, staleValuation: false },
    ]);
    expect(blocks).toHaveLength(2);
    const securities = blocks.find((b) => b.type === "broker-securities");
    expect(securities?.country).toBe("??");
    expect(securities?.hasUnknownCountry).toBe(true);
    expect(securities?.valueEur).toBeCloseTo(100, 2);
    const bank = blocks.find((b) => b.type === "bank-accounts");
    expect(bank?.country).toBe("??");
    expect(bank?.hasUnknownCountry).toBe(true);
    expect(bank?.valueEur).toBeCloseTo(500, 2);
  });

  it("does not taint blocks whose account has a country", () => {
    const blocks = aggregateBlocksFromBalances([
      { accountId: "a", accountName: "DEGIRO", accountCountry: "NL", accountType: "broker", assetId: "y", assetName: "VWCE", isin: "IE00BK5BQT80", assetClassTax: "etf", quantity: 1, valueEur: marketEur(100), valuationDate: "2025-12-31", priceSource: "test", unvalued: false, staleValuation: false },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].hasUnknownCountry).toBe(false);
  });

  // Field-check P1 #3: foreign cash must reach the bank-accounts blocks.
  it("adds year-end cash balances as bank-accounts blocks per country", () => {
    const blocks = aggregateBlocksFromBalances(
      [
        { accountId: "a", accountName: "DEGIRO", accountCountry: "NL", accountType: "broker", assetId: "y", assetName: "VWCE", isin: "IE00BK5BQT80", assetClassTax: "etf", quantity: 1, valueEur: marketEur(30_000), valuationDate: "2025-12-31", priceSource: "test", unvalued: false, staleValuation: false },
      ],
      [
        { accountId: "a", accountName: "DEGIRO", accountCountry: "NL", accountType: "broker", balanceEur: 12_000 },
        { accountId: "c", accountName: "Kutxabank", accountCountry: "ES", accountType: "savings", balanceEur: 5_000 },
      ],
    );
    const nlCash = blocks.find((b) => b.country === "NL" && b.type === "bank-accounts");
    expect(nlCash?.valueEur).toBeCloseTo(12_000, 2);
    expect(nlCash?.hasUnvalued).toBe(false);
    const esCash = blocks.find((b) => b.country === "ES" && b.type === "bank-accounts");
    expect(esCash?.valueEur).toBeCloseTo(5_000, 2);
    // Securities block unaffected.
    const nlSec = blocks.find((b) => b.country === "NL" && b.type === "broker-securities");
    expect(nlSec?.valueEur).toBeCloseTo(30_000, 2);
  });

  it("merges cash into an existing bank-accounts block and taints unknown-country cash", () => {
    const blocks = aggregateBlocksFromBalances(
      [
        // A savings-account position already lands in NL/bank-accounts.
        { accountId: "a", accountName: "N26", accountCountry: "NL", accountType: "savings", assetId: "d", assetName: "Depo", isin: null, assetClassTax: "cash", quantity: 1, valueEur: marketEur(1_000), valuationDate: "2025-12-31", priceSource: "test", unvalued: false, staleValuation: false },
      ],
      [
        { accountId: "a", accountName: "N26", accountCountry: "NL", accountType: "savings", balanceEur: 2_000 },
        { accountId: "x", accountName: "Sin país", accountCountry: null, accountType: "savings", balanceEur: 700 },
      ],
    );
    const nl = blocks.find((b) => b.country === "NL" && b.type === "bank-accounts");
    expect(nl?.valueEur).toBeCloseTo(3_000, 2);
    const unknown = blocks.find((b) => b.country === "??" && b.type === "bank-accounts");
    expect(unknown?.valueEur).toBeCloseTo(700, 2);
    expect(unknown?.hasUnknownCountry).toBe(true);
  });
});
