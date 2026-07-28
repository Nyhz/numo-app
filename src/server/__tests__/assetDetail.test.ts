import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import {
  attachMarkers,
  buildAdjustedSeries,
  getAssetDetail,
  parseAssetDetailRange,
  type AssetPricePoint,
} from "../assetDetail";
import { recomputeLotsForAsset } from "../tax/lots";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedAsset(db: DB, opts?: { name?: string; assetClassTax?: string; isin?: string }): { accountId: string; assetId: string } {
  const accountId = ulid();
  const assetId = ulid();
  db.insert(schema.accounts).values({
    id: accountId, name: "DEGIRO", currency: "EUR",
    accountType: "broker",
    openingBalanceEur: 0, currentCashBalanceEur: 0,
  }).run();
  db.insert(schema.assets).values({
    id: assetId, name: opts?.name ?? "VWCE",
    assetType: "etf", isin: opts?.isin ?? "IE00BK5BQT80",
    currency: "EUR", isActive: true, assetClassTax: opts?.assetClassTax ?? "etf",
  }).run();
  return { accountId, assetId };
}

function seedValuations(db: DB, assetId: string, points: Array<[string, number]>, qty = 10) {
  for (const [date, price] of points) {
    db.insert(schema.assetValuations).values({
      id: `${assetId}_${date}`, assetId, valuationDate: date,
      quantity: qty, unitPriceEur: price, marketValueEur: price * qty,
      priceSource: "rebuilt", createdAt: 1,
    }).run();
  }
}

function insertTrade(db: DB, accountId: string, assetId: string, opts: {
  type: "buy" | "sell"; qty: number; unitPriceEur: number; feesEur?: number; tradedAt: number;
}): string {
  const id = ulid();
  const fees = opts.feesEur ?? 0;
  const gross = opts.qty * opts.unitPriceEur;
  db.insert(schema.assetTransactions).values({
    id, accountId, assetId,
    transactionType: opts.type, tradedAt: opts.tradedAt,
    quantity: opts.qty, unitPrice: opts.unitPriceEur,
    tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: gross, tradeGrossAmountEur: gross,
    cashImpactEur: opts.type === "buy" ? -(gross + fees) : gross - fees,
    feesAmount: fees, feesAmountEur: fees,
    netAmountEur: opts.type === "buy" ? -(gross + fees) : gross - fees,
    isListed: true, source: "manual",
  }).run();
  return id;
}

function insertPosition(db: DB, assetId: string, qty: number, totalCostEur: number) {
  db.insert(schema.assetPositions).values({
    id: ulid(), assetId, quantity: qty,
    averageCost: qty > 0 ? totalCostEur / qty : 0,
    averageCostNative: qty > 0 ? totalCostEur / qty : 0,
    totalCostNative: totalCostEur, totalCostEur,
  }).run();
}

function recompute(db: DB, assetId: string) {
  db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
}

const TODAY = "2026-07-24";

describe("parseAssetDetailRange", () => {
  it("acepta rangos válidos y cae a MAX", () => {
    expect(parseAssetDetailRange("1M")).toBe("1M");
    expect(parseAssetDetailRange("1A")).toBe("1A");
    expect(parseAssetDetailRange("bogus")).toBe("MAX");
    expect(parseAssetDetailRange(undefined)).toBe("MAX");
  });
});

