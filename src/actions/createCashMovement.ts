"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  auditEvents,
  type AccountCashMovement,
} from "../db/schema";
import { FxDeviationError, FxManualRequiredError, requireManualFx } from "./_fx";
import {
  ACTOR,
  type ActionResult,
  revalidateCashMovement,
} from "./_shared";
import { cashMovementFingerprint } from "./_fingerprint";
import { roundEur } from "../lib/money";
import { recomputeAccountCashBalance } from "../server/recompute";

import {
  createCashMovementSchema,
  type CashMovementKind,
} from "./createCashMovement.schema";

function signFor(kind: CashMovementKind): 1 | -1 {
  switch (kind) {
    case "withdrawal":
    case "fee":
    case "transfer-out":
      return -1;
    default:
      return 1;
  }
}

export async function createCashMovement(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<AccountCashMovement>> {
  const parsed = createCashMovementSchema.safeParse(input);
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

  const data = parsed.data;
  const currency = data.currency;

  try {
    const inserted = db.transaction((tx) => {
      const account = tx.select().from(accounts).where(eq(accounts.id, data.accountId)).get();
      if (!account) throw new Error(`account not found: ${data.accountId}`);

      const fx = requireManualFx(tx, currency, data.occurredAt, data.fxEurToCcy, {
        allowDeviation: data.allowFxDeviation,
      });
      const rate = fx.rate;

      const sign = signFor(data.kind);
      // Schema guarantees a positive magnitude; `kind` provides the sign.
      const nativeAmount = sign * data.amountNative;
      const cashImpactEur = roundEur(nativeAmount * rate);

      const occurredAtMs = new Date(`${data.occurredAt}T12:00:00.000Z`).getTime();
      const id = ulid();
      const baseFingerprint = cashMovementFingerprint({
        accountId: data.accountId,
        kind: data.kind,
        occurredAt: data.occurredAt,
        amountNative: nativeAmount,
        currency,
      });
      // Audit M7: two genuinely identical movements on one day are legitimate
      // (two €100 top-ups) — flag as duplicate, salt the fingerprint on override.
      const collision = tx
        .select({ id: accountCashMovements.id })
        .from(accountCashMovements)
        .where(eq(accountCashMovements.rowFingerprint, baseFingerprint))
        .get();
      if (collision && !data.allowDuplicate) {
        throw new Error(`duplicate cash movement: ${collision.id}`);
      }
      const fingerprint = collision ? `${baseFingerprint}:dup:${id}` : baseFingerprint;
      const now = Date.now();

      tx
        .insert(accountCashMovements)
        .values({
          id,
          accountId: data.accountId,
          movementType: data.kind,
          occurredAt: occurredAtMs,
          nativeAmount,
          currency,
          fxRateToEur: rate,
          fxSource: fx.source,
          cashImpactEur,
          withholdingTaxEur:
            data.kind === "interest" && data.withholdingTaxEur
              ? roundEur(data.withholdingTaxEur)
              : null,
          rowFingerprint: fingerprint,
          source: "manual",
          description: data.description ?? null,
          affectsCashBalance: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      recomputeAccountCashBalance(tx, data.accountId);

      const row = tx
        .select()
        .from(accountCashMovements)
        .where(eq(accountCashMovements.id, id))
        .get();
      if (!row) throw new Error("cash movement insert vanished");

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "cash_movement",
          entityId: id,
          action: "create",
          actorType: "user",
          source: "ui",
          summary: row.description ?? null,
          previousJson: null,
          nextJson: JSON.stringify(row),
          contextJson: JSON.stringify({
            actor: ACTOR,
            fxRateToEur: rate,
            fxSource: fx.source,
            fxStale: fx.stale ?? false,
          }),
          createdAt: now,
        })
        .run();

      return row;
    });

    revalidateCashMovement(data.accountId);
    return { ok: true, data: inserted };
  } catch (err) {
    if (err instanceof FxManualRequiredError) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: err.message,
          fieldErrors: { fxEurToCcy: [err.message] },
        },
      };
    }
    if (err instanceof FxDeviationError) {
      return {
        ok: false,
        error: {
          code: "fx_deviation",
          message: err.message,
          fieldErrors: { fxEurToCcy: [err.message] },
        },
      };
    }
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("duplicate cash movement")) {
      return {
        ok: false,
        error: {
          code: "duplicate",
          message:
            "Ya existe un movimiento de efectivo idéntico (misma cuenta, tipo, fecha, importe y divisa).",
        },
      };
    }
    if (message.startsWith("account not found")) {
      return { ok: false, error: { code: "not_found", message: "cuenta no encontrada" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
