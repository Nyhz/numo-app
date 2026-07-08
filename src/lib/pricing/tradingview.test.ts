import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQuote, fetchQuotes, fetchHistory, searchSymbols } from "./tradingview";

function stubFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("tradingview.fetchQuotes", () => {
  it("parsea el batch del scanner y omite filas sin precio/divisa", async () => {
    stubFetch({
      totalCount: 3,
      data: [
        { s: "BME:AMP", d: [0.2075, "EUR"] },
        { s: "NYSE:UNH", d: [425.255, "USD"] },
        { s: "XETR:MUERTO", d: [null, "EUR"] },
      ],
    });
    const quotes = await fetchQuotes(["BME:AMP", "NYSE:UNH", "XETR:MUERTO"]);
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({ symbol: "BME:AMP", price: 0.2075, currency: "EUR" });
    expect(quotes[1]).toMatchObject({ symbol: "NYSE:UNH", price: 425.255, currency: "USD" });
    expect(quotes[0].asOf).toBeInstanceOf(Date);
  });

  it("deduplica y devuelve [] con entrada vacía sin tocar la red", async () => {
    const fn = stubFetch({ data: [] });
    expect(await fetchQuotes([])).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("deduplica símbolos repetidos (incl. espacios) en UNA sola llamada de red", async () => {
    const fn = stubFetch({
      data: [{ s: "BME:AMP", d: [0.2075, "EUR"] }],
    });
    await fetchQuotes(["BME:AMP", "BME:AMP", " BME:AMP "]);
    expect(fn).toHaveBeenCalledOnce();
    const [, init] = vi.mocked(fn).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.symbols.tickers).toEqual(["BME:AMP"]);
  });

  it("HTTP no-ok lanza", async () => {
    stubFetch({}, false, 429);
    await expect(fetchQuotes(["BME:AMP"])).rejects.toThrow(/429/);
  });
});

describe("tradingview.fetchQuote", () => {
  it("lanza si el scanner no conoce el símbolo", async () => {
    stubFetch({ data: [] });
    await expect(fetchQuote("BME:NOEXISTE")).rejects.toThrow(/no quote/);
  });
});

describe("tradingview.fetchHistory", () => {
  it("rechaza siempre — TV no da histórico", async () => {
    await expect(fetchHistory("BME:AMP", new Date(), new Date())).rejects.toThrow(
      /history unsupported/,
    );
  });
});

describe("tradingview.searchSymbols", () => {
  it("parsea candidatos y limpia el <em> del highlight", async () => {
    stubFetch({
      symbols: [
        { symbol: "<em>VWCE</em>", exchange: "XETR", currency_code: "EUR", type: "fund", logoid: "vanguard" },
        { symbol: "VWRA", exchange: "LSE", currency_code: "USD", type: "fund" },
      ],
    });
    const hits = await searchSymbols("IE00BK5BQT80");
    expect(hits[0]).toEqual({
      symbol: "VWCE", exchange: "XETR", currency: "EUR", type: "fund", logoid: "vanguard",
    });
    expect(hits[1].logoid).toBeNull();
  });
});