describe("buildAdjustedSeries / attachMarkers (puros)", () => {
  const splits = [{ effectiveIso: "2026-06-20", numerator: 1, denominator: 25 }];

  it("retro-ajusta los puntos anteriores al canje", () => {
    const series = buildAdjustedSeries(
      [
        { valuationDate: "2026-06-19", unitPriceEur: 0.2 },
        { valuationDate: "2026-06-20", unitPriceEur: 5.0 },
      ],
      splits,
    );
    expect(series[0].unitPriceEur).toBeCloseTo(5.0, 10); // 0.20 × 25
    expect(series[1].unitPriceEur).toBeCloseTo(5.0, 10); // ya post-canje
  });

  it("ancla marcadores: fecha exacta y snap al punto anterior", () => {
    const series: AssetPricePoint[] = [
      { date: "2026-01-05", unitPriceEur: 100 },
      { date: "2026-01-10", unitPriceEur: 105 },
      { date: "2026-01-20", unitPriceEur: 110 },
    ];
    const out = attachMarkers(series, [
      { transactionType: "buy", tradedAt: Date.UTC(2026, 0, 10), quantity: 5, tradeGrossAmountEur: 525 },
      { transactionType: "sell", tradedAt: Date.UTC(2026, 0, 12), quantity: 2, tradeGrossAmountEur: 212 },
    ], undefined);

    expect(out[0].markers).toBeUndefined();
    expect(out[1].markers).toHaveLength(2);
    const [buy, sell] = out[1].markers!; // compra primero
    expect(buy.type).toBe("buy");
    expect(buy.exact).toBe(true);
    expect(buy.unitPriceEur).toBeCloseTo(105, 10);
    expect(sell.type).toBe("sell");
    expect(sell.exact).toBe(false); // 12-ene sin punto → snap al 10-ene
    expect(sell.unitPriceEur).toBeCloseTo(106, 10);
  });

  it("colapsa varias órdenes del mismo día y tipo en un marcador (media ponderada)", () => {
    const series: AssetPricePoint[] = [{ date: "2026-01-05", unitPriceEur: 100 }];
    const out = attachMarkers(series, [
      { transactionType: "buy", tradedAt: Date.UTC(2026, 0, 5), quantity: 1, tradeGrossAmountEur: 100 },
      { transactionType: "buy", tradedAt: Date.UTC(2026, 0, 5, 14), quantity: 3, tradeGrossAmountEur: 330 },
    ], undefined);
    expect(out[0].markers).toHaveLength(1);
    expect(out[0].markers![0].quantity).toBe(4);
    expect(out[0].markers![0].unitPriceEur).toBeCloseTo(430 / 4, 10);
  });

  it("el precio del marcador pre-split queda en la escala ajustada de la serie", () => {
    const series = buildAdjustedSeries(
      [{ valuationDate: "2026-06-19", unitPriceEur: 0.2 }, { valuationDate: "2026-06-20", unitPriceEur: 5.0 }],
      splits,
    );
    const out = attachMarkers(series, [
      { transactionType: "buy", tradedAt: Date.UTC(2026, 5, 19), quantity: 100, tradeGrossAmountEur: 20 },
    ], splits);
    // 0.20 €/ud × 25 = 5.00 en unidades actuales — pegado a la curva.
    expect(out[0].markers![0].unitPriceEur).toBeCloseTo(5.0, 10);
  });
});

