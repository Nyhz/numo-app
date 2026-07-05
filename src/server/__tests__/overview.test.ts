import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { getNetWorthSeries, getOverviewKpis } from "../overview";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function noonMs(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getTime();
}

function seedAccount(db: DB) {
  db.insert(schema.accounts)
    .values({ id: "acc_1", name: "Broker", currency: "EUR", accountType: "broker" })
    .run();
}

function seedTrade(
  db: DB,
  id: string,
  assetId: string,
  type: "buy" | "sell",
  iso: string,
  quantity: number,
  amountEur: number,
) {
  const sign = type === "buy" ? -1 : 1;
  db.insert(schema.assetTransactions)
    .values({
      id,
      accountId: "acc_1",
      assetId,
      transactionType: type,
      tradedAt: noonMs(iso),
      quantity,
      unitPrice: amountEur / quantity,
      tradeCurrency: "EUR",
      fxRateToEur: 1,
      tradeGrossAmount: amountEur,
      tradeGrossAmountEur: amountEur,
      cashImpactEur: sign * amountEur,
      netAmountEur: sign * amountEur,
    })
    .run();
}

function seedValuation(db: DB, assetId: string, iso: string, quantity: number, valueEur: number) {
  db.insert(schema.assetValuations)
    .values({
      id: `val_${assetId}_${iso}`,
      assetId,
      valuationDate: iso,
      quantity,
      unitPriceEur: valueEur / quantity,
      marketValueEur: valueEur,
      priceSource: "rebuilt",
    })
    .run();
}

