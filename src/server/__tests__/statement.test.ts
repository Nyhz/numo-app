import { resolve } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { getStatementReport } from "../statement";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedAccount(db: DB, name: string, accountType: string, cashEur = 0): string {
  const id = ulid();
  db.insert(schema.accounts)
    .values({ id, name, accountType, currentCashBalanceEur: cashEur })
    .run();
  return id;
}

function seedAsset(db: DB, name: string, assetType: string): string {
  const id = ulid();
  db.insert(schema.assets).values({ id, name, assetType }).run();
  return id;
}

function seedPosition(db: DB, assetId: string, quantity: number, totalCostEur: number): void {
  db.insert(schema.assetPositions)
    .values({
      id: ulid(),
      assetId,
      quantity,
      averageCost: quantity > 0 ? totalCostEur / quantity : 0,
      averageCostNative: quantity > 0 ? totalCostEur / quantity : 0,
      totalCostNative: totalCostEur,
      totalCostEur,
    })
    .run();
}

function seedValuation(
  db: DB,
  assetId: string,
  quantity: number,
  unitPriceEur: number,
  valuationDate = "2026-06-08",
): void {
  db.insert(schema.assetValuations)
    .values({
      id: ulid(),
      assetId,
      valuationDate,
      quantity,
      unitPriceEur,
      marketValueEur: quantity * unitPriceEur,
      priceSource: "rebuilt",
    })
    .run();
}

function seedBuy(
  db: DB,
  accountId: string,
  assetId: string,
  grossEur: number,
  opts: { tradedAt?: number; quantity?: number } = {},
): void {
  db.insert(schema.assetTransactions)
    .values({
      id: ulid(),
      accountId,
      assetId,
      transactionType: "buy",
      tradedAt: opts.tradedAt ?? Date.UTC(2026, 0, 5, 12),
      quantity: opts.quantity ?? 1,
      unitPrice: grossEur / (opts.quantity ?? 1),
      tradeCurrency: "EUR",
      fxRateToEur: 1,
      tradeGrossAmount: grossEur,
      tradeGrossAmountEur: grossEur,
      cashImpactEur: -grossEur,
      feesAmount: 0,
      feesAmountEur: 0,
      netAmountEur: -grossEur,
      rowFingerprint: ulid(),
    })
    .run();
}

function seedSell(
  db: DB,
  accountId: string,
  assetId: string,
  quantity: number,
  grossEur: number,
  tradedAt: number,
): void {
  db.insert(schema.assetTransactions)
    .values({
      id: ulid(),
      accountId,
      assetId,
      transactionType: "sell",
      tradedAt,
      quantity,
      unitPrice: grossEur / quantity,
      tradeCurrency: "EUR",
      fxRateToEur: 1,
      tradeGrossAmount: grossEur,
      tradeGrossAmountEur: grossEur,
      cashImpactEur: grossEur,
      feesAmount: 0,
      feesAmountEur: 0,
      netAmountEur: grossEur,
      rowFingerprint: ulid(),
    })
    .run();
}

function seedCashMovement(
  db: DB,
  accountId: string,
  amountEur: number,
  occurredAt: number,
): void {
  db.insert(schema.accountCashMovements)
    .values({
      id: ulid(),
      accountId,
      movementType: amountEur >= 0 ? "deposit" : "withdrawal",
      occurredAt,
      nativeAmount: amountEur,
      currency: "EUR",
      fxRateToEur: 1,
      cashImpactEur: amountEur,
      affectsCashBalance: true,
      rowFingerprint: ulid(),
    })
    .run();
}

