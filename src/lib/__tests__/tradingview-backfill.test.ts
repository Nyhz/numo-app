import { describe, expect, it } from "vitest";
import { resolveTvListing, tvLogoUrl } from "../tradingview-backfill";
import type { TvSearchHit } from "../pricing/tradingview";

const HITS: TvSearchHit[] = [
  { symbol: "3BRL", exchange: "LSE", currency: "USD", type: "fund", logoid: "wisdomtree" },
  { symbol: "NGXA", exchange: "GETTEX", currency: "EUR", type: "fund", logoid: "wisdomtree" },
];

describe("resolveTvListing", () => {
  it("prefiere la divisa del activo pero valida contra el scanner (GETTEX no cotiza → cae a LSE)", async () => {
    const res = await resolveTvListing(
      { isin: "IE00BMTM6D55", providerSymbol: null, symbol: "NGXA", ticker: null, currency: "EUR" },
      {
        searchSymbols: async () => HITS,
        // el scanner solo sirve el listing de LSE
        fetchQuotes: async (symbols) =>
          symbols
            .filter((s) => s === "LSE:3BRL")
            .map((s) => ({ symbol: s, price: 40.1, currency: "USD", asOf: new Date() })),
      },
    );
    expect(res.tradingviewSymbol).toBe("LSE:3BRL");
    expect(res.logoUrl).toBe("https://s3-symbol-logo.tradingview.com/wisdomtree.svg");
  });

  it("candidato en divisa del activo gana cuando el scanner lo sirve", async () => {
    const res = await resolveTvListing(
      { isin: "IE00BMTM6D55", providerSymbol: null, symbol: "NGXA", ticker: null, currency: "EUR" },
      {
        searchSymbols: async () => HITS,
        fetchQuotes: async (symbols) =>
          symbols.map((s) => ({ symbol: s, price: 40, currency: "EUR", asOf: new Date() })),
      },
    );
    expect(res.tradingviewSymbol).toBe("GETTEX:NGXA");
  });

  it("sin hits (fondos) devuelve nulls y toma el logoid aunque no cotice nada", async () => {
    const sinNada = await resolveTvListing(
      { isin: "ES0119199018", providerSymbol: null, symbol: "COBAS-D", ticker: null, currency: "EUR" },
      { searchSymbols: async () => [], fetchQuotes: async () => [] },
    );
    expect(sinNada).toEqual({ tradingviewSymbol: null, logoUrl: null });

    const soloLogo = await resolveTvListing(
      { isin: "IE00BMTM6D55", providerSymbol: null, symbol: "NGXA", ticker: null, currency: "EUR" },
      { searchSymbols: async () => HITS, fetchQuotes: async () => [] },
    );
    expect(soloLogo.tradingviewSymbol).toBeNull();
    expect(soloLogo.logoUrl).toBe("https://s3-symbol-logo.tradingview.com/wisdomtree.svg");
  });

  it("sin ningún identificador devuelve nulls sin tocar los providers", async () => {
    let searched = 0;
    let quoted = 0;
    const res = await resolveTvListing(
      { isin: null, providerSymbol: null, symbol: null, ticker: null, currency: "EUR" },
      {
        searchSymbols: async () => {
          searched++;
          return HITS;
        },
        fetchQuotes: async () => {
          quoted++;
          return [];
        },
      },
    );
    expect(res).toEqual({ tradingviewSymbol: null, logoUrl: null });
    expect(searched).toBe(0);
    expect(quoted).toBe(0);
  });

  it("si symbol-search falla devuelve nulls en vez de propagar (el batch no muere)", async () => {
    let quoted = 0;
    const res = await resolveTvListing(
      { isin: "IE00BMTM6D55", providerSymbol: null, symbol: "NGXA", ticker: null, currency: "EUR" },
      {
        searchSymbols: async () => {
          throw new Error("tradingview search HTTP 429");
        },
        fetchQuotes: async () => {
          quoted++;
          return [];
        },
      },
    );
    expect(res).toEqual({ tradingviewSymbol: null, logoUrl: null });
    expect(quoted).toBe(0);
  });
});