describe("getNetWorthSeries — sold-out positions", () => {
  it("stops carrying a sold asset's last value past the sale date", async () => {
    const db = makeDb();
    seedAccount(db);
    db.insert(schema.assets)
      .values([
        { id: "ast_open", name: "OPEN", assetType: "stock", currency: "EUR" },
        { id: "ast_sold", name: "SOLD", assetType: "stock", currency: "EUR" },
      ])
      .run();

    // Mon 2026-01-05 .. Thu 2026-01-08, all weekdays.
    seedTrade(db, "tx_b1", "ast_open", "buy", "2026-01-05", 1, 100);
    seedTrade(db, "tx_b2", "ast_sold", "buy", "2026-01-05", 1, 50);
    // Full exit on the 8th — the rebuild writes no valuation row that day.
    seedTrade(db, "tx_s1", "ast_sold", "sell", "2026-01-08", 1, 50);

    for (const iso of ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]) {
      seedValuation(db, "ast_open", iso, 1, 100);
    }
    for (const iso of ["2026-01-05", "2026-01-06", "2026-01-07"]) {
      seedValuation(db, "ast_sold", iso, 1, 50);
    }

    const series = await getNetWorthSeries({ range: "ALL" }, db);
    const byDate = new Map(series.map((p) => [p.date, p]));

    expect(byDate.get("2026-01-07")?.valueEur).toBe(150);
    // Before the fix this forward-filled to 150 (stale 50 from the sold asset).
    expect(byDate.get("2026-01-08")?.valueEur).toBe(100);

    // TWR: the sale is a -50 contribution offset by the -50 value drop, so
    // the index must stay flat — selling is not a gain.
    expect(byDate.get("2026-01-08")?.performanceIndex).toBeCloseTo(100, 6);
  });

  it("una retirada (transfer_out) deja de aportar valor sin contar como pérdida TWR", async () => {
    const db = makeDb();
    seedAccount(db);
    db.insert(schema.assets)
      .values([
        { id: "ast_open", name: "OPEN", assetType: "stock", currency: "EUR" },
        { id: "ast_out", name: "OUT", assetType: "stock", currency: "EUR" },
      ])
      .run();

    seedTrade(db, "tx_b1", "ast_open", "buy", "2026-01-05", 1, 100);
    seedTrade(db, "tx_b2", "ast_out", "buy", "2026-01-05", 1, 50);
    // Retirada total el jueves 8: mismas mecánicas de flujo que una venta
    // (cashImpactEur = +valor) pero sin par fiscal.
    db.insert(schema.assetTransactions)
      .values({
        id: "tx_t1",
        accountId: "acc_1",
        assetId: "ast_out",
        transactionType: "transfer_out",
        tradedAt: noonMs("2026-01-08"),
        quantity: 1,
        unitPrice: 50,
        tradeCurrency: "EUR",
        fxRateToEur: 1,
        tradeGrossAmount: 50,
        tradeGrossAmountEur: 50,
        cashImpactEur: 50,
        netAmountEur: 50,
      })
      .run();

    for (const iso of ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]) {
      seedValuation(db, "ast_open", iso, 1, 100);
    }
    for (const iso of ["2026-01-05", "2026-01-06", "2026-01-07"]) {
      seedValuation(db, "ast_out", iso, 1, 50);
    }

    const series = await getNetWorthSeries({ range: "ALL" }, db);
    const byDate = new Map(series.map((p) => [p.date, p]));

    expect(byDate.get("2026-01-07")?.valueEur).toBe(150);
    // El valor retirado no puede arrastrarse a fechas posteriores…
    expect(byDate.get("2026-01-08")?.valueEur).toBe(100);
    // …ni leerse como pérdida: la salida es un flujo, el índice queda plano.
    expect(byDate.get("2026-01-08")?.performanceIndex).toBeCloseTo(100, 6);
  });

  it("still forward-fills weekend gaps for open positions", async () => {
    const db = makeDb();
    seedAccount(db);
    db.insert(schema.assets)
      .values([
        { id: "ast_stock", name: "STOCK", assetType: "stock", currency: "EUR" },
        { id: "ast_btc", name: "BTC", assetType: "crypto", currency: "EUR" },
      ])
      .run();

    seedTrade(db, "tx_b1", "ast_stock", "buy", "2026-01-09", 1, 100);
    seedTrade(db, "tx_b2", "ast_btc", "buy", "2026-01-09", 1, 200);

    // Fri 2026-01-09 + Mon 2026-01-12 for the stock; crypto trades the weekend.
    seedValuation(db, "ast_stock", "2026-01-09", 1, 100);
    seedValuation(db, "ast_stock", "2026-01-12", 1, 100);
    for (const iso of ["2026-01-09", "2026-01-10", "2026-01-11", "2026-01-12"]) {
      seedValuation(db, "ast_btc", iso, 1, 200);
    }

    const series = await getNetWorthSeries({ range: "ALL" }, db);
    const byDate = new Map(series.map((p) => [p.date, p.valueEur]));

    // Saturday keeps the stock's Friday value — qty > 0, the gap is a market
    // holiday, not a closed position.
    expect(byDate.get("2026-01-10")).toBe(300);
    expect(byDate.get("2026-01-11")).toBe(300);
  });

  it("keeps the asset out across a closed gap and back in after a re-buy", async () => {
    const db = makeDb();
    seedAccount(db);
    db.insert(schema.assets)
      .values([
        { id: "ast_a", name: "A", assetType: "stock", currency: "EUR" },
        { id: "ast_b", name: "B", assetType: "stock", currency: "EUR" },
      ])
      .run();

    seedTrade(db, "tx_b1", "ast_a", "buy", "2026-01-05", 1, 100);
    seedTrade(db, "tx_b2", "ast_b", "buy", "2026-01-05", 1, 50);
    seedTrade(db, "tx_s1", "ast_b", "sell", "2026-01-06", 1, 50);
    seedTrade(db, "tx_b3", "ast_b", "buy", "2026-01-08", 1, 60);

    for (const iso of ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]) {
      seedValuation(db, "ast_a", iso, 1, 100);
    }
    seedValuation(db, "ast_b", "2026-01-05", 1, 50);
    // closed 06–07: no rows; reopened on the 8th.
    seedValuation(db, "ast_b", "2026-01-08", 1, 60);
    seedValuation(db, "ast_b", "2026-01-09", 1, 60);

    const series = await getNetWorthSeries({ range: "ALL" }, db);
    const byDate = new Map(series.map((p) => [p.date, p.valueEur]));

    expect(byDate.get("2026-01-05")).toBe(150);
    expect(byDate.get("2026-01-06")).toBe(100); // sold same day → out
    expect(byDate.get("2026-01-07")).toBe(100); // stays out while closed
    expect(byDate.get("2026-01-08")).toBe(160); // re-bought → back in
    expect(byDate.get("2026-01-09")).toBe(160);
  });
});