describe("getAssetDetail", () => {
  it("id desconocido → null", async () => {
    const db = makeDb();
    expect(await getAssetDetail("nope", "MAX", db, TODAY)).toBeNull();
  });

  it("activo sin operaciones → untraded con todo vacío", async () => {
    const db = makeDb();
    const { assetId } = seedAsset(db);
    const detail = (await getAssetDetail(assetId, "MAX", db, TODAY))!;
    expect(detail.state).toBe("untraded");
    expect(detail.series).toEqual([]);
    expect(detail.openLots).toEqual([]);
    expect(detail.sellToday).toBeNull();
    expect(detail.realized).toBeNull();
    expect(detail.dividends).toBeNull();
    expect(detail.latentPnl).toBeNull();
  });

  it("posición abierta: KPIs, peso en cartera y filtro de rango", async () => {
    const db = makeDb();
    const { accountId, assetId } = seedAsset(db);
    insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, tradedAt: Date.UTC(2025, 0, 10) });
    insertPosition(db, assetId, 10, 1000);
    seedValuations(db, assetId, [
      ["2025-01-10", 100],
      ["2026-06-01", 140],
      ["2026-07-23", 150],
    ]);
    // Segundo activo para el denominador del peso (500 € de mercado).
    const other = seedAsset(db, { name: "OTRO", isin: "IE00B4L5Y983" });
    insertPosition(db, other.assetId, 5, 400);
    seedValuations(db, other.assetId, [["2026-07-23", 100]], 5);
    recompute(db, assetId);

    const detail = (await getAssetDetail(assetId, "MAX", db, TODAY))!;
    expect(detail.state).toBe("open");
    expect(detail.marketValueEur).toBeCloseTo(1500, 6);
    expect(detail.averageCostEur).toBeCloseTo(100, 6);
    expect(detail.latentPnl!.eur).toBeCloseTo(500, 6);
    expect(detail.latentPnl!.pct).toBeCloseTo(0.5, 6);
    expect(detail.portfolioWeight).toBeCloseTo(1500 / 2000, 6);
    expect(detail.series).toHaveLength(3);
    expect(detail.series[0].markers![0].type).toBe("buy");

    // Rango 1M desde 2026-07-24 → corte 2026-06-24: solo queda el último punto.
    const short = (await getAssetDetail(assetId, "1M", db, TODAY))!;
    expect(short.series.map((p) => p.date)).toEqual(["2026-07-23"]);
  });

  it("sellToday: coeficiente 2026←2025 y delta contra la previsión del año", async () => {
    const db = makeDb();
    const { accountId, assetId } = seedAsset(db);
    insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, tradedAt: Date.UTC(2025, 2, 1) });
    insertPosition(db, assetId, 10, 1000);
    seedValuations(db, assetId, [["2026-07-23", 150]]);
    recompute(db, assetId);

    const detail = (await getAssetDetail(assetId, "MAX", db, TODAY))!;
    const st = detail.sellToday!;
    expect(st.year).toBe(2026);
    expect(st.coefficientsAvailable).toBe(true);
    expect(st.proceedsEur).toBeCloseTo(1500, 6);
    expect(st.remainingBasisEur).toBeCloseTo(1000, 6);
    expect(st.rawGainEur).toBeCloseTo(500, 6);
    // Coef DF 115/2025: adquisición 2025 → 1.02 ⇒ foral = 1500 − 1020 = 480.
    expect(st.foralGainEur).toBeCloseTo(480, 6);
    // Año sin más ventas/dividendos: base 480 al 19% (primer tramo 2026).
    expect(st.cuotaDeltaEur).toBeCloseTo(480 * 0.19, 2);
    expect(st.netIfSoldEur).toBeCloseTo(1500 - 480 * 0.19, 2);
  });

  it("posición cerrada: realized del informe fiscal, sin sellToday ni latente", async () => {
    const db = makeDb();
    const { accountId, assetId } = seedAsset(db);
    insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, tradedAt: Date.UTC(2025, 0, 10) });
    insertTrade(db, accountId, assetId, { type: "sell", qty: 10, unitPriceEur: 130, tradedAt: Date.UTC(2025, 6, 1) });
    insertPosition(db, assetId, 0, 0);
    seedValuations(db, assetId, [["2025-01-10", 100], ["2025-06-30", 128]]);
    recompute(db, assetId);

    const detail = (await getAssetDetail(assetId, "MAX", db, TODAY))!;
    expect(detail.state).toBe("closed");
    expect(detail.sellToday).toBeNull();
    expect(detail.latentPnl).toBeNull();
    expect(detail.marketValueEur).toBeNull();
    expect(detail.portfolioWeight).toBeNull();
    expect(detail.realized).not.toBeNull();
    expect(detail.realized!.sales).toHaveLength(1);
    expect(detail.realized!.totalRawEur).toBeCloseTo(300, 6);
    // La gráfica de la ventana de propiedad sigue viva.
    expect(detail.series).toHaveLength(2);
  });

  it("dividendos: suma bruto/neto/retención con la convención del informe", async () => {
    const db = makeDb();
    const { accountId, assetId } = seedAsset(db);
    insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, tradedAt: Date.UTC(2025, 0, 10) });
    insertPosition(db, assetId, 10, 1000);
    db.insert(schema.assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "dividend", tradedAt: Date.UTC(2026, 2, 15),
      quantity: 0, unitPrice: 0, tradeCurrency: "USD", fxRateToEur: 0.9,
      tradeGrossAmount: 100, tradeGrossAmountEur: 90,
      cashImpactEur: 76.5, withholdingTax: 13.5, sourceCountry: "US",
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 76.5,
      isListed: true, source: "manual",
    }).run();
    recompute(db, assetId);

    const detail = (await getAssetDetail(assetId, "MAX", db, TODAY))!;
    expect(detail.dividends).toEqual({
      count: 1, grossEur: 90, netEur: 76.5, withholdingEur: 13.5,
    });
  });
});

