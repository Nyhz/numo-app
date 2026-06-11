"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  auditEvents,
  taxDeclaredBaselines,
  type TaxDeclaredBaseline,
} from "../db/schema";
import { roundEur } from "../lib/money";
import { ACTOR, type ActionResult, revalidateTaxEvent } from "./_shared";
import {
  deleteDeclaredBaselineSchema,
  setDeclaredBaselineSchema,
} from "./setDeclaredBaseline.schema";

/** A baseline for ejercicio Y changes the status shown on every later year's
 *  page (the comparator is "most recent prior filing"), most immediately Y+1. */
function revalidateBaselineEvent(year: number): void {
  revalidateTaxEvent(year);
  revalidatePath(`/taxes/${year + 1}`);
}

export async function setDeclaredBaseline(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<TaxDeclaredBaseline>> {
  const parsed = setDeclaredBaselineSchema.safeParse(input);
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
  const { year, category, notes } = parsed.data;
  const amountEur = roundEur(parsed.data.amountEur);

  try {
    const result = db.transaction((tx) => {
      const existing = tx
        .select()
        .from(taxDeclaredBaselines)
        .where(
          and(eq(taxDeclaredBaselines.year, year), eq(taxDeclaredBaselines.category, category)),
        )
        .get();
      const now = Date.now();
      let row: TaxDeclaredBaseline;
      if (existing) {
        tx.update(taxDeclaredBaselines)
          .set({ amountEur, notes: notes ?? null, updatedAt: now })
          .where(eq(taxDeclaredBaselines.id, existing.id))
          .run();
        row = tx
          .select()
          .from(taxDeclaredBaselines)
          .where(eq(taxDeclaredBaselines.id, existing.id))
          .get()!;
      } else {
        const id = ulid();
        tx.insert(taxDeclaredBaselines)
          .values({ id, year, category, amountEur, notes: notes ?? null })
          .run();
        row = tx.select().from(taxDeclaredBaselines).where(eq(taxDeclaredBaselines.id, id)).get()!;
      }
      tx.insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "tax_declared_baseline",
          entityId: row.id,
          action: existing ? "update" : "create",
          actorType: "user",
          source: "ui",
          summary: `declared baseline ${category} ${year}: ${amountEur} EUR`,
          previousJson: existing ? JSON.stringify(existing) : null,
          nextJson: JSON.stringify(row),
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: now,
        })
        .run();
      return row;
    });
    revalidateBaselineEvent(year);
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    return { ok: false, error: { code: "db", message } };
  }
}

export async function deleteDeclaredBaseline(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteDeclaredBaselineSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Datos no válidos" } };
  }
  const { id } = parsed.data;

  try {
    const result = db.transaction((tx) => {
      const existing = tx
        .select()
        .from(taxDeclaredBaselines)
        .where(eq(taxDeclaredBaselines.id, id))
        .get();
      if (!existing) throw new Error("baseline not found");
      tx.delete(taxDeclaredBaselines).where(eq(taxDeclaredBaselines.id, id)).run();
      tx.insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "tax_declared_baseline",
          entityId: id,
          action: "delete",
          actorType: "user",
          source: "ui",
          summary: `declared baseline ${existing.category} ${existing.year} removed`,
          previousJson: JSON.stringify(existing),
          nextJson: null,
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: Date.now(),
        })
        .run();
      return { id, year: existing.year };
    });
    revalidateBaselineEvent(result.year);
    return { ok: true, data: { id: result.id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message === "baseline not found") {
      return { ok: false, error: { code: "not_found", message: "registro no encontrado" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
