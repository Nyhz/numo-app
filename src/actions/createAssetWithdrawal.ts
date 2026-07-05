"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, assets, assetTransactions, auditEvents } from "../db/schema";
import { rebuildAfterTradeMutation } from "../server/rebuild";
import { assetWithdrawalFingerprint } from "./_fingerprint";
import { roundEur } from "../lib/money";
import { createAssetWithdrawalSchema } from "./createAssetWithdrawal.schema";
import {
  ACTOR,
  type ActionResult,
  revalidateTradeMutation,
} from "./_shared";

/**
 * Retirada de activo a custodia externa (wallet propia, otro bróker…): las
 * unidades salen del ledger consumiendo lotes FIFO pero SIN generar par
 * fiscal — mover activos entre custodias propias no es hecho imponible — y
 * sin movimiento de caja. `cashImpactEur` lleva el valor EUR retirado con la
 * misma semántica de flujo que las patas de un swap: la serie de patrimonio
 * lo trata como salida (TWR neutro), la caja real no se toca.
 */
export async function createAssetWithdrawal(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createAssetWithdrawalSchema.safeParse(input);
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

  try {
    const result = db.transaction((tx) => {
      const account = tx.select().from(accounts).where(eq(accounts.id, data.accountId)).get();
      if (!account) throw new Error("account not found");
      const asset = tx.select().from(assets).where(eq(assets.id, data.assetId)).get();
      if (!asset) throw new Error("asset not found");

      const tradedAt = new Date(`${data.tradeDate}T12:00:00.000Z`).getTime();
      const id = ulid();
      const valueEur = roundEur(data.valueEur);

      const base = assetWithdrawalFingerprint({
        accountId: data.accountId,
        assetId: data.assetId,
        tradeDate: data.tradeDate,
        quantity: data.quantity,
        valueEur,
      });
      const collision = tx
        .select({ id: assetTransactions.id })
        .from(assetTransactions)
        .where(eq(assetTransactions.rowFingerprint, base))
        .get();
      if (collision && !data.allowDuplicate) {
        throw new Error(`duplicate withdrawal: ${collision.id}`);
      }
      const rowFingerprint = collision ? `${base}:dup:${id}` : base;

      tx.insert(assetTransactions).values({
        id, accountId: data.accountId, assetId: data.assetId,
        transactionType: "transfer_out", tradedAt,
        quantity: data.quantity,
        unitPrice: valueEur / data.quantity,
        tradeCurrency: "EUR", fxRateToEur: 1, fxSource: "unit",
        tradeGrossAmount: valueEur, tradeGrossAmountEur: valueEur,
        cashImpactEur: valueEur,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: valueEur,
        rowFingerprint,
        isListed: false, source: "manual",
        notes: data.notes ?? `retirada → custodia externa`,
      }).run();

      rebuildAfterTradeMutation(tx, data.accountId, data.assetId, data.tradeDate);

      const row = tx
        .select()
        .from(assetTransactions)
        .where(eq(assetTransactions.id, id))
        .get();
      if (!row) throw new Error("withdrawal insert vanished");

      tx.insert(auditEvents).values({
        id: ulid(),
        entityType: "asset_transaction",
        entityId: id,
        action: "create-asset-withdrawal",
        actorType: "user",
        source: "ui",
        summary: `retirada ${data.quantity} ${asset.name} → custodia externa`,
        previousJson: null,
        nextJson: JSON.stringify(row),
        contextJson: JSON.stringify({ actor: ACTOR }),
        createdAt: Date.now(),
      }).run();

      return { id };
    });

    revalidateTradeMutation(data.accountId);
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    if (message.startsWith("duplicate withdrawal")) {
      return {
        ok: false,
        error: {
          code: "duplicate",
          message:
            "Ya existe una retirada idéntica (misma cuenta, activo, fecha, cantidad y valor).",
        },
      };
    }
    if (message.startsWith("tax-lots:")) {
      const friendly = `La retirada supera las unidades poseídas en esa fecha (comprobación FIFO): ${message}`;
      return {
        ok: false,
        error: {
          code: "validation",
          message: friendly,
          fieldErrors: { quantity: [friendly] },
        },
      };
    }
    if (message.startsWith("account not found")) {
      return { ok: false, error: { code: "not_found", message: "cuenta no encontrada" } };
    }
    if (message.startsWith("asset not found")) {
      return { ok: false, error: { code: "not_found", message: "activo no encontrado" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
