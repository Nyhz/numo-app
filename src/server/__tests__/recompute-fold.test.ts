import { describe, expect, it } from "vitest";
import { foldLedger, type LedgerTrade } from "../recompute";

function buy(quantity: number, grossEur: number, feesEur = 0, fx = 1): LedgerTrade {
  return {
    transactionType: "buy",
    quantity,
    tradeGrossAmount: grossEur / fx,
    tradeGrossAmountEur: grossEur,
    feesAmount: feesEur / fx,
    feesAmountEur: feesEur,
    fxRateToEur: fx,
  };
}

function sell(quantity: number): LedgerTrade {
  return {
    transactionType: "sell",
    quantity,
    tradeGrossAmount: 0,
    tradeGrossAmountEur: 0,
    feesAmount: 0,
    feesAmountEur: 0,
    fxRateToEur: 1,
  };
}

describe("foldLedger", () => {
  it("acumula compras con comisiones en el pool de coste", () => {
    const fold = foldLedger([buy(10, 1000, 5)]);
    expect(fold.qty).toBe(10);
    expect(fold.totalCostEur).toBeCloseTo(1005);
    expect(fold.totalCostNative).toBeCloseTo(1005);
  });

  it("deriva la comisión nativa del snapshot EUR cuando hay FX", () => {
    // 100 USD brutos a fx 0.9 (=90 €), comisión 2 € → nativo = 100 + 2/0.9
    const fold = foldLedger([buy(1, 90, 2, 0.9)]);
    expect(fold.totalCostEur).toBeCloseTo(92);
    expect(fold.totalCostNative).toBeCloseTo(100 + 2 / 0.9);
  });

  it("una venta parcial reduce el pool proporcionalmente", () => {
    const fold = foldLedger([buy(10, 1000), sell(4)]);
    expect(fold.qty).toBe(6);
    expect(fold.totalCostEur).toBeCloseTo(600);
  });

  it("vender sin posición es defensivo: no toca el coste", () => {
    const fold = foldLedger([sell(3)]);
    expect(fold.qty).toBeLessThanOrEqual(0);
    expect(fold.totalCostEur).toBe(0);
  });

  it("dividendos y fees no alteran cantidad ni coste", () => {
    const dividend: LedgerTrade = { ...sell(0), transactionType: "dividend", quantity: 1 };
    const fold = foldLedger([buy(5, 500), dividend]);
    expect(fold.qty).toBe(5);
    expect(fold.totalCostEur).toBeCloseTo(500);
  });

  it("una retirada (transfer_out) reduce cantidad y coste como una venta", () => {
    const transferOut: LedgerTrade = { ...sell(4), transactionType: "transfer_out" };
    const fold = foldLedger([buy(10, 1000), transferOut]);
    expect(fold.qty).toBe(6);
    expect(fold.totalCostEur).toBeCloseTo(600);
  });

  it("una retirada total deja la posición cerrada", () => {
    const transferOut: LedgerTrade = { ...sell(10), transactionType: "transfer_out" };
    const fold = foldLedger([buy(10, 1000), transferOut]);
    expect(fold.qty).toBe(0);
    expect(fold.totalCostEur).toBeCloseTo(0);
  });
});
