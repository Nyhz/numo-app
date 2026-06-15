"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { assets, auditEvents, objectives, type Objective } from "../db/schema";
import { OBJECTIVE_COLOR_VARS, type ObjectiveColorVar } from "../lib/objective-colors";
import { ACTOR, type ActionResult } from "./_shared";

const targetPctSchema = z
  .number()
  .finite()
  .min(0, "El objetivo no puede ser negativo")
  .max(100, "El objetivo no puede superar el 100 %");

const colorSchema = z.enum(
  OBJECTIVE_COLOR_VARS as unknown as [ObjectiveColorVar, ...ObjectiveColorVar[]],
);

// A new objective is just a tag: it is born with 0 % target and gains weight
// by dragging the pie boundaries (setObjectiveTargets).
const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
  targetPct: targetPctSchema.default(0),
  color: colorSchema.optional(),
  notes: z.string().trim().max(500).optional(),
});

const updateSchema = createSchema.extend({ id: z.string().min(1) });

const deleteSchema = z.object({ id: z.string().min(1) });

const assignSchema = z.object({
  assetId: z.string().min(1),
  objectiveId: z.string().min(1).nullable(),
});

const excludeSchema = z.object({
  assetId: z.string().min(1),
  excluded: z.boolean(),
});

const reorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
});

const targetsSchema = z.object({
  targets: z
    .array(z.object({ id: z.string().min(1), targetPct: targetPctSchema }))
    .min(1)
    .max(50),
});

function revalidateObjectives(): void {
  revalidatePath("/objectives");
  revalidatePath("/assets");
}

function audit(
  tx: Pick<DB, "insert">,
  entityId: string,
  action: string,
  previous: unknown,
  next: unknown,
  summary: string,
): void {
  tx.insert(auditEvents)
    .values({
      id: ulid(),
      entityType: "objective",
      entityId,
      action,
      actorType: "user",
      source: "ui",
      summary,
      previousJson: previous == null ? null : JSON.stringify(previous),
      nextJson: next == null ? null : JSON.stringify(next),
      contextJson: JSON.stringify({ actor: ACTOR }),
      createdAt: Date.now(),
    })
    .run();
}

