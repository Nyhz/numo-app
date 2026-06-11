/** Reference benchmarks for the overview performance chart.
 *
 *  The portfolio line is a EUR time-weighted return index, so each benchmark
 *  must measure the same thing: EUR total return. We use accumulating UCITS
 *  ETF proxies quoted in EUR on Xetra instead of the raw USD indices — a USD
 *  index normalised to 100 would show dollar performance and silently mix FX
 *  into the comparison.
 */
export const BENCHMARKS = [
  {
    key: "msci-world",
    label: "MSCI World",
    // iShares Core MSCI World UCITS ETF (Acc), EUR, Xetra.
    symbol: "EUNL.DE",
    colorVar: "--chart-1",
  },
  {
    key: "sp500",
    label: "S&P 500",
    // iShares Core S&P 500 UCITS ETF (Acc), EUR, Xetra.
    symbol: "SXR8.DE",
    colorVar: "--chart-3",
  },
] as const;

export type BenchmarkKey = (typeof BENCHMARKS)[number]["key"];
export type Benchmark = (typeof BENCHMARKS)[number];

export const BENCHMARK_KEYS = BENCHMARKS.map((b) => b.key) as BenchmarkKey[];

export function benchmarkByKey(key: string): Benchmark | null {
  return BENCHMARKS.find((b) => b.key === key) ?? null;
}

export function parseBenchmarkKeys(value: string | string[] | undefined): BenchmarkKey[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return [];
  const keys = raw.split(",").map((s) => s.trim());
  return BENCHMARK_KEYS.filter((k) => keys.includes(k));
}
