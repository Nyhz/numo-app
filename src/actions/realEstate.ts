"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB, type Tx } from "../db/client";
import {
  auditEvents,
  mortgageEvents,
  mortgages,
  properties,
  propertyValuations,
  type Mortgage,
  type MortgageEvent,
  type Property,
  type PropertyValuation,
} from "../db/schema";
import {
  buildSchedule,
  outstandingAt,
  type MortgageScheduleEvent,
} from "../lib/mortgage";
import { ACTOR, type ActionResult, revalidateRealEstate } from "./_shared";
import {
  addMortgageEventSchema,
  addValuationSchema,
  createPropertySchema,
  deleteByIdSchema,
  setMortgageExpectedInterestSchema,
  updatePropertySchema,
} from "./realEstate.schema";

/** Fila de mortgage_events → evento del motor. Un solo mapeo para las
 *  pre-validaciones del action (espejo de toScheduleEvents en server/). */
function toEngineEvents(rows: MortgageEvent[]): MortgageScheduleEvent[] {
  return rows.map((e) => {
    if (e.type === "early_repayment") {
      return {
        type: "early_repayment" as const,
        eventDate: e.eventDate,
        amountEur: e.amountEur ?? 0,
        mode: e.mode ?? "reduce_installment",
      };
    }
    if (e.type === "payment_override") {
      return {
        type: "payment_override" as const,
        eventDate: e.eventDate,
        paymentEur: e.amountEur ?? 0,
      };
    }
    return {
      type: "rate_change" as const,
      eventDate: e.eventDate,
      newRatePct: e.newRatePct ?? 0,
    };
  });
}

type Validation<T> = { ok: true; data: T } | { ok: false; error: ActionResult<never> };

function validate<S extends z.ZodTypeAny>(schema: S, input: unknown): Validation<z.infer<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const flat = z.flattenError(parsed.error);
  return {
    ok: false,
    error: {
      ok: false,
      error: {
        code: "validation",
        message: "Datos no válidos",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      },
    },
  };
}

function audit(
  tx: Tx,
  entityType: string,
  entityId: string,
  action: "create" | "update" | "delete",
  previous: unknown,
  next: unknown,
  now: number,
) {
  tx.insert(auditEvents)
    .values({
      id: ulid(),
      entityType,
      entityId,
      action,
      actorType: "user",
      source: "ui",
      summary: null,
      previousJson: previous == null ? null : JSON.stringify(previous),
      nextJson: next == null ? null : JSON.stringify(next),
      contextJson: JSON.stringify({ actor: ACTOR }),
      createdAt: now,
    })
    .run();
}

function dbError(err: unknown): ActionResult<never> {
  const message = err instanceof Error ? err.message : "Unknown DB error";
  return { ok: false, error: { code: "db", message } };
}