export async function createObjective(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Objective>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Datos no válidos",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      },
    };
  }
  const { name, targetPct, color, notes } = parsed.data;
  try {
    const row = db.transaction((tx) => {
      const now = Date.now();
      // New tags go to the end of the display order.
      const maxOrder =
        tx
          .select({ max: sql<number | null>`max(${objectives.sortOrder})` })
          .from(objectives)
          .get()?.max ?? -1;
      const inserted = tx
        .insert(objectives)
        .values({
          id: ulid(),
          name,
          targetPct,
          color: color ?? null,
          sortOrder: maxOrder + 1,
          notes: notes ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      audit(tx, inserted.id, "create", null, inserted, `Objetivo «${name}» (${targetPct} %)`);
      return inserted;
    });
    revalidateObjectives();
    return { ok: true, data: row };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.includes("UNIQUE")) {
      return { ok: false, error: { code: "duplicate", message: "Ya existe un objetivo con ese nombre" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}

export async function updateObjective(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Objective>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Datos no válidos",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      },
    };
  }
  const { id, name, targetPct, color, notes } = parsed.data;
  try {
    const row = db.transaction((tx) => {
      const existing = tx.select().from(objectives).where(eq(objectives.id, id)).get();
      if (!existing) throw new Error("objective not found");
      const updated = tx
        .update(objectives)
        .set({
          name,
          targetPct,
          color: color ?? existing.color,
          notes: notes ?? null,
          updatedAt: Date.now(),
        })
        .where(eq(objectives.id, id))
        .returning()
        .get();
      audit(tx, id, "update", existing, updated, `Objetivo «${name}» → ${targetPct} %`);
      return updated;
    });
    revalidateObjectives();
    return { ok: true, data: row };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message === "objective not found") {
      return { ok: false, error: { code: "not_found", message: "objetivo no encontrado" } };
    }
    if (message.includes("UNIQUE")) {
      return { ok: false, error: { code: "duplicate", message: "Ya existe un objetivo con ese nombre" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}

export async function deleteObjective(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Datos no válidos" } };
  }
  const { id } = parsed.data;
  try {
    db.transaction((tx) => {
      const existing = tx.select().from(objectives).where(eq(objectives.id, id)).get();
      if (!existing) throw new Error("objective not found");
      // SQLite's ALTER TABLE drops the ON DELETE SET NULL clause, so the
      // unassignment is explicit — assets fall back to «Sin objetivo».
      tx.update(assets)
        .set({ objectiveId: null, updatedAt: Date.now() })
        .where(eq(assets.objectiveId, id))
        .run();
      tx.delete(objectives).where(eq(objectives.id, id)).run();
      audit(tx, id, "delete", existing, null, `Objetivo «${existing.name}» eliminado`);
    });
    revalidateObjectives();
    return { ok: true, data: { id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message === "objective not found") {
      return { ok: false, error: { code: "not_found", message: "objetivo no encontrado" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}

/** Persists a legend drag & drop: sortOrder = position in the given list. */
export async function reorderObjectives(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ ids: string[] }>> {
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Orden no válido" } };
  }
  const { ids } = parsed.data;
  try {
    db.transaction((tx) => {
      const previous: string[] = [];
      ids.forEach((id, index) => {
        const existing = tx.select().from(objectives).where(eq(objectives.id, id)).get();
        if (!existing) throw new Error("objective not found");
        previous.push(existing.id);
        if (existing.sortOrder !== index) {
          tx.update(objectives)
            .set({ sortOrder: index, updatedAt: Date.now() })
            .where(eq(objectives.id, id))
            .run();
        }
      });
      audit(
        tx,
        "display-order",
        "reorder",
        { ids: previous },
        { ids },
        `Tags reordenados (${ids.length})`,
      );
    });
    revalidateObjectives();
    return { ok: true, data: { ids } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message === "objective not found") {
      return { ok: false, error: { code: "not_found", message: "objetivo no encontrado" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}

/** Persists a pie-drag: every affected tag's target in one transaction, so
 *  the weights move together and the plan never half-commits. */
export async function setObjectiveTargets(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ updated: number }>> {
  const parsed = targetsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Pesos no válidos" } };
  }
  const { targets } = parsed.data;
  try {
    const updated = db.transaction((tx) => {
      let count = 0;
      for (const t of targets) {
        const existing = tx.select().from(objectives).where(eq(objectives.id, t.id)).get();
        if (!existing) throw new Error("objective not found");
        if (existing.targetPct === t.targetPct) continue;
        tx.update(objectives)
          .set({ targetPct: t.targetPct, updatedAt: Date.now() })
          .where(eq(objectives.id, t.id))
          .run();
        audit(
          tx,
          t.id,
          "retarget",
          { targetPct: existing.targetPct },
          { targetPct: t.targetPct },
          `Objetivo «${existing.name}»: ${existing.targetPct} % → ${t.targetPct} %`,
        );
        count++;
      }
      return count;
    });
    revalidateObjectives();
    return { ok: true, data: { updated } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message === "objective not found") {
      return { ok: false, error: { code: "not_found", message: "objetivo no encontrado" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}

/** Toggle whether an asset is tracked by the allocation objectives at all.
 *  Excluded assets vanish from the plan (not even «Sin objetivo») and from its
 *  valued total — for non-discretionary holdings like a fixed EPSV. */
export async function setAssetExcludeFromObjectives(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ assetId: string; excluded: boolean }>> {
  const parsed = excludeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Datos no válidos" } };
  }
  const { assetId, excluded } = parsed.data;
  try {
    db.transaction((tx) => {
      const asset = tx.select().from(assets).where(eq(assets.id, assetId)).get();
      if (!asset) throw new Error("asset not found");
      tx.update(assets)
        .set({ excludeFromObjectives: excluded, updatedAt: Date.now() })
        .where(eq(assets.id, assetId))
        .run();
      audit(
        tx,
        assetId,
        "update",
        { excludeFromObjectives: asset.excludeFromObjectives ?? false },
        { excludeFromObjectives: excluded },
        `Activo «${asset.name}» → ${excluded ? "excluido de" : "incluido en"} objetivos`,
      );
    });
    revalidateObjectives();
    return { ok: true, data: { assetId, excluded } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message === "asset not found") {
      return { ok: false, error: { code: "not_found", message } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}

export async function setAssetObjective(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ assetId: string; objectiveId: string | null }>> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Datos no válidos" } };
  }
  const { assetId, objectiveId } = parsed.data;
  try {
    db.transaction((tx) => {
      const asset = tx.select().from(assets).where(eq(assets.id, assetId)).get();
      if (!asset) throw new Error("asset not found");
      if (objectiveId != null) {
        const objective = tx.select().from(objectives).where(eq(objectives.id, objectiveId)).get();
        if (!objective) throw new Error("objective not found");
      }
      tx.update(assets)
        .set({ objectiveId, updatedAt: Date.now() })
        .where(eq(assets.id, assetId))
        .run();
      audit(
        tx,
        assetId,
        "assign",
        { objectiveId: asset.objectiveId ?? null },
        { objectiveId },
        `Activo «${asset.name}» → ${objectiveId == null ? "sin objetivo" : "objetivo asignado"}`,
      );
    });
    revalidateObjectives();
    return { ok: true, data: { assetId, objectiveId } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message === "asset not found" || message === "objective not found") {
      return { ok: false, error: { code: "not_found", message } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
