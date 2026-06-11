"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, auditEvents, type Account } from "../db/schema";
import { FxUnavailableError, resolveFxRateSync } from "../lib/fx";
import { toIsoDate } from "../lib/time";
import { roundEur } from "../lib/money";
import { dbFxLookup } from "./_fx";

import {
  ACCOUNT_TYPES,
  ACTOR,
  isCashBearingAccount,
  revalidateAccountMutation,
  type ActionResult,
} from "./_shared";

/** País de la entidad custodia (ISO 3166-1 alfa-2). Decide si la cuenta
 *  alimenta los bloques M720/M721 — sin él, sus saldos caen en el bloque
 *  centinela «??». */
const countryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "El país debe ser un código ISO 3166-1 de 2 letras")
  .transform((s) => s.toUpperCase());

const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  accountType: z.enum(ACCOUNT_TYPES).default("savings"),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "La divisa debe ser un código ISO 4217 de 3 letras")
    .default("EUR"),
  countryCode: countryCodeSchema.optional(),
  openingBalanceNative: z
    .number()
    .finite()
    .min(0, "El saldo inicial debe ser cero o positivo")
    .default(0),
  notes: z.string().trim().max(500).optional(),
});

export type CreateAccountInput = z.input<typeof createAccountSchema>;

export async function createAccount(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Account>> {
  const parsed = createAccountSchema.safeParse(input);
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

  const { name, accountType, currency, countryCode, openingBalanceNative, notes } = parsed.data;
  const today = toIsoDate(new Date());

  try {
    const inserted = db.transaction((tx) => {
      // Opening balances are estimates, so the stored daily rate is fine
      // here (no manual-FX requirement) — but resolution still goes through
      // src/lib/fx.ts, never an ad-hoc lookup. A stale fallback is recorded
      // as such in the audit context instead of silently passing.
      const fx = resolveFxRateSync(currency, today, dbFxLookup(tx));
      const rate = fx.rate;

      const openingBalanceEur = roundEur(openingBalanceNative * rate);
      const now = Date.now();
      const id = ulid();

      tx
        .insert(accounts)
        .values({
          id,
          name,
          currency,
          accountType,
          countryCode: countryCode ?? null,
          openingBalanceEur,
          currentCashBalanceEur: isCashBearingAccount(accountType) ? openingBalanceEur : 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const row = tx.select().from(accounts).where(eq(accounts.id, id)).get();
      if (!row) {
        throw new Error("account insert vanished");
      }

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "account",
          entityId: id,
          action: "create",
          actorType: "user",
          source: "ui",
          summary: notes ?? null,
          previousJson: null,
          nextJson: JSON.stringify(row),
          contextJson: JSON.stringify({
            actor: ACTOR,
            openingBalanceNative,
            currency,
            fxRateToEur: rate,
            fxSource: fx.source,
            fxStale: fx.stale ?? false,
          }),
          createdAt: now,
        })
        .run();

      return row;
    });

    revalidateAccountMutation();

    return { ok: true, data: inserted };
  } catch (err) {
    if (err instanceof FxUnavailableError) {
      return {
        ok: false,
        error: {
          code: "db",
          message: `No hay tipo de cambio disponible para ${currency} a fecha ${today}`,
        },
      };
    }
    const message = err instanceof Error ? err.message : "Unknown DB error";
    return { ok: false, error: { code: "db", message } };
  }
}

// Solo metadatos sin estado derivado: divisa, tipo y saldo inicial alimentan
// FX, lotes y saldos recalculados — cambiarlos a posteriori exigiría un
// rebuild completo, así que quedan fuera deliberadamente.
const updateAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  countryCode: countryCodeSchema.nullable(),
});

export type UpdateAccountInput = z.input<typeof updateAccountSchema>;

export async function updateAccount(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Account>> {
  const parsed = updateAccountSchema.safeParse(input);
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

  const { id, name, countryCode } = parsed.data;

  try {
    const updated = db.transaction((tx) => {
      const existing = tx.select().from(accounts).where(eq(accounts.id, id)).get();
      if (!existing) throw new Error("account not found");
      const now = Date.now();
      tx.update(accounts)
        .set({ name, countryCode, updatedAt: now })
        .where(eq(accounts.id, id))
        .run();
      const row = tx.select().from(accounts).where(eq(accounts.id, id)).get()!;
      tx.insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "account",
          entityId: id,
          action: "update",
          actorType: "user",
          source: "ui",
          summary: null,
          previousJson: JSON.stringify(existing),
          nextJson: JSON.stringify(row),
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: now,
        })
        .run();
      return row;
    });

    revalidateAccountMutation();
    revalidatePath(`/accounts/${id}`);
    // countryCode decide qué bloques alimentan el M720/M721.
    revalidatePath("/taxes");

    return { ok: true, data: updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message === "account not found") {
      return { ok: false, error: { code: "not_found", message: "cuenta no encontrada" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
