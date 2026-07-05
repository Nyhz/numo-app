import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { getNetWorthSeries } from "../overview";
import { invalidateDailyBalancesFrom, rebuildDailyBalances } from "../dailyBalances";

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

/** Broker con caja de apertura + un ETF comprado y valorado varios días
 *  laborables; un ingreso a mitad de serie. */
function seedPortfolio(db: DB) {
  db.insert(schema.accounts)
    .values({
      id: "acc_1",
      name: "Broker",
      currency: "EUR",
      accountType: "broker",
      openingBalanceEur: 100,
      currentCashBalanceEur: 150,
    })
    .run();
  db.insert(schema.assets)
    .values({ id: "ast_1", name: "MSCI World", assetType: "etf", currency: "EUR" })
    .run();
  db.insert(schema.assetTransactions)
    .values({
      id: "trd_1",
      accountId: "acc_1",
      assetId: "ast_1",
      transactionType: "buy",
      tradedAt: noonMs("2026-01-05"),
      quantity: 10,
      unitPrice: 100,
      tradeCurrency: "EUR",
      fxRateToEur: 1,
      tradeGrossAmount: 1000,
      tradeGrossAmountEur: 1000,
      cashImpactEur: -1000,
      netAmountEur: -1000,
    })
    .run();
  // Lunes 05 a viernes 09 (2026-01-05 es lunes).
  const values = [1000, 1010, 990, 1020, 1030];
  ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"].forEach(
    (iso, i) => {
      db.insert(schema.assetValuations)
        .values({
          id: `val_${iso}`,
          assetId: "ast_1",
          valuationDate: iso,
          quantity: 10,
          unitPriceEur: values[i] / 10,
          marketValueEur: values[i],
          priceSource: "rebuilt",
        })
        .run();
    },
  );
  // Ingreso de 50 € el miércoles.
  db.insert(schema.accountCashMovements)
    .values({
      id: "mov_1",
      accountId: "acc_1",
      movementType: "deposit",
      occurredAt: noonMs("2026-01-07"),
      nativeAmount: 50,
      currency: "EUR",
      fxRateToEur: 1,
      cashImpactEur: 50,
      affectsCashBalance: true,
      rowFingerprint: "fp_mov_1",
    })
    .run();
}

describe("rebuildDailyBalances", () => {
  it("materializa la serie: Σ investedEur por fecha == serie viva de la home", async () => {
    const db = makeDb();
    seedPortfolio(db);

    // Serie viva ANTES de materializar (camino de cómputo completo).
    const live = await getNetWorthSeries({ range: "ALL" }, db);
    expect(live.length).toBe(5);

    rebuildDailyBalances(db);

    const rows = db
      .select()
      .from(schema.dailyBalances)
      .orderBy(asc(schema.dailyBalances.balanceDate))
      .all();
    expect(rows.length).toBeGreaterThan(0);

    const sumByDate = new Map<string, number>();
    for (const r of rows) {
      sumByDate.set(r.balanceDate, (sumByDate.get(r.balanceDate) ?? 0) + r.investedEur);
    }
    for (const point of live) {
      expect(sumByDate.get(point.date)).toBeCloseTo(point.valueEur, 2);
    }
  });

  it("balanceEur es la caja a fin de día (apertura + movimientos acumulados)", () => {
    const db = makeDb();
    seedPortfolio(db);
    rebuildDailyBalances(db);

    const rows = db
      .select()
      .from(schema.dailyBalances)
      .orderBy(asc(schema.dailyBalances.balanceDate))
      .all();
    const byDate = new Map(rows.map((r) => [r.balanceDate, r.balanceEur]));
    expect(byDate.get("2026-01-05")).toBeCloseTo(100); // solo apertura
    expect(byDate.get("2026-01-06")).toBeCloseTo(100);
    expect(byDate.get("2026-01-07")).toBeCloseTo(150); // +50 del ingreso
    expect(byDate.get("2026-01-09")).toBeCloseTo(150);
  });

  it("es idempotente: dos rebuilds seguidos dejan las mismas filas", () => {
    const db = makeDb();
    seedPortfolio(db);
    rebuildDailyBalances(db);
    const first = db.select().from(schema.dailyBalances).all();
    rebuildDailyBalances(db);
    const second = db.select().from(schema.dailyBalances).all();
    const project = (rows: typeof first) =>
      rows
        .map((r) => ({ a: r.accountId, d: r.balanceDate, b: r.balanceEur, i: r.investedEur }))
        .sort((x, y) => x.d.localeCompare(y.d));
    expect(project(second)).toEqual(project(first));
  });
});

describe("invalidateDailyBalancesFrom + lectura con fallback", () => {
  it("borra delete-forward y la serie de la home sigue siendo correcta (fallback vivo)", async () => {
    const db = makeDb();
    seedPortfolio(db);
    const live = await getNetWorthSeries({ range: "ALL" }, db);

    rebuildDailyBalances(db);
    invalidateDailyBalancesFrom(db, "2026-01-08");

    const remaining = db.select().from(schema.dailyBalances).all();
    expect(remaining.every((r) => r.balanceDate < "2026-01-08")).toBe(true);

    // La tabla está incompleta (max balance_date < max valuation_date) → el
    // lector debe caer al cómputo vivo y devolver la serie íntegra.
    const after = await getNetWorthSeries({ range: "1Y" }, db);
    const liveByDate = new Map(live.map((p) => [p.date, p.valueEur]));
    for (const p of after) {
      expect(p.valueEur).toBeCloseTo(liveByDate.get(p.date) ?? NaN, 2);
    }
  });

  it("con la tabla fresca la home sirve la serie materializada (paridad exacta)", async () => {
    const db = makeDb();
    seedPortfolio(db);
    const live = await getNetWorthSeries({ range: "ALL" }, db);
    rebuildDailyBalances(db);
    // Rango distinto para esquivar el memo de cache() del primer cómputo.
    const materialized = await getNetWorthSeries({ range: "1Y" }, db);
    expect(materialized.length).toBe(live.length);
    live.forEach((p, i) => {
      expect(materialized[i].date).toBe(p.date);
      expect(materialized[i].valueEur).toBeCloseTo(p.valueEur, 2);
      expect(materialized[i].investedEur).toBeCloseTo(p.investedEur, 2);
      expect(materialized[i].performanceIndex).toBeCloseTo(p.performanceIndex, 6);
    });
  });
});