export async function createProperty(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ property: Property; mortgage: Mortgage | null }>> {
  const v = validate(createPropertySchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  try {
    const created = db.transaction((tx) => {
      const propertyId = ulid();
      tx.insert(properties)
        .values({
          id: propertyId,
          name: v.data.name,
          address: v.data.address ?? null,
          purchaseDate: v.data.purchaseDate,
          purchasePriceEur: v.data.purchasePriceEur,
          purchaseCostsEur: v.data.purchaseCostsEur,
          notes: v.data.notes ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const property = tx.select().from(properties).where(eq(properties.id, propertyId)).get();
      if (!property) throw new Error("property insert vanished");
      audit(tx, "property", propertyId, "create", null, property, now);

      let mortgage: Mortgage | null = null;
      if (v.data.mortgage) {
        const mortgageId = ulid();
        tx.insert(mortgages)
          .values({
            id: mortgageId,
            propertyId,
            lender: v.data.mortgage.lender ?? null,
            principalEur: v.data.mortgage.principalEur,
            rateType: v.data.mortgage.rateType,
            nominalRatePct: v.data.mortgage.nominalRatePct,
            termMonths: v.data.mortgage.termMonths,
            firstPaymentDate: v.data.mortgage.firstPaymentDate,
            spreadPct: v.data.mortgage.spreadPct ?? null,
            referenceIndex: v.data.mortgage.referenceIndex ?? null,
            expectedTotalInterestEur: v.data.mortgage.expectedTotalInterestEur ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        mortgage = tx.select().from(mortgages).where(eq(mortgages.id, mortgageId)).get() ?? null;
        if (!mortgage) throw new Error("mortgage insert vanished");
        audit(tx, "mortgage", mortgageId, "create", null, mortgage, now);
      }
      return { property, mortgage };
    });
    revalidateRealEstate();
    return { ok: true, data: created };
  } catch (err) {
    return dbError(err);
  }
}

export async function updateProperty(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Property>> {
  const v = validate(updatePropertySchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const previous = db.select().from(properties).where(eq(properties.id, v.data.id)).get();
  if (!previous) {
    return { ok: false, error: { code: "not_found", message: "inmueble no encontrado" } };
  }
  try {
    const updated = db.transaction((tx) => {
      tx.update(properties)
        .set({
          name: v.data.name,
          address: v.data.address ?? null,
          purchaseDate: v.data.purchaseDate,
          purchasePriceEur: v.data.purchasePriceEur,
          purchaseCostsEur: v.data.purchaseCostsEur,
          notes: v.data.notes ?? null,
          updatedAt: now,
        })
        .where(eq(properties.id, v.data.id))
        .run();
      const row = tx.select().from(properties).where(eq(properties.id, v.data.id)).get();
      if (!row) throw new Error("property update vanished");
      audit(tx, "property", v.data.id, "update", previous, row, now);
      return row;
    });
    revalidateRealEstate();
    return { ok: true, data: updated };
  } catch (err) {
    return dbError(err);
  }
}

export async function deleteProperty(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const v = validate(deleteByIdSchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const previous = db.select().from(properties).where(eq(properties.id, v.data.id)).get();
  if (!previous) {
    return { ok: false, error: { code: "not_found", message: "inmueble no encontrado" } };
  }
  try {
    db.transaction((tx) => {
      tx.delete(properties).where(eq(properties.id, v.data.id)).run();
      audit(tx, "property", v.data.id, "delete", previous, null, now);
    });
    revalidateRealEstate();
    return { ok: true, data: { id: v.data.id } };
  } catch (err) {
    return dbError(err);
  }
}

export async function addValuation(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<PropertyValuation>> {
  const v = validate(addValuationSchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const property = db
    .select()
    .from(properties)
    .where(eq(properties.id, v.data.propertyId))
    .get();
  if (!property) {
    return { ok: false, error: { code: "not_found", message: "inmueble no encontrado" } };
  }
  if (v.data.valuationDate < property.purchaseDate) {
    return {
      ok: false,
      error: { code: "conflict", message: "La valoración no puede ser anterior a la compra" },
    };
  }
  try {
    const created = db.transaction((tx) => {
      const id = ulid();
      tx.insert(propertyValuations)
        .values({
          id,
          propertyId: v.data.propertyId,
          valuationDate: v.data.valuationDate,
          valueEur: v.data.valueEur,
          note: v.data.note ?? null,
          createdAt: now,
        })
        .run();
      const row = tx.select().from(propertyValuations).where(eq(propertyValuations.id, id)).get();
      if (!row) throw new Error("valuation insert vanished");
      audit(tx, "property_valuation", id, "create", null, row, now);
      return row;
    });
    revalidateRealEstate();
    return { ok: true, data: created };
  } catch (err) {
    return dbError(err);
  }
}

export async function deleteValuation(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const v = validate(deleteByIdSchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const previous = db
    .select()
    .from(propertyValuations)
    .where(eq(propertyValuations.id, v.data.id))
    .get();
  if (!previous) {
    return { ok: false, error: { code: "not_found", message: "valoración no encontrada" } };
  }
  try {
    db.transaction((tx) => {
      tx.delete(propertyValuations).where(eq(propertyValuations.id, v.data.id)).run();
      audit(tx, "property_valuation", v.data.id, "delete", previous, null, now);
    });
    revalidateRealEstate();
    return { ok: true, data: { id: v.data.id } };
  } catch (err) {
    return dbError(err);
  }
}

export async function addMortgageEvent(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<MortgageEvent>> {
  const v = validate(addMortgageEventSchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const mortgage = db
    .select()
    .from(mortgages)
    .where(eq(mortgages.id, v.data.mortgageId))
    .get();
  if (!mortgage) {
    return { ok: false, error: { code: "not_found", message: "hipoteca no encontrada" } };
  }
  if (v.data.eventDate < mortgage.firstPaymentDate) {
    return {
      ok: false,
      error: { code: "conflict", message: "El evento no puede ser anterior a la primera cuota" },
    };
  }
  const terms = {
    principalEur: mortgage.principalEur,
    nominalRatePct: mortgage.nominalRatePct,
    termMonths: mortgage.termMonths,
    firstPaymentDate: mortgage.firstPaymentDate,
  };
  if (v.data.type === "early_repayment") {
    const existing = db
      .select()
      .from(mortgageEvents)
      .where(eq(mortgageEvents.mortgageId, mortgage.id))
      .all();
    const schedule = buildSchedule(terms, toEngineEvents(existing));
    const pending = outstandingAt(terms, schedule, v.data.eventDate);
    if (v.data.amountEur >= pending) {
      return {
        ok: false,
        error: {
          code: "conflict",
          message: `La amortización (${v.data.amountEur} €) no puede igualar o superar el capital pendiente (${pending} €)`,
        },
      };
    }
  }
  if (v.data.type === "payment_override") {
    // Pre-validación amistosa: si la cuota forzada no cubre los intereses de
    // algún mes, el motor lanza — mejor un error de formulario que un 500.
    const existing = db
      .select()
      .from(mortgageEvents)
      .where(eq(mortgageEvents.mortgageId, mortgage.id))
      .all();
    try {
      buildSchedule(terms, [
        ...toEngineEvents(existing),
        { type: "payment_override", eventDate: v.data.eventDate, paymentEur: v.data.amountEur },
      ]);
    } catch {
      return {
        ok: false,
        error: {
          code: "conflict",
          message: `La cuota (${v.data.amountEur} €) no cubre los intereses del mes — el préstamo nunca amortizaría`,
        },
      };
    }
  }
  try {
    const created = db.transaction((tx) => {
      const id = ulid();
      tx.insert(mortgageEvents)
        .values({
          id,
          mortgageId: v.data.mortgageId,
          eventDate: v.data.eventDate,
          type: v.data.type,
          // payment_override reutiliza amountEur como nueva cuota mensual.
          amountEur: v.data.type !== "rate_change" ? v.data.amountEur : null,
          mode: v.data.type === "early_repayment" ? v.data.mode : null,
          newRatePct: v.data.type === "rate_change" ? v.data.newRatePct : null,
          note: v.data.note ?? null,
          createdAt: now,
        })
        .run();
      const row = tx.select().from(mortgageEvents).where(eq(mortgageEvents.id, id)).get();
      if (!row) throw new Error("mortgage event insert vanished");
      audit(tx, "mortgage_event", id, "create", null, row, now);
      return row;
    });
    revalidateRealEstate();
    return { ok: true, data: created };
  } catch (err) {
    return dbError(err);
  }
}

export async function deleteMortgageEvent(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const v = validate(deleteByIdSchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const previous = db
    .select()
    .from(mortgageEvents)
    .where(eq(mortgageEvents.id, v.data.id))
    .get();
  if (!previous) {
    return { ok: false, error: { code: "not_found", message: "evento no encontrado" } };
  }
  try {
    db.transaction((tx) => {
      tx.delete(mortgageEvents).where(eq(mortgageEvents.id, v.data.id)).run();
      audit(tx, "mortgage_event", v.data.id, "delete", previous, null, now);
    });
    revalidateRealEstate();
    return { ok: true, data: { id: v.data.id } };
  } catch (err) {
    return dbError(err);
  }
}

/** Registra (o borra, con null) el total de intereses de la oferta del banco —
 *  dato de contraste que la tarjeta compara con el cuadro derivado. */
export async function setMortgageExpectedInterest(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Mortgage>> {
  const v = validate(setMortgageExpectedInterestSchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const previous = db
    .select()
    .from(mortgages)
    .where(eq(mortgages.id, v.data.mortgageId))
    .get();
  if (!previous) {
    return { ok: false, error: { code: "not_found", message: "hipoteca no encontrada" } };
  }
  try {
    const updated = db.transaction((tx) => {
      tx.update(mortgages)
        .set({ expectedTotalInterestEur: v.data.expectedTotalInterestEur, updatedAt: now })
        .where(eq(mortgages.id, v.data.mortgageId))
        .run();
      const row = tx.select().from(mortgages).where(eq(mortgages.id, v.data.mortgageId)).get();
      if (!row) throw new Error("mortgage update vanished");
      audit(tx, "mortgage", v.data.mortgageId, "update", previous, row, now);
      return row;
    });
    revalidateRealEstate();
    return { ok: true, data: updated };
  } catch (err) {
    return dbError(err);
  }
}
