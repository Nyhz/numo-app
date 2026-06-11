import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createAccount, updateAccount } from "../accounts";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("createAccount action", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("rejects invalid input with validation fieldErrors", async () => {
    const result = await createAccount({ name: "" }, db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
    expect(result.error.fieldErrors).toBeDefined();
    expect(result.error.fieldErrors?.name?.length).toBeGreaterThan(0);

    const rows = await db.select().from(schema.accounts).all();
    expect(rows).toHaveLength(0);
  });

  it("rejects invalid currency", async () => {
    const result = await createAccount(
      { name: "Foo", currency: "euro", openingBalanceNative: 100 },
      db,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.fieldErrors?.currency?.length).toBeGreaterThan(0);
  });

  it("inserts account and audit event in a single transaction on success", async () => {
    const result = await createAccount(
      {
        name: "Revolut EUR",
        accountType: "savings",
        currency: "EUR",
        openingBalanceNative: 500,
      },
      db,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const accountRows = await db.select().from(schema.accounts).all();
    expect(accountRows).toHaveLength(1);
    expect(accountRows[0].name).toBe("Revolut EUR");
    expect(accountRows[0].openingBalanceEur).toBe(500);
    expect(accountRows[0].currentCashBalanceEur).toBe(500);

    const auditRows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, result.data.id))
      .all();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].entityType).toBe("account");
    expect(auditRows[0].action).toBe("create");
    expect(auditRows[0].previousJson).toBeNull();
    expect(auditRows[0].nextJson).toContain("Revolut EUR");

    expect(result.data.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("converts non-EUR opening balance using stored fx rate", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await db
      .insert(schema.fxRates)
      .values({
        id: "fx_1",
        currency: "USD",
        date: today,
        rateToEur: 0.9,
      })
      .run();

    const result = await createAccount(
      {
        name: "Coinbase USD",
        accountType: "crypto",
        currency: "USD",
        openingBalanceNative: 100,
      },
      db,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.openingBalanceEur).toBe(90);
    expect(result.data.currentCashBalanceEur).toBe(0);

    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, result.data.id))
      .get();
    expect(audit?.contextJson).toContain('"fxRateToEur":0.9');
  });

  it("returns db error when non-EUR currency has no fx rate", async () => {
    const result = await createAccount(
      {
        name: "Orphan",
        currency: "JPY",
        openingBalanceNative: 1000,
      },
      db,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("db");

    const rows = await db.select().from(schema.accounts).all();
    expect(rows).toHaveLength(0);
  });

  it("stores the custodian country, uppercased", async () => {
    const result = await createAccount(
      { name: "DEGIRO", accountType: "broker", countryCode: "nl" },
      db,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.countryCode).toBe("NL");
  });
});

describe("updateAccount action", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  async function seed(): Promise<string> {
    const created = await createAccount({ name: "DEGIRO", accountType: "broker" }, db);
    if (!created.ok) throw new Error("seed failed");
    return created.data.id;
  }

  it("updates name and country with an audit event", async () => {
    const id = await seed();
    const result = await updateAccount({ id, name: "DEGIRO B.V.", countryCode: "nl" }, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.countryCode).toBe("NL");
    expect(result.data.name).toBe("DEGIRO B.V.");

    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "update"))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0].entityType).toBe("account");
    expect(audit[0].previousJson).toContain('"countryCode":null');
  });

  it("clears the country with null", async () => {
    const id = await seed();
    await updateAccount({ id, name: "DEGIRO", countryCode: "NL" }, db);
    const cleared = await updateAccount({ id, name: "DEGIRO", countryCode: null }, db);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.data.countryCode).toBeNull();
  });

  it("rejects a malformed country code", async () => {
    const id = await seed();
    const result = await updateAccount({ id, name: "DEGIRO", countryCode: "NLD" }, db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.fieldErrors?.countryCode?.length).toBeGreaterThan(0);
  });

  it("returns not_found for an unknown account", async () => {
    const result = await updateAccount({ id: "nope", name: "X", countryCode: null }, db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });
});
