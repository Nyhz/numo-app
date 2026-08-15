import { beforeEach, describe, expect, it, vi } from "vitest";

const quoteMock = vi.fn();
const chartMock = vi.fn();

vi.mock("yahoo-finance2", () => ({
  default: class {
    quote(...args: unknown[]) {
      return quoteMock(...args);
    }
    chart(...args: unknown[]) {
      return chartMock(...args);
    }
  },
}));

import { fetchHistory, fetchQuote } from "./yahoo";

describe("pricing/yahoo", () => {
  beforeEach(() => {
    quoteMock.mockReset();
    chartMock.mockReset();
  });

  it("fetchQuote maps yahoo-finance2 quote into a Quote shape", async () => {
    quoteMock.mockResolvedValueOnce({
      regularMarketPrice: 193.5,
      currency: "usd",
      regularMarketTime: new Date("2026-04-18T16:00:00Z"),
    });
    const q = await fetchQuote("AAPL");
    expect(q).toEqual({
      symbol: "AAPL",
      price: 193.5,
      currency: "USD",
      asOf: new Date("2026-04-18T16:00:00Z"),
    });
    expect(quoteMock).toHaveBeenCalledWith("AAPL");
  });

  it("fetchQuote throws when regularMarketPrice is missing", async () => {
    quoteMock.mockResolvedValueOnce({ currency: "USD" });
    await expect(fetchQuote("BROKEN")).rejects.toThrow(/regularMarketPrice/);
  });

  it("fetchHistory filters null closes and formats the date", async () => {
    chartMock.mockResolvedValueOnce({
      meta: { currency: "usd" },
      quotes: [
        { date: new Date("2026-04-17T00:00:00Z"), close: 190 },
        { date: new Date("2026-04-18T00:00:00Z"), close: null },
      ],
    });
    const bars = await fetchHistory(
      "AAPL",
      new Date("2026-04-15"),
      new Date("2026-04-19"),
    );
    expect(bars).toEqual([
      { date: "2026-04-17", close: 190, currency: "USD" },
    ]);
  });

  // Regresión: Yahoo publica la sesión en curso de Xetra como una barra con
  // OHLV pero close null. historical() reventaba con "SOME (but not all) null
  // values" y tumbaba el backfill entero del benchmark; chart() nos deja
  // descartar sólo esa fila.
  it("fetchHistory drops a partially-null bar instead of throwing", async () => {
    chartMock.mockResolvedValueOnce({
      meta: { currency: "EUR" },
      quotes: [
        { date: new Date("2026-08-13T07:00:00Z"), close: 129.4, volume: 200_000 },
        {
          date: new Date("2026-08-14T07:00:00Z"),
          open: 129.51,
          high: 129.55,
          low: 128.85,
          volume: 211_390,
          close: null,
          adjclose: null,
        },
      ],
    });
    const bars = await fetchHistory(
      "EUNL.DE",
      new Date("2026-08-01"),
      new Date("2026-08-15"),
    );
    expect(bars).toEqual([
      { date: "2026-08-13", close: 129.4, currency: "EUR" },
    ]);
  });

  it("fetchHistory degrades an unusable meta currency to an empty string", async () => {
    chartMock.mockResolvedValueOnce({
      meta: {},
      quotes: [{ date: new Date("2026-04-17T00:00:00Z"), close: 190 }],
    });
    const bars = await fetchHistory(
      "AAPL",
      new Date("2026-04-15"),
      new Date("2026-04-19"),
    );
    expect(bars).toEqual([{ date: "2026-04-17", close: 190, currency: "" }]);
  });
});

// Audit R2: a missing/garbage currency from Yahoo must throw, never default
// to USD — the wrong FX would corrupt valuations silently.
describe("fetchQuote currency guard", () => {
  it("throws when Yahoo returns no currency", async () => {
    quoteMock.mockResolvedValueOnce({ regularMarketPrice: 100 });
    const { fetchQuote } = await import("./yahoo");
    await expect(fetchQuote("MYSTERY")).rejects.toThrow(/no usable currency/);
  });

  it("throws when Yahoo returns a non-ISO currency string", async () => {
    quoteMock.mockResolvedValueOnce({ regularMarketPrice: 100, currency: "??" });
    const { fetchQuote } = await import("./yahoo");
    await expect(fetchQuote("MYSTERY")).rejects.toThrow(/no usable currency/);
  });
});
