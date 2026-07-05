import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ulid } from "ulid";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import { mortgages, properties, propertyValuations } from "../../db/schema";
import type { DB } from "../../db/client";
import {
  getRealEstateEquityAt,
  getRealEstateEquityByDate,
  getRealEstateOverview,
  getStatementRealEstate,
} from "../realEstate";
import { getOverviewKpis } from "../overview";
import { getStatementReport } from "../statement";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

// Fechas en PASADO respecto a cualquier ejecución (el plan se ejecuta en
// 2026-07+): los tests de integración usan el reloj real vía todayIsoLocal(),
// y un inmueble con purchaseDate futura contribuiría equity 0.
function seedCanon(db: DB): { propertyId: string } {
  const propertyId = ulid();
  db.insert(properties)
    .values({
      id: propertyId,
      name: "Vivienda habitual",
      purchaseDate: "2026-01-10",
      purchasePriceEur: 193_000,
      purchaseCostsEur: 4_000,
    })
    .run();
  db.insert(mortgages)
    .values({
      id: ulid(),
      propertyId,
      principalEur: 150_000,
      rateType: "fixed",
      nominalRatePct: 2.5,
      termMonths: 300,
      firstPaymentDate: "2026-02-01",
    })
    .run();
  return { propertyId };
}

describe("realEstate — lecturas", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("DB vacía ⇒ overview a cero", async () => {
    const o = await getRealEstateOverview(db);
    expect(o).toEqual({
      totalValueEur: 0,
      totalOutstandingEur: 0,
      totalEquityEur: 0,
      properties: [],
    });
  });

  it("caso canónico el día de compra: equity +43k", async () => {
    seedCanon(db);
    const o = await getRealEstateOverview(db, "2026-01-10");
    expect(o.totalEquityEur).toBe(43_000);
    const p = o.properties[0];
    expect(p.currentValueEur).toBe(193_000);
    expect(p.currentValueAsOf).toBeNull();
    expect(p.outstandingEur).toBe(150_000);
    expect(p.ownedPct).toBeCloseTo(43_000 / 193_000, 6);
    expect(p.loan?.paymentEur).toBe(672.93);
    expect(p.loan?.endDate).toBe("2051-01-01");
  });

  it("inmueble sin hipoteca: equity = valor vigente", async () => {
    const propertyId = ulid();
    db.insert(properties)
      .values({
        id: propertyId,
        name: "Plaza de garaje",
        purchaseDate: "2026-01-10",
        purchasePriceEur: 18_000,
        purchaseCostsEur: 0,
      })
      .run();
    const o = await getRealEstateOverview(db, "2026-06-01");
    expect(o.totalEquityEur).toBe(18_000);
    expect(o.properties[0].loan).toBeNull();
  });

  it("una valoración posterior mueve el equity desde su fecha", async () => {
    const { propertyId } = seedCanon(db);
    // Día 15: sin cuota (las cuotas caen el 1) — la diferencia es SOLO la valoración.
    db.insert(propertyValuations)
      .values({ id: ulid(), propertyId, valuationDate: "2028-05-15", valueEur: 215_000 })
      .run();
    const before = await getRealEstateEquityAt("2028-05-14", db);
    const after = await getRealEstateEquityAt("2028-05-15", db);
    expect(after - before).toBeCloseTo(22_000, 2);
  });

  it("equity 0 antes de purchaseDate (serie histórica retroactiva)", async () => {
    seedCanon(db);
    const map = await getRealEstateEquityByDate(["2026-01-09", "2026-01-10"], db);
    expect(map.get("2026-01-09")).toBe(0);
    expect(map.get("2026-01-10")).toBe(43_000);
  });

  it("un inmueble no computa antes de su purchaseDate en el overview", async () => {
    seedCanon(db);
    const o = await getRealEstateOverview(db, "2026-01-09"); // día anterior a la compra
    expect(o.totalEquityEur).toBe(0);
    const p = o.properties[0];
    expect(p.currentValueEur).toBe(0);
    expect(p.outstandingEur).toBe(0);
    expect(p.equityEur).toBe(0);
    expect(p.loan).toBeNull();
  });

  it("líneas de extracto (asOf)", async () => {
    seedCanon(db);
    const { lines, totalEquityEur } = await getStatementRealEstate(db, "2026-01-10");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      name: "Vivienda habitual",
      valueEur: 193_000,
      valuationAsOf: null,
      outstandingEur: 150_000,
      equityEur: 43_000,
    });
    expect(totalEquityEur).toBe(43_000);
  });
});

describe("integración overview", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("el equity suma al patrimonio sin tocar P&L", async () => {
    const before = await getOverviewKpis({ range: "ALL" }, db);
    seedCanon(db);
    const after = await getOverviewKpis({ range: "ALL" }, db);
    expect(after.realEstateEquityEur).toBeGreaterThan(0);
    expect(after.totalNetWorthEur).toBeCloseTo(
      after.cashEur + after.investedMarketValueEur + after.realEstateEquityEur,
      2,
    );
    expect(after.unrealizedPnlEur).toBe(before.unrealizedPnlEur);
    expect(after.investedEur).toBe(before.investedEur);
  });

  it("con filtro de cuentas el equity queda fuera", async () => {
    seedCanon(db);
    const k = await getOverviewKpis({ range: "ALL", accountIds: ["acc-x"] }, db);
    expect(k.realEstateEquityEur).toBe(0);
  });
});

describe("integración extracto", () => {
  it("el informe incorpora inmuebles y el total sube exactamente el equity", async () => {
    const db = makeDb();
    const before = await getStatementReport(db);
    seedCanon(db);
    const after = await getStatementReport(db);
    // El camino vivo usa el reloj real: el equity exacto depende del día
    // (cuotas ya amortizadas), así que se asserta coherencia, no una cifra.
    expect(after.realEstate).toHaveLength(1);
    expect(after.totals.realEstateEquityEur).toBeGreaterThanOrEqual(43_000);
    expect(after.totals.netWorthEur).toBeCloseTo(
      before.totals.netWorthEur + after.totals.realEstateEquityEur,
      2,
    );
    expect(after.totals.investedMarketValueEur).toBe(before.totals.investedMarketValueEur);
  });
});