describe("getStatementReport", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("returns an empty report on a fresh DB", async () => {
    const report = await getStatementReport(db);
    expect(report.totals.netWorthEur).toBe(0);
    expect(report.totals.positionsCount).toBe(0);
    expect(report.groups).toEqual([]);
    expect(report.accounts).toEqual([]);
  });

  it("groups positions by asset type and totals them", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    const cryptoAcc = seedAccount(db, "Binance", "crypto");
    seedAccount(db, "MyInvestor", "savings", 500);

    const etf = seedAsset(db, "MSCI World", "etf");
    seedPosition(db, etf, 10, 1000);
    seedValuation(db, etf, 10, 120); // market 1200
    seedBuy(db, broker, etf, 1000);

    const coin = seedAsset(db, "Bitcoin", "crypto");
    seedPosition(db, coin, 2, 600);
    seedValuation(db, coin, 2, 250); // market 500
    seedBuy(db, cryptoAcc, coin, 600);

    const report = await getStatementReport(db);

    expect(report.totals.investedMarketValueEur).toBeCloseTo(1700);
    expect(report.totals.investedCostEur).toBeCloseTo(1600);
    expect(report.totals.unrealizedPnlEur).toBeCloseTo(100);
    expect(report.totals.cashEur).toBeCloseTo(500);
    expect(report.totals.netWorthEur).toBeCloseTo(2200);
    expect(report.totals.positionsCount).toBe(2);

    // Biggest group first.
    expect(report.groups.map((g) => g.assetType)).toEqual(["etf", "crypto"]);
    const [etfGroup, cryptoGroup] = report.groups;
    expect(etfGroup.marketValueEur).toBeCloseTo(1200);
    expect(etfGroup.pnlEur).toBeCloseTo(200);
    expect(etfGroup.weight).toBeCloseTo(1200 / 1700);
    expect(cryptoGroup.marketValueEur).toBeCloseTo(500);
    expect(cryptoGroup.pnlEur).toBeCloseTo(-100);

    // Invested value attributed to the account that traded the asset.
    const byName = new Map(report.accounts.map((a) => [a.name, a]));
    expect(byName.get("Degiro")?.investedEur).toBeCloseTo(1200);
    expect(byName.get("Binance")?.investedEur).toBeCloseTo(500);
    expect(byName.get("MyInvestor")?.cashEur).toBeCloseTo(500);
    expect(byName.get("MyInvestor")?.investedEur).toBe(0);
  });

  it("pricesAsOf es la valuationDate más reciente entre las líneas valoradas", async () => {
    const broker = seedAccount(db, "Degiro", "broker");

    const etf = seedAsset(db, "MSCI World", "etf");
    seedPosition(db, etf, 10, 1000);
    seedValuation(db, etf, 10, 120, "2026-07-04");
    seedBuy(db, broker, etf, 1000);

    const fund = seedAsset(db, "Groupama Trésorerie", "fund");
    seedPosition(db, fund, 5, 500);
    seedValuation(db, fund, 5, 101, "2026-07-02"); // NAV rezagado
    seedBuy(db, broker, fund, 500);

    const report = await getStatementReport(db);
    expect(report.pricesAsOf).toBe("2026-07-04");
  });

  it("pricesAsOf es null sin posiciones valoradas", async () => {
    const empty = await getStatementReport(db);
    expect(empty.pricesAsOf).toBeNull();

    const broker = seedAccount(db, "Degiro", "broker");
    const unvalued = seedAsset(db, "Cobas Internacional", "fund");
    seedPosition(db, unvalued, 5, 750);
    seedBuy(db, broker, unvalued, 750);

    const report = await getStatementReport(db);
    expect(report.pricesAsOf).toBeNull();
  });

  it("excludes closed positions and handles unvalued assets", async () => {
    const broker = seedAccount(db, "Degiro", "broker");

    const sold = seedAsset(db, "Sold ETF", "etf");
    seedPosition(db, sold, 0, 0);

    const unvalued = seedAsset(db, "Cobas Internacional", "fund");
    seedPosition(db, unvalued, 5, 750);
    seedBuy(db, broker, unvalued, 750);

    const report = await getStatementReport(db);
    expect(report.totals.positionsCount).toBe(1);
    const line = report.groups[0].lines[0];
    expect(line.name).toBe("Cobas Internacional");
    // Sin precio ⇒ valorada a coste (tiene valor), no null/0. P/L 0, marcada.
    expect(line.valuedAtCost).toBe(true);
    expect(line.marketValueEur).toBeCloseTo(750);
    expect(line.pnlEur).toBe(0);
    expect(report.totals.investedMarketValueEur).toBeCloseTo(750);
    expect(report.totals.netWorthEur).toBeCloseTo(750);
    expect(report.totals.unrealizedPnlEur).toBeCloseTo(0);
    expect(report.totals.unrealizedPnlPct).toBeCloseTo(0);
    expect(report.totals.investedCostEur).toBeCloseTo(750);
  });

  it("una posición sin precio se valora a coste igual que el Resumen (sin divergencia)", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    // Valorada.
    const etf = seedAsset(db, "MSCI World", "etf");
    seedPosition(db, etf, 10, 1000);
    seedValuation(db, etf, 10, 120); // mercado 1200
    seedBuy(db, broker, etf, 1000);
    // Sin precio: aporta su coste (500), no 0.
    const fund = seedAsset(db, "Cobas", "fund");
    seedPosition(db, fund, 5, 500);
    seedBuy(db, broker, fund, 500);

    const report = await getStatementReport(db);
    // 1200 (mercado) + 500 (coste del no valorado) = 1700, no 1200.
    expect(report.totals.investedMarketValueEur).toBeCloseTo(1700);
    expect(report.totals.netWorthEur).toBeCloseTo(1700);
  });
});

