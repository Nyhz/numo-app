import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { getSectorAllocation, getSectorWeightingsForAsset } from "../sectors";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedAsset(
  db: DB,
  name: string,
  assetType: string,
  subtype?: string,
): string {
  const id = ulid();
  db.insert(schema.assets)
    .values({ id, name, assetType, subtype: subtype ?? null })
    .run();
  return id;
}

/** Seed a position valued at `valueEur` (1 unit priced at valueEur). */
function seedValued(db: DB, assetId: string, valueEur: number): void {
  db.insert(schema.assetPositions)
    .values({
      id: ulid(),
      assetId,
      quantity: 1,
      averageCost: valueEur,
      averageCostNative: valueEur,
      totalCostNative: valueEur,
      totalCostEur: valueEur,
    })
    .run();
  db.insert(schema.assetValuations)
    .values({
      id: ulid(),
      assetId,
      valuationDate: "2026-06-13",
      quantity: 1,
      unitPriceEur: valueEur,
      marketValueEur: valueEur,
      priceSource: "rebuilt",
    })
    .run();
}

function seedSector(
  db: DB,
  assetId: string,
  sector: string,
  weight: number,
  fetchedAt = 1000,
): void {
  db.insert(schema.assetSectorWeightings)
    .values({
      id: ulid(),
      assetId,
      sector,
      weight,
      source: "yahoo",
      fetchedAt,
    })
    .run();
}

describe("getSectorAllocation", () => {
  let db: DB;

  beforeEach(() => {
    db = makeDb();
  });

  it("returns empty on a fresh DB", async () => {
    const result = await getSectorAllocation(db);
    expect(result.slices).toEqual([]);
    expect(result.totalEur).toBe(0);
    expect(result.asOf).toBeNull();
  });

  it("weights each fund's sectors by its EUR market value", async () => {
    // ETF A: 10.000 € → 60% tech, 40% financials
    const a = seedAsset(db, "A", "etf");
    seedValued(db, a, 10000);
    seedSector(db, a, "technology", 0.6);
    seedSector(db, a, "financial_services", 0.4);
    // ETF B: 5.000 € → 100% tech
    const b = seedAsset(db, "B", "etf");
    seedValued(db, b, 5000);
    seedSector(db, b, "technology", 1);

    const result = await getSectorAllocation(db);
    expect(result.totalEur).toBe(15000);
    expect(result.unclassifiedEur).toBe(0);
    const tech = result.slices.find((s) => s.sector === "technology");
    const fin = result.slices.find((s) => s.sector === "financial_services");
    // tech = 0.6*10000 + 1*5000 = 11000; fin = 4000
    expect(tech?.valueEur).toBeCloseTo(11000);
    expect(fin?.valueEur).toBeCloseTo(4000);
    expect(tech?.weight).toBeCloseTo(11000 / 15000);
    // biggest sector first
    expect(result.slices[0]?.sector).toBe("technology");
  });

  it("buckets crypto and commodities as their own categories, not equity", async () => {
    const etf = seedAsset(db, "ETF", "etf");
    seedValued(db, etf, 8000);
    seedSector(db, etf, "technology", 1);
    const crypto = seedAsset(db, "BTC", "crypto");
    seedValued(db, crypto, 1000); // no sector rows → "crypto" category
    const gold = seedAsset(db, "Gold", "etf", "commodity");
    seedValued(db, gold, 3000); // subtype commodity → "commodities" category

    const result = await getSectorAllocation(db);
    expect(result.totalEur).toBe(12000);
    // Both non-equity classes count as classified, not "Sin clasificar".
    expect(result.unclassifiedEur).toBe(0);
    expect(result.classifiedEur).toBe(12000);
    expect(result.slices.find((s) => s.sector === "crypto")?.valueEur).toBe(1000);
    expect(result.slices.find((s) => s.sector === "commodities")?.valueEur).toBe(
      3000,
    );
    expect(result.slices.some((s) => s.sector === "unclassified")).toBe(false);
  });

  it("classifies an individual stock by its single stored sector", async () => {
    const stock = seedAsset(db, "AMP", "stock");
    seedValued(db, stock, 2000);
    seedSector(db, stock, "technology", 1);
    const result = await getSectorAllocation(db);
    expect(result.slices.find((s) => s.sector === "technology")?.valueEur).toBe(
      2000,
    );
    expect(result.unclassifiedEur).toBe(0);
  });

  it("routes value with no sector and no category to 'unclassified', last", async () => {
    const etf = seedAsset(db, "ETF", "etf");
    seedValued(db, etf, 8000);
    seedSector(db, etf, "technology", 1);
    const stock = seedAsset(db, "Stock", "stock");
    seedValued(db, stock, 2000); // stock with no sector row → unclassified

    const result = await getSectorAllocation(db);
    expect(result.totalEur).toBe(10000);
    expect(result.unclassifiedEur).toBe(2000);
    expect(result.classifiedEur).toBe(8000);
    expect(result.slices.at(-1)?.sector).toBe("unclassified");
    expect(result.slices.at(-1)?.valueEur).toBe(2000);
  });

  it("treats a fund's non-equity sleeve as unclassified remainder", async () => {
    const fund = seedAsset(db, "Mixed", "fund");
    seedValued(db, fund, 1000);
    seedSector(db, fund, "technology", 0.7); // only 70% covered
    const result = await getSectorAllocation(db);
    expect(result.unclassifiedEur).toBeCloseTo(300);
    const tech = result.slices.find((s) => s.sector === "technology");
    expect(tech?.valueEur).toBeCloseTo(700);
  });

  it("reports the newest fetchedAt as asOf", async () => {
    const a = seedAsset(db, "A", "etf");
    seedValued(db, a, 1000);
    seedSector(db, a, "technology", 1, 5000);
    const b = seedAsset(db, "B", "etf");
    seedValued(db, b, 1000);
    seedSector(db, b, "energy", 1, 9000);
    const result = await getSectorAllocation(db);
    expect(result.asOf).toBe(9000);
  });
});

describe("getSectorWeightingsForAsset", () => {
  let db: DB;

  beforeEach(() => {
    db = makeDb();
  });

  it("devuelve slices ordenadas por peso desc con asOf más reciente", async () => {
    const etf = seedAsset(db, "World", "etf");
    seedSector(db, etf, "technology", 0.3, 2000);
    seedSector(db, etf, "financial_services", 0.5, 5000);
    seedSector(db, etf, "energy", 0.2, 1000);
    const result = await getSectorWeightingsForAsset(etf, db);
    expect(result.slices.map((s) => s.label)).toEqual([
      "financial_services", "technology", "energy",
    ]);
    expect(result.slices[0].weight).toBeCloseTo(0.5);
    expect(result.asOf).toBe(5000);
  });

  it("activo sin composición → vacío", async () => {
    const stock = seedAsset(db, "Solo", "stock");
    const result = await getSectorWeightingsForAsset(stock, db);
    expect(result.slices).toEqual([]);
    expect(result.asOf).toBeNull();
  });
});