describe("getNetWorthSeries — cost fallback for unpriced holdings", () => {
  it("values a held asset with no valuation at cost so market value tracks invested", async () => {
    const db = makeDb();
    seedAccount(db);
    db.insert(schema.assets)
      .values({ id: "ast_grp", name: "Groupama", assetType: "fund", currency: "EUR" })
      .run();
    // Bought, but no market valuation exists yet (fresh fund, NAV lag).
    seedTrade(db, "tx_grp", "ast_grp", "buy", "2026-01-05", 2, 7697.3);

    const series = await getNetWorthSeries({ range: "ALL" }, db);
    expect(series.length).toBeGreaterThan(0);
    const p = series.find((s) => s.date === "2026-01-05");
    expect(p).toBeDefined();
    // Market-value line must equal invested (cost), not 0 → no phantom loss.
    expect(p!.valueEur).toBeCloseTo(7697.3, 2);
    expect(p!.investedEur).toBeCloseTo(7697.3, 2);
  });

  it("prefers a real valuation over cost once one exists", async () => {
    const db = makeDb();
    seedAccount(db);
    db.insert(schema.assets)
      .values({ id: "ast_grp", name: "Groupama", assetType: "fund", currency: "EUR" })
      .run();
    seedTrade(db, "tx_grp", "ast_grp", "buy", "2026-01-05", 2, 7697.3);
    seedValuation(db, "ast_grp", "2026-01-05", 2, 7800); // real NAV that day

    const series = await getNetWorthSeries({ range: "ALL" }, db);
    const p = series.find((s) => s.date === "2026-01-05");
    expect(p!.valueEur).toBeCloseTo(7800, 2); // market value wins, not cost
  });

  it("bridges the gap between a buy and the first real valuation at cost (no phantom dip)", async () => {
    const db = makeDb();
    seedAccount(db);
    // Crypto holds the daily date axis (mirrors prod: weekends present), so the
    // gap days exist as chart points.
    db.insert(schema.assets)
      .values({ id: "ast_btc", name: "BTC", assetType: "crypto", currency: "EUR" })
      .run();
    seedTrade(db, "tx_btc", "ast_btc", "buy", "2026-01-05", 1, 1000);
    for (const d of ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]) {
      seedValuation(db, "ast_btc", d, 1, 1000);
    }
    // Fund bought 01-05, but FT publishes its first NAV only on 01-08 →
    // 01-06/01-07 have no valuation row at all (exactly the Groupama case).
    db.insert(schema.assets)
      .values({ id: "ast_grp", name: "Groupama", assetType: "fund", currency: "EUR" })
      .run();
    seedTrade(db, "tx_grp", "ast_grp", "buy", "2026-01-05", 2, 7697.3);
    seedValuation(db, "ast_grp", "2026-01-08", 2, 7710);

    const series = await getNetWorthSeries({ range: "ALL" }, db);
    // Held days before the first NAV carry the fund at cost (1000 + 7697.3),
    // matching the contribution that already counts it → no phantom dip.
    for (const d of ["2026-01-05", "2026-01-06", "2026-01-07"]) {
      const p = series.find((s) => s.date === d);
      expect(p, d).toBeDefined();
      expect(p!.valueEur, d).toBeCloseTo(8697.3, 2);
    }
    // Once the real NAV lands it takes over (1000 + 7710).
    const last = series.find((s) => s.date === "2026-01-08");
    expect(last!.valueEur).toBeCloseTo(8710, 2);
  });
});

describe("getOverviewKpis — % de plusvalía latente", () => {
  it("el % es (mercado − coste) / coste, no la rentabilidad TWR de la serie", async () => {
    const db = makeDb();
    seedAccount(db);
    db.insert(schema.assets)
      .values([
        { id: "ast_hold", name: "HOLD", assetType: "stock", currency: "EUR" },
        { id: "ast_gone", name: "GONE", assetType: "stock", currency: "EUR" },
      ])
      .run();

    // HOLD: comprado a 100, hoy vale 80 → latente -20 € (-20 %).
    seedTrade(db, "tx_h1", "ast_hold", "buy", "2026-01-05", 1, 100);
    db.insert(schema.assetPositions)
      .values({
        id: "pos_hold", assetId: "ast_hold", quantity: 1,
        averageCost: 100, averageCostNative: 100,
        totalCostNative: 100, totalCostEur: 100,
      })
      .run();
    // GONE: pérdida REALIZADA enorme que hunde el TWR de la serie pero no
    // debe contaminar el % latente de lo que sigue abierto.
    seedTrade(db, "tx_g1", "ast_gone", "buy", "2026-01-05", 1, 100);
    seedTrade(db, "tx_g2", "ast_gone", "sell", "2026-01-07", 1, 10);

    seedValuation(db, "ast_hold", "2026-01-05", 1, 100);
    seedValuation(db, "ast_hold", "2026-01-06", 1, 90);
    seedValuation(db, "ast_hold", "2026-01-07", 1, 80);
    seedValuation(db, "ast_gone", "2026-01-05", 1, 100);
    seedValuation(db, "ast_gone", "2026-01-06", 1, 50);

    const kpis = await getOverviewKpis({ range: "ALL" }, db);

    expect(kpis.unrealizedPnlEur).toBeCloseTo(-20, 2);
    // Antes del fix esto devolvía el TWR (≈ -55 %) — incoherente con la
    // etiqueta «Sobre el coste de compra» y con las filas de posiciones.
    expect(kpis.unrealizedPnlPct).toBeCloseTo(-0.2, 6);
  });
});
