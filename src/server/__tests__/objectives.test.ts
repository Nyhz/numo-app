import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import {
  createObjective,
  deleteObjective,
  reorderObjectives,
  setAssetExcludeFromObjectives,
  setAssetObjective,
  setObjectiveTargets,
} from "../../actions/objectives";
import { getObjectivesAllocation } from "../objectives";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedAsset(db: DB, id: string, name: string, valueEur: number) {
  db.insert(schema.assets)
    .values({ id, name, assetType: "etf", currency: "EUR" })
    .run();
  db.insert(schema.assetPositions)
    .values({ id: `pos_${id}`, assetId: id, quantity: 1, totalCostEur: valueEur })
    .run();
  db.insert(schema.assetValuations)
    .values({
      id: `val_${id}`,
      assetId: id,
      valuationDate: "2026-06-10",
      quantity: 1,
      unitPriceEur: valueEur,
      marketValueEur: valueEur,
      priceSource: "test",
    })
    .run();
}

describe("objectives — allocation across brokers", () => {
  it("aggregates assets from different accounts into one bucket and measures drift", async () => {
    const db = makeDb();
    // VWCE (DEGIRO) + developed-world fund (MYINVESTOR): same objective.
    seedAsset(db, "ast_vwce", "Vanguard FTSE All-World", 6000);
    seedAsset(db, "ast_ishares", "iShares Developed World", 2000);
    seedAsset(db, "ast_btc", "Bitcoin", 2000);

    const world = await createObjective({ name: "World", targetPct: 90 }, db);
    expect(world.ok).toBe(true);
    if (!world.ok) return;

    await setAssetObjective({ assetId: "ast_vwce", objectiveId: world.data.id }, db);
    await setAssetObjective({ assetId: "ast_ishares", objectiveId: world.data.id }, db);

    const allocation = await getObjectivesAllocation(db);
    const bucket = allocation.buckets.find((b) => b.objective?.id === world.data.id)!;
    expect(bucket.valueEur).toBe(8000);
    expect(bucket.weightPct).toBeCloseTo(80, 6);
    expect(bucket.driftPct).toBeCloseTo(-10, 6); // 80 % real vs 90 % objetivo
    expect(bucket.driftEur).toBeCloseTo(1000, 6); // faltan 1.000 €
    expect(bucket.assets).toHaveLength(2);

    const unassigned = allocation.buckets.find((b) => b.objective == null)!;
    expect(unassigned.valueEur).toBe(2000);
    expect(allocation.unassignedEur).toBe(2000);
  });

  it("leaves excluded assets out of the plan and its valued total", async () => {
    const db = makeDb();
    seedAsset(db, "ast_world", "All-World", 8000);
    seedAsset(db, "ast_epsv", "EPSV", 2000);
    const world = await createObjective({ name: "World", targetPct: 100 }, db);
    if (!world.ok) throw new Error("seed failed");
    await setAssetObjective({ assetId: "ast_world", objectiveId: world.data.id }, db);

    // Unassigned EPSV first shows up as «Sin objetivo» and counts in the total.
    let alloc = await getObjectivesAllocation(db);
    expect(alloc.totalValuedEur).toBe(10000);
    expect(alloc.unassignedEur).toBe(2000);

    // Excluding it drops it from the plan AND the total.
    const ex = await setAssetExcludeFromObjectives({ assetId: "ast_epsv", excluded: true }, db);
    expect(ex.ok).toBe(true);
    alloc = await getObjectivesAllocation(db);
    expect(alloc.totalValuedEur).toBe(8000);
    expect(alloc.unassignedEur).toBe(0);
    expect(alloc.buckets.some((b) => b.objective == null)).toBe(false);
    const bucket = alloc.buckets.find((b) => b.objective?.id === world.data.id)!;
    expect(bucket.weightPct).toBeCloseTo(100, 6); // 100 % of discretionary capital

    // Re-including restores it to the total.
    await setAssetExcludeFromObjectives({ assetId: "ast_epsv", excluded: false }, db);
    alloc = await getObjectivesAllocation(db);
    expect(alloc.totalValuedEur).toBe(10000);
  });

  it("rejects duplicate names and out-of-range targets", async () => {
    const db = makeDb();
    await createObjective({ name: "World", targetPct: 80 }, db);
    const dup = await createObjective({ name: "World", targetPct: 10 }, db);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("duplicate");

    const over = await createObjective({ name: "Otro", targetPct: 120 }, db);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe("validation");
  });

  it("creates tags with 0 % target by default and re-targets them in one batch", async () => {
    const db = makeDb();
    const world = await createObjective({ name: "World" }, db);
    const crypto = await createObjective({ name: "Crypto" }, db);
    if (!world.ok || !crypto.ok) throw new Error("seed failed");
    expect(world.data.targetPct).toBe(0);

    const result = await setObjectiveTargets(
      {
        targets: [
          { id: world.data.id, targetPct: 80 },
          { id: crypto.data.id, targetPct: 20 },
        ],
      },
      db,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.updated).toBe(2);

    const rows = await db.select().from(schema.objectives).all();
    const byName = new Map(rows.map((r) => [r.name, r.targetPct]));
    expect(byName.get("World")).toBe(80);
    expect(byName.get("Crypto")).toBe(20);

    // Unchanged values don't generate writes (idempotent re-commit).
    const again = await setObjectiveTargets(
      { targets: [{ id: world.data.id, targetPct: 80 }] },
      db,
    );
    expect(again.ok && again.data.updated).toBe(0);

    const audit = await db.select().from(schema.auditEvents).all();
    expect(audit.filter((a) => a.action === "retarget")).toHaveLength(2);
  });

  it("stores a palette colour on create and update, rejecting raw hex", async () => {
    const db = makeDb();
    const created = await createObjective({ name: "Gold", color: "--chart-3" }, db);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.color).toBe("--chart-3");

    const { updateObjective } = await import("../../actions/objectives");
    const updated = await updateObjective(
      { id: created.data.id, name: "Gold", targetPct: 0, color: "--chart-9" },
      db,
    );
    expect(updated.ok && updated.data.color).toBe("--chart-9");

    const hex = await createObjective({ name: "Hex", color: "#ff0000" }, db);
    expect(hex.ok).toBe(false);
    if (!hex.ok) expect(hex.error.code).toBe("validation");
  });

  it("reorders tags and the allocation respects sortOrder over name", async () => {
    const db = makeDb();
    const a = await createObjective({ name: "Alpha" }, db);
    const b = await createObjective({ name: "Beta" }, db);
    const c = await createObjective({ name: "Crypto" }, db);
    if (!a.ok || !b.ok || !c.ok) throw new Error("seed failed");

    // Creation order = display order (sortOrder 0,1,2).
    let allocation = await getObjectivesAllocation(db);
    expect(allocation.buckets.map((x) => x.objective?.name)).toEqual([
      "Alpha",
      "Beta",
      "Crypto",
    ]);

    const result = await reorderObjectives({ ids: [c.data.id, a.data.id, b.data.id] }, db);
    expect(result.ok).toBe(true);

    allocation = await getObjectivesAllocation(db);
    expect(allocation.buckets.map((x) => x.objective?.name)).toEqual([
      "Crypto",
      "Alpha",
      "Beta",
    ]);
  });

  it("deleteObjective unassigns its assets and writes audit events", async () => {
    const db = makeDb();
    seedAsset(db, "ast_1", "VWCE", 1000);
    const created = await createObjective({ name: "World", targetPct: 100 }, db);
    if (!created.ok) throw new Error("seed failed");
    await setAssetObjective({ assetId: "ast_1", objectiveId: created.data.id }, db);

    const deleted = await deleteObjective({ id: created.data.id }, db);
    expect(deleted.ok).toBe(true);

    const asset = db.select().from(schema.assets).where(eq(schema.assets.id, "ast_1")).get()!;
    expect(asset.objectiveId).toBeNull();

    const audit = await db.select().from(schema.auditEvents).all();
    const actions = audit.map((a) => a.action).sort();
    expect(actions).toEqual(["assign", "create", "delete"]);
  });
});
