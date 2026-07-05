"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { accountCashMovements, auditEvents } from "../db/schema";
import {
  ACTOR,
  type ActionResult,
  revalidateCashMovement,
} from "./_shared";
import { invalidateDailyBalancesFrom } from "../server/dailyBalances";
import { recomputeAccountCashBalance } from "../server/recompute";

import { deleteCashMovementSchema } from "./deleteCashMovement.schema";

export async function deleteCashMovement(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteCashMovementSchema.safeParse(input);
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

  const { id } = parsed.data;
  const now = Date.now();

  try {
    const accountId = db.transaction((tx) => {
      const previous = tx
        .select()
        .from(accountCashMovements)
        .where(eq(accountCashMovements.id, id))
        .get();
      if (!previous) throw new Error(`cash movement not found: ${id}`);
      // A non-null externalReference marks the cash shadow of an
      // asset_transactions row (trade, dividend, swap) — it lives and dies
      // with the originating transaction, never on its own.
      if (previous.externalReference != null) {
        throw new Error("paired cash movements are deleted via deleteTransaction");
      }

      tx.delete(accountCashMovements).where(eq(accountCashMovements.id, id)).run();
      recomputeAccountCashBalance(tx, previous.accountId);
      // La caja diaria materializada cambia desde la fecha del movimiento.
      invalidateDailyBalancesFrom(
        tx,
        new Date(previous.occurredAt).toISOString().slice(0, 10),
      );

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "cash_movement",
          entityId: id,
          action: "delete",
          actorType: "user",
          source: "ui",
          summary: null,
          previousJson: JSON.stringify(previous),
          nextJson: null,
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: now,
        })
        .run();

      return previous.accountId;
    });

    revalidateCashMovement(accountId);
    return { ok: true, data: { id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("cash movement not found")) {
      return {
        ok: false,
        error: { code: "not_found", message: "movimiento de efectivo no encontrado" },
      };
    }
    if (message.startsWith("paired cash movements")) {
      return {
        ok: false,
        error: {
          code: "conflict",
          message:
            "Este movimiento es el reflejo de caja de una transacción — elimina la transacción original.",
        },
      };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