describe("getStatementReport as-of", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  const JAN10 = Date.UTC(2026, 0, 10, 12);
  const MAR01 = Date.UTC(2026, 2, 1, 12);
  const MAY01 = Date.UTC(2026, 4, 1, 12);

  it("una compra posterior al corte no cuenta (cantidad ni coste)", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    const etf = seedAsset(db, "MSCI World", "etf");
    seedBuy(db, broker, etf, 1000, { tradedAt: JAN10, quantity: 10 });
    seedBuy(db, broker, etf, 500, { tradedAt: MAY01, quantity: 5 });
    seedValuation(db, etf, 10, 110, "2026-02-27");

    const report = await getStatementReport(db, { asOf: "2026-03-31" });
    expect(report.asOf).toBe("2026-03-31");
    const line = report.groups[0].lines[0];
    expect(line.quantity).toBe(10);
    expect(line.costEur).toBeCloseTo(1000);
    expect(line.marketValueEur).toBeCloseTo(10 * 110);
  });

  it("usa la última valoración ≤ fecha, nunca una posterior", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    const etf = seedAsset(db, "MSCI World", "etf");
    seedBuy(db, broker, etf, 1000, { tradedAt: JAN10, quantity: 10 });
    seedValuation(db, etf, 10, 105, "2026-03-20");
    seedValuation(db, etf, 10, 130, "2026-04-15");

    const report = await getStatementReport(db, { asOf: "2026-03-31" });
    const line = report.groups[0].lines[0];
    expect(line.unitPriceEur).toBeCloseTo(105);
    expect(line.valuationDate).toBe("2026-03-20");
    expect(report.pricesAsOf).toBe("2026-03-20");
    expect(report.totals.investedMarketValueEur).toBeCloseTo(1050);
  });

  it("una venta parcial antes del corte reduce cantidad y coste proporcionalmente", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    const etf = seedAsset(db, "MSCI World", "etf");
    seedBuy(db, broker, etf, 1000, { tradedAt: JAN10, quantity: 10 });
    seedSell(db, broker, etf, 4, 480, MAR01);
    seedValuation(db, etf, 6, 120, "2026-03-30");

    const report = await getStatementReport(db, { asOf: "2026-03-31" });
    const line = report.groups[0].lines[0];
    expect(line.quantity).toBe(6);
    expect(line.costEur).toBeCloseTo(600);
  });

  it("posición cerrada a la fecha no aparece; abierta a la fecha y cerrada hoy sí", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    const etf = seedAsset(db, "MSCI World", "etf");
    seedBuy(db, broker, etf, 1000, { tradedAt: JAN10, quantity: 10 });
    seedSell(db, broker, etf, 10, 1200, MAY01); // cerrada en mayo
    seedValuation(db, etf, 10, 110, "2026-03-30");

    const march = await getStatementReport(db, { asOf: "2026-03-31" });
    expect(march.totals.positionsCount).toBe(1);

    const june = await getStatementReport(db, { asOf: "2026-06-30" });
    expect(june.totals.positionsCount).toBe(0);
  });

  it("el efectivo se acota por occurredAt", async () => {
    const savings = seedAccount(db, "MyInvestor", "savings");
    seedCashMovement(db, savings, 1000, JAN10);
    seedCashMovement(db, savings, 500, MAY01);

    const report = await getStatementReport(db, { asOf: "2026-03-31" });
    const account = report.accounts.find((a) => a.name === "MyInvestor");
    expect(account?.cashEur).toBeCloseTo(1000);
    expect(report.totals.cashEur).toBeCloseTo(1000);
  });

  it("asOf = hoy coincide con el informe sin asOf", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    const savings = seedAccount(db, "MyInvestor", "savings");
    const etf = seedAsset(db, "MSCI World", "etf");
    seedBuy(db, broker, etf, 1000, { tradedAt: JAN10, quantity: 10 });
    seedPosition(db, etf, 10, 1000); // camino actual lee asset_positions
    seedValuation(db, etf, 10, 120, "2026-06-08");
    seedCashMovement(db, savings, 500, JAN10);
    // El camino actual lee accounts.currentCashBalanceEur materializado.
    db.update(schema.accounts)
      .set({ currentCashBalanceEur: 500 })
      .where(eq(schema.accounts.id, savings))
      .run();

    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const live = await getStatementReport(db);
    const asOf = await getStatementReport(db, { asOf: todayIso });

    expect(asOf.totals).toEqual({ ...live.totals });
    expect(asOf.accounts.map((a) => [a.name, a.cashEur, a.investedEur])).toEqual(
      live.accounts.map((a) => [a.name, a.cashEur, a.investedEur]),
    );
    expect(live.asOf).toBeNull();
  });
});
