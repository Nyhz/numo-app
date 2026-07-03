import { txEur } from "../../money-types";
import { describe, expect, it } from "vitest";
import { buildCasillasCsv } from "../tax-casillas";
import type { TaxReport } from "../../../server/tax/report";

const sample = (overrides?: Partial<TaxReport["totals"]>): TaxReport => ({
  year: 2025,
  sales: [],
  dividends: [],
  yearEndBalances: [],
  totals: {
    realizedGainsEur: txEur(500),
    realizedLossesComputableEur: txEur(-100),
    nonComputableLossesEur: txEur(40),
    netComputableEur: txEur(400),
    proceedsEur: txEur(1500),
    costBasisEur: txEur(1100),
    feesEur: txEur(0),
    dividendsGrossEur: txEur(120),
    withholdingOrigenTotalEur: txEur(18),
    withholdingDestinoTotalEur: txEur(0),
    ...overrides,
  },
});

describe("buildCasillasCsv", () => {
  it("emits one row per casilla with pipe separator and UTF-8 BOM", () => {
    const csv = buildCasillasCsv(sample(), 18);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("0326");
    expect(csv).toContain("0027");
    expect(csv).toContain("0588");
    expect(csv).toContain("0343|");
  });

  it("prints the externally-computed (cuota-capped) DDI verbatim", () => {
    // Audit F3: the CSV used to compute its own UNCAPPED DDI and disagree
    // with the PDF in loss years \u2014 the capped value must flow in.
    const csv = buildCasillasCsv(sample(), 0);
    const ddiLine = csv.split("\n").find((l) => l.startsWith("0588"));
    expect(ddiLine?.endsWith("|0.00")).toBe(true);
  });

  it("0029 holds only Spanish payments on account \u2014 origin withholding stays out (DDI-only)", () => {
    // Auditor\u00eda 2026-07: sumar la retenci\u00f3n en origen al 0029 adem\u00e1s de
    // concederle DDI en el 0588 la contaba dos veces.
    const csv = buildCasillasCsv(
      sample({ withholdingOrigenTotalEur: txEur(18), withholdingDestinoTotalEur: txEur(25) }),
      18,
      { grossEur: 0, withholdingEur: 7 },
    );
    const line = csv.split("\n").find((l) => l.startsWith("0029"));
    expect(line?.endsWith("|32.00")).toBe(true); // 25 destino + 7 inter\u00e9s, sin los 18 de origen
  });

  it("adds an interest gross row only when interest exists", () => {
    const without = buildCasillasCsv(sample(), 0);
    expect(without).not.toContain("Intereses de cuentas");
    const with_ = buildCasillasCsv(sample(), 0, { grossEur: 110, withholdingEur: 19 });
    const line = with_.split("\n").find((l) => l.includes("Intereses de cuentas"));
    expect(line?.endsWith("|110.00")).toBe(true);
  });
});
