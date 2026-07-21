import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { backAdjustFactor, loadSplitEvents, type SplitEvent } from "../splitAdjust";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("backAdjustFactor", () => {
  const contraSplit: SplitEvent[] = [
    { effectiveIso: "2026-07-20", numerator: 1, denominator: 25 },
  ];

  it("multiplica ×M/N los días anteriores al canje y deja intactos los posteriores", () => {
    // 0.207 € pre-canje ≈ 5.175 € en unidades post-canje.
    expect(backAdjustFactor(contraSplit, "2026-07-17")).toBe(25);
    // El día efectivo ya cotiza post-canje (fila split a las 00:00).
    expect(backAdjustFactor(contraSplit, "2026-07-20")).toBe(1);
    expect(backAdjustFactor(contraSplit, "2026-07-21")).toBe(1);
  });

  it("sin canjes (o lista ausente) el factor es 1", () => {
    expect(backAdjustFactor(undefined, "2026-01-01")).toBe(1);
    expect(backAdjustFactor([], "2026-01-01")).toBe(1);
  });

  it("compone varios canjes en cadena", () => {
    const splits: SplitEvent[] = [
      { effectiveIso: "2025-01-10", numerator: 4, denominator: 1 }, // split 4:1
      { effectiveIso: "2026-07-20", numerator: 1, denominator: 25 }, // contra 1:25
    ];
    // Antes de ambos: ×(1/4)×25; entre ambos: ×25; después: 1.
    expect(backAdjustFactor(splits, "2024-12-31")).toBeCloseTo(6.25, 12);
    expect(backAdjustFactor(splits, "2025-06-01")).toBe(25);
    expect(backAdjustFactor(splits, "2026-07-20")).toBe(1);
  });
});

describe("loadSplitEvents", () => {
  it("devuelve solo filas split válidas, por activo y en orden", () => {
    const db = makeDb();
    const accountId = ulid();
    const assetId = ulid();
    db.insert(schema.accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(schema.assets).values({ id: assetId, name: "AMPER SA", assetType: "stock", currency: "EUR" }).run();
    const base = {
      accountId, assetId, quantity: 0, unitPrice: 0,
      tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 0, tradeGrossAmountEur: 0, cashImpactEur: 0,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 0,
      isListed: false, source: "manual",
    };
    db.insert(schema.assetTransactions).values({
      ...base, id: ulid(), transactionType: "split",
      tradedAt: Date.UTC(2026, 6, 20), splitNumerator: 1, splitDenominator: 25,
    }).run();
    // Fila corrupta (sin factor) — debe ignorarse, nunca tratarse como ×0.
    db.insert(schema.assetTransactions).values({
      ...base, id: ulid(), transactionType: "split",
      tradedAt: Date.UTC(2026, 6, 21),
    }).run();

    const map = loadSplitEvents(db, [assetId]);
    expect(map.get(assetId)).toEqual([
      { effectiveIso: "2026-07-20", numerator: 1, denominator: 25 },
    ]);
    expect(loadSplitEvents(db, []).size).toBe(0);
  });
});
