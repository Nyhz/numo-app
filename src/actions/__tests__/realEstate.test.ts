import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import * as schema from "../../db/schema";
import { auditEvents, mortgageEvents, mortgages, properties } from "../../db/schema";
import type { DB } from "../../db/client";
import {
  addMortgageEvent,
  addValuation,
  createProperty,
  deleteProperty,
  setMortgageExpectedInterest,
} from "../realEstate";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

const CANON_INPUT = {
  name: "Vivienda habitual",
  purchaseDate: "2026-08-20",
  purchasePriceEur: 193_000,
  purchaseCostsEur: 4_000,
  mortgage: {
    principalEur: 150_000,
    rateType: "fixed" as const,
    nominalRatePct: 2.5,
    termMonths: 300,
    firstPaymentDate: "2026-09-01",
  },
};

describe("acciones real-estate", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("createProperty: inmueble + hipoteca en una transacción, con audit", async () => {
    const res = await createProperty(CANON_INPUT, db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(db.select().from(properties).all()).toHaveLength(1);
    expect(db.select().from(mortgages).all()).toHaveLength(1);
    const audits = db.select().from(auditEvents).all();
    expect(audits.map((a) => a.entityType).sort()).toEqual(["mortgage", "property"]);
  });

  it("createProperty: rechaza input inválido sin tocar la DB", async () => {
    const res = await createProperty({ ...CANON_INPUT, purchasePriceEur: -1 }, db);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("validation");
    expect(db.select().from(properties).all()).toHaveLength(0);
  });

  it("addValuation: fecha duplicada ⇒ error controlado (unique index)", async () => {
    const created = await createProperty(CANON_INPUT, db);
    if (!created.ok) throw new Error("seed");
    const propertyId = created.data.property.id;
    const v = { propertyId, valuationDate: "2028-05-01", valueEur: 215_000 };
    expect((await addValuation(v, db)).ok).toBe(true);
    const dup = await addValuation(v, db);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("db");
  });

  it("addMortgageEvent: amortización mayor que el pendiente ⇒ conflict", async () => {
    const created = await createProperty(CANON_INPUT, db);
    if (!created.ok) throw new Error("seed");
    const mortgageId = created.data.mortgage!.id;
    const res = await addMortgageEvent(
      { type: "early_repayment", mortgageId, eventDate: "2027-01-15", amountEur: 999_999, mode: "reduce_term" },
      db,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("conflict");
  });

  it("addMortgageEvent: evento anterior a la primera cuota ⇒ conflict", async () => {
    const created = await createProperty(CANON_INPUT, db);
    if (!created.ok) throw new Error("seed");
    const mortgageId = created.data.mortgage!.id;
    const res = await addMortgageEvent(
      { type: "rate_change", mortgageId, eventDate: "2026-08-25", newRatePct: 3 },
      db,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("conflict");
  });

  it("addMortgageEvent payment_override: persiste amountEur como cuota", async () => {
    const created = await createProperty(CANON_INPUT, db);
    if (!created.ok) throw new Error("seed");
    const mortgageId = created.data.mortgage!.id;
    const res = await addMortgageEvent(
      { type: "payment_override", mortgageId, eventDate: "2026-09-01", amountEur: 410, note: "primera cuota prorrateada" },
      db,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({
      type: "payment_override",
      amountEur: 410,
      mode: null,
      newRatePct: null,
    });
  });

  it("addMortgageEvent payment_override: cuota que no cubre intereses ⇒ conflict amistoso", async () => {
    const created = await createProperty(CANON_INPUT, db);
    if (!created.ok) throw new Error("seed");
    const mortgageId = created.data.mortgage!.id;
    // Interés del primer mes = 150k × 2,5 %/12 = 312,50 € → 300 € nunca amortiza.
    const res = await addMortgageEvent(
      { type: "payment_override", mortgageId, eventDate: "2026-09-01", amountEur: 300 },
      db,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("conflict");
      expect(res.error.message).toMatch(/no cubre los intereses/);
    }
    expect(db.select().from(mortgageEvents).all()).toHaveLength(0);
  });

  it("setMortgageExpectedInterest: guarda, audita y admite borrado con null", async () => {
    const created = await createProperty(
      { ...CANON_INPUT, mortgage: { ...CANON_INPUT.mortgage, expectedTotalInterestEur: 51_878 } },
      db,
    );
    if (!created.ok) throw new Error("seed");
    expect(created.data.mortgage!.expectedTotalInterestEur).toBe(51_878);
    const mortgageId = created.data.mortgage!.id;
    const res = await setMortgageExpectedInterest(
      { mortgageId, expectedTotalInterestEur: 52_000 },
      db,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.expectedTotalInterestEur).toBe(52_000);
    const cleared = await setMortgageExpectedInterest(
      { mortgageId, expectedTotalInterestEur: null },
      db,
    );
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.data.expectedTotalInterestEur).toBeNull();
    const audits = db.select().from(auditEvents).all();
    expect(audits.filter((a) => a.entityType === "mortgage" && a.action === "update")).toHaveLength(2);
  });

  it("deleteProperty: cascade elimina hipoteca y eventos", async () => {
    const created = await createProperty(CANON_INPUT, db);
    if (!created.ok) throw new Error("seed");
    const mortgageId = created.data.mortgage!.id;
    await addMortgageEvent(
      { type: "early_repayment", mortgageId, eventDate: "2027-01-15", amountEur: 10_000, mode: "reduce_term" },
      db,
    );
    const res = await deleteProperty({ id: created.data.property.id }, db);
    expect(res.ok).toBe(true);
    expect(db.select().from(properties).all()).toHaveLength(0);
    expect(db.select().from(mortgages).all()).toHaveLength(0);
    expect(db.select().from(mortgageEvents).where(eq(mortgageEvents.mortgageId, mortgageId)).all()).toHaveLength(0);
  });
});
