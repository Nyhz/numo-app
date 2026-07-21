import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { getPeriodReturns, periodStartIso } from "../returns";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedValuations(db: DB, assetId: string, points: Array<[string, number]>) {
  db.insert(schema.assets)
    .values({ id: assetId, name: assetId, assetType: "etf", currency: "EUR" })
    .run();
  for (const [date, price] of points) {
    db.insert(schema.assetValuations)
      .values({
        id: `${assetId}_${date}`,
        assetId,
        valuationDate: date,
        quantity: 10,
        unitPriceEur: price,
        marketValueEur: price * 10,
        priceSource: "yahoo",
        createdAt: 1,
      })
      .run();
  }
}

describe("periodStartIso", () => {
  it("resta meses en UTC y YTD ancla al 31-dic anterior", () => {
    expect(periodStartIso("1m", "2026-07-08")).toBe("2026-06-08");
    expect(periodStartIso("3m", "2026-07-08")).toBe("2026-04-08");
    expect(periodStartIso("6m", "2026-07-08")).toBe("2026-01-08");
    expect(periodStartIso("1y", "2026-07-08")).toBe("2025-07-08");
    expect(periodStartIso("ytd", "2026-07-08")).toBe("2025-12-31");
    // desbordamiento de día: 31-mar − 1m cae en marzo (Date.UTC normaliza)
    expect(periodStartIso("1m", "2026-03-31")).toBe("2026-03-03");
  });
});

describe("getPeriodReturns", () => {
  it("calcula cada ventana con la última fila ≤ fecha de corte", async () => {
    const db = makeDb();
    seedValuations(db, "ast_1", [
      ["2025-12-31", 100],
      ["2026-06-05", 110], // baseline 1m (≤ 2026-06-08)
      ["2026-07-07", 121],
    ]);
    const map = await getPeriodReturns(["ast_1"], db, "2026-07-08");
    const r = map.get("ast_1")!;
    expect(r["1m"]).toBeCloseTo(0.1, 10); // 121/110 − 1
    expect(r.ytd).toBeCloseTo(0.21, 10); // 121/100 − 1
    // El corte 3m (2026-04-08) cae DESPUÉS del ancla YTD (2025-12-31), así que
    // la misma fila de 2025-12-31 es también la última fila ≤ corte 3m.
    expect(r["3m"]).toBeCloseTo(0.21, 10); // 121/100 − 1, mismo baseline que YTD
    expect(r["1y"]).toBeNull(); // corte 1y (2025-07-08) es anterior a toda la serie
  });

  it("una ventana que cruza un contra-split mide el movimiento real, no el salto ×M/N", async () => {
    const db = makeDb();
    // Amper-like: 0.20 € pre-canje, contra-split 1:25 el 2026-07-20, 5.181 € después.
    seedValuations(db, "ast_split", [
      ["2026-06-19", 0.2], // ≤ corte 1m (2026-06-21) → baseline de la ventana
      ["2026-07-17", 0.207],
      ["2026-07-20", 5.181],
    ]);
    db.insert(schema.accounts)
      .values({ id: "acc_s", name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 })
      .run();
    db.insert(schema.assetTransactions).values({
      id: "txn_split", accountId: "acc_s", assetId: "ast_split",
      transactionType: "split", tradedAt: Date.UTC(2026, 6, 20),
      splitNumerator: 1, splitDenominator: 25,
      quantity: 0, unitPrice: 0, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 0, tradeGrossAmountEur: 0, cashImpactEur: 0,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 0,
      isListed: false, source: "manual",
    }).run();

    const map = await getPeriodReturns(["ast_split"], db, "2026-07-21");
    const r = map.get("ast_split")!;
    // Baseline 1m = 0.20 € → 5.00 € retro-ajustado; 5.181/5.00 − 1 ≈ +3.62%,
    // no el +2.490% que daría el precio crudo.
    expect(r["1m"]).toBeCloseTo(5.181 / 5.0 - 1, 10);
  });

  it("activo sin valoraciones → todas null; ids vacíos → mapa vacío", async () => {
    const db = makeDb();
    db.insert(schema.assets)
      .values({ id: "ast_2", name: "n", assetType: "stock", currency: "EUR" })
      .run();
    const map = await getPeriodReturns(["ast_2"], db, "2026-07-08");
    expect(map.get("ast_2")).toEqual({ "1m": null, "3m": null, "6m": null, ytd: null, "1y": null });
    expect((await getPeriodReturns([], db)).size).toBe(0);
  });
});
