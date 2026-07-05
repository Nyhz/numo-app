"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  assetTransactions,
  assets,
  auditEvents,
  type AssetTransaction,
} from "../db/schema";
import {
  ACTOR,
  type ActionResult,
  isCashBearingAccount,
  revalidateTradeMutation,
} from "./_shared";
import { transactionFingerprint } from "./_fingerprint";
import { rebuildAfterTradeMutation } from "../server/rebuild";
import { FxDeviationError, FxManualRequiredError, requireManualFx } from "./_fx";
import { round as roundNative, roundEur as round } from "../lib/money";

import { createTransactionSchema } from "./createTransaction.schema";

export async function createTransaction(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<AssetTransaction>> {
  const parsed = createTransactionSchema.safeParse(input);
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
      const asset = tx.select().from(assets).where(eq(assets.id, data.assetId)).get();
      if (!asset) throw new Error(`asset not found: ${data.assetId}`);

      // Audit H4: the unit price is by definition denominated in the asset's
      // quote currency. A mismatched currency records a wrong EUR amount at
      // rate 1.0 without any flag — reject instead of trusting free text.
      if (currency !== asset.currency) {
        throw new Error(
          `currency mismatch: trade entered in ${currency} but ${asset.symbol ?? asset.name} is quoted in ${asset.currency}`,
        );
      }

      // Audit H5: pre-check sells against units actually held so an oversell
      // surfaces as a quantity error, not as the FIFO engine's internal abort.
      // Holdings are summed across all accounts — FIFO lots are global per asset.
      if (data.side === "sell") {
        const ledger = tx
          .select({
            quantity: assetTransactions.quantity,
            transactionType: assetTransactions.transactionType,
          })
          .from(assetTransactions)
          .where(eq(assetTransactions.assetId, data.assetId))
          .all();
        const held = ledger.reduce(
          (sum, row) =>
            row.transactionType === "buy"
              ? sum + row.quantity
              : // sell y transfer_out (retirada a custodia externa) drenan
                // unidades del pool por igual — ignorar transfer_out sobrestima
                // lo disponible y deja pasar un oversell.
                row.transactionType === "sell" ||
                  row.transactionType === "transfer_out"
                ? sum - row.quantity
                : sum,
          0,
        );
        if (data.quantity > held + 1e-9) {
          throw new Error(`oversell: ${held}`);
        }
      }

      const fx = requireManualFx(tx, currency, data.tradeDate, data.fxEurToCcy, {
        allowDeviation: data.allowFxDeviation,
      });
      const rate = fx.rate;

      const sign = data.side === "buy" ? -1 : 1;
      const tradeGrossAmount = data.quantity * data.priceNative;
      const tradeGrossAmountEur = round(tradeGrossAmount * rate);
      // Broker fees are charged in EUR regardless of the asset's quote
      // currency (European broker, EUR cash account) — never FX-convert them.
      const feesAmountEur = round(data.fees);
      // cashImpactEur: buys reduce cash (incl. fees); sells add net proceeds.
      const cashImpactEur =
        sign * round(tradeGrossAmountEur) - feesAmountEur;
      const netAmountEur = cashImpactEur;

      const tradedAt = new Date(`${data.tradeDate}T12:00:00.000Z`).getTime();
      const id = ulid();
      const baseFingerprint = transactionFingerprint({
        accountId: data.accountId,
        assetId: data.assetId,
        tradeDate: data.tradeDate,
        side: data.side,
        quantity: data.quantity,
        priceNative: data.priceNative,
      });
      // Audit R7: two genuinely identical fills on one day collide on the
      // unique index. Without the override this is a friendly "duplicate"
      // error; with it, the fingerprint is salted with the new row id.
      const collision = tx
        .select({ id: assetTransactions.id })
        .from(assetTransactions)
        .where(eq(assetTransactions.rowFingerprint, baseFingerprint))
        .get();
      if (collision && !data.allowDuplicate) {
        throw new Error(`duplicate transaction: ${collision.id}`);
      }
      const fingerprint = collision ? `${baseFingerprint}:dup:${id}` : baseFingerprint;
      const now = Date.now();

      tx
        .insert(assetTransactions)
        .values({
          id,
          accountId: data.accountId,
          assetId: data.assetId,
          transactionType: data.side,
          tradedAt,
          quantity: data.quantity,
          unitPrice: data.priceNative,
          tradeCurrency: currency,
          fxRateToEur: rate,
          fxSource: fx.source,
          // Native column at 8dp — 2dp EUR rounding corrupts crypto-quoted
          // amounts (0.0032 BTC → 0.00) and breaks native×rate provenance.
          tradeGrossAmount: roundNative(tradeGrossAmount, 8),
          tradeGrossAmountEur,
          cashImpactEur: round(cashImpactEur),
          feesAmount: data.fees,
          feesAmountEur,
          netAmountEur: round(netAmountEur),
          rowFingerprint: fingerprint,
          source: "manual",
          notes: data.notes ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const tracksCash = isCashBearingAccount(account.accountType);
      if (tracksCash) {
        tx
          .insert(accountCashMovements)
          .values({
            id: ulid(),
            accountId: data.accountId,
            movementType: "trade",
            occurredAt: tradedAt,
            // The EUR fee expressed in the movement's native currency, so the
            // column never mixes units (fee EUR / rate = fee in native).
            nativeAmount: roundNative(sign * tradeGrossAmount - feesAmountEur / rate, 8),
            currency,
            fxRateToEur: rate,
            fxSource: fx.source,
            cashImpactEur: round(cashImpactEur),
            externalReference: id,
            rowFingerprint: `trade:${id}`,
            source: "manual",
            description: `${data.side} ${data.quantity} ${asset.symbol ?? asset.name}`,
            affectsCashBalance: true,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
      // Single source of truth: positions + lots + valuations + cash balance.
      rebuildAfterTradeMutation(tx, data.accountId, data.assetId, data.tradeDate);

      const row = tx
        .select()
        .from(assetTransactions)
        .where(eq(assetTransactions.id, id))
        .get();
      if (!row) throw new Error("transaction insert vanished");

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "asset_transaction",
          entityId: id,
          action: "create",
          actorType: "user",
          source: "ui",
          summary: row.notes ?? null,
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

    revalidateTradeMutation(data.accountId);
    return { ok: true, data: inserted };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("duplicate transaction")) {
      return {
        ok: false,
        error: {
          code: "duplicate",
          message:
            "Ya existe una transacción idéntica (misma cuenta, activo, fecha, sentido, cantidad y precio).",
        },
      };
    }
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
    if (message.startsWith("currency mismatch")) {
      // The thrown message is an internal English sentinel; rebuild the
      // user-facing sentence in Spanish from its parts.
      const m = message.match(
        /^currency mismatch: trade entered in (\S+) but (.+) is quoted in (\S+)$/,
      );
      const friendly = m
        ? `La divisa no coincide: operación introducida en ${m[1]} pero ${m[2]} cotiza en ${m[3]}.`
        : "La divisa no coincide con la divisa de cotización del activo.";
      return {
        ok: false,
        error: { code: "validation", message: friendly, fieldErrors: { currency: [friendly] } },
      };
    }
    if (message.startsWith("oversell:")) {
      const held = Number(message.slice("oversell:".length));
      const friendly = `Solo se poseen ${Number(held.toFixed(8))} unidades entre todas las cuentas — no puedes vender más.`;
      return {
        ok: false,
        error: { code: "validation", message: friendly, fieldErrors: { quantity: [friendly] } },
      };
    }
    if (message.startsWith("tax-lots:")) {
      // Defensive fallback: the FIFO replay still aborts the transaction on
      // chronology-level oversells the simple holdings sum can't see.
      const friendly = `Esta venta supera las unidades poseídas en esa fecha (comprobación FIFO): ${message}`;
      return {
        ok: false,
        error: { code: "validation", message: friendly, fieldErrors: { quantity: [friendly] } },
      };
    }
    if (message.startsWith("account not found") || message.startsWith("asset not found")) {
      const friendly = message.startsWith("account not found")
        ? "cuenta no encontrada"
        : "activo no encontrado";
      return { ok: false, error: { code: "not_found", message: friendly } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