describe("getAssetDetail — cola de mercado (precio sin posición)", () => {
  function insertPrice(db: DB, symbol: string, date: string, price: number) {
    db.insert(schema.priceHistory).values({
      id: ulid(), symbol, price,
      pricedAt: new Date(`${date}T00:00:00Z`).getTime(),
      pricedDateUtc: date, source: "yahoo", createdAt: 1,
    }).run();
  }

  it("añade puntos market tras la última valoración con posición y excluye filas legacy qty=0", async () => {
    const db = makeDb();
    const { accountId, assetId } = seedAsset(db);
    db.update(schema.assets).set({ symbol: "QDVE.DE" }).where(eq(schema.assets.id, assetId)).run();
    insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 40, tradedAt: Date.UTC(2026, 0, 5, 12) });
    insertTrade(db, accountId, assetId, { type: "sell", qty: 10, unitPriceEur: 44, tradedAt: Date.UTC(2026, 2, 1, 12) });
    insertPosition(db, assetId, 0, 0);
    seedValuations(db, assetId, [["2026-01-05", 40], ["2026-02-27", 43]]);
    // Fila legacy del cron antiguo (qty=0 tras la venta) — no debe pintarse.
    db.insert(schema.assetValuations).values({
      id: `${assetId}_legacy`, assetId, valuationDate: "2026-03-05",
      quantity: 0, unitPriceEur: 999, marketValueEur: 0,
      priceSource: "yahoo", createdAt: 1,
    }).run();
    insertPrice(db, "QDVE.DE", "2026-03-10", 50);
    insertPrice(db, "QDVE.DE", "2026-07-20", 60);
    insertPrice(db, "QDVE.DE", "2026-08-01", 70); // futuro respecto a TODAY — fuera
    recompute(db, assetId);

    const detail = (await getAssetDetail(assetId, "MAX", db, TODAY))!;
    expect(detail.state).toBe("closed");
    const dates = detail.series.map((p) => p.date);
    expect(dates).toEqual(["2026-01-05", "2026-02-27", "2026-03-10", "2026-07-20"]);
    const tail = detail.series.filter((p) => p.market);
    expect(tail.map((p) => [p.date, p.unitPriceEur])).toEqual([
      ["2026-03-10", 50],
      ["2026-07-20", 60],
    ]);
    // Los puntos de la ventana de propiedad no llevan flag market.
    expect(detail.series[0].market).toBeUndefined();
    // El último precio conocido es el de mercado, no la última valoración.
    expect(detail.lastPrice).toEqual({ unitPriceEur: 60, date: "2026-07-20" });
    // El estado cerrado no gana KPIs de posición por tener cola.
    expect(detail.marketValueEur).toBeNull();
    expect(detail.sellToday).toBeNull();
  });

  it("convierte la cola no-EUR con fx_rates y carry-forward, y omite fechas sin FX previo", async () => {
    const db = makeDb();
    const { assetId } = seedAsset(db);
    db.update(schema.assets).set({ symbol: "TSM", currency: "USD" }).where(eq(schema.assets.id, assetId)).run();
    db.insert(schema.fxRates).values({
      id: ulid(), currency: "USD", date: "2026-07-01", rateToEur: 0.9, source: "yahoo_fx", createdAt: 1,
    }).run();
    insertPrice(db, "TSM", "2026-06-20", 100); // sin FX aún → se omite
    insertPrice(db, "TSM", "2026-07-01", 100); // 0.9 exacto
    insertPrice(db, "TSM", "2026-07-03", 110); // carry-forward del 0.9

    const detail = (await getAssetDetail(assetId, "MAX", db, TODAY))!;
    expect(detail.series.map((p) => [p.date, p.unitPriceEur, p.market])).toEqual([
      ["2026-07-01", 90, true],
      ["2026-07-03", 99, true],
    ]);
  });

  it("el filtro de rango también recorta la cola de mercado", async () => {
    const db = makeDb();
    const { assetId } = seedAsset(db);
    db.update(schema.assets).set({ symbol: "QDVE.DE" }).where(eq(schema.assets.id, assetId)).run();
    insertPrice(db, "QDVE.DE", "2026-01-10", 50);
    insertPrice(db, "QDVE.DE", "2026-07-20", 60);

    const detail = (await getAssetDetail(assetId, "1M", db, TODAY))!;
    expect(detail.series.map((p) => p.date)).toEqual(["2026-07-20"]);
  });
});
