"use server";

import { and, asc, eq, lt } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, assets, assetTransactions, auditEvents } from "../db/schema";
import { applySplitFactor, splitLabel } from "../lib/domain";
import { round } from "../lib/money";
import { rebuildAfterTradeMutation } from "../server/rebuild";
import { foldLedger } from "../server/recompute";
import { assetSplitFingerprint } from "./_fingerprint";
import { createAssetSplitSchema } from "./createAssetSplit.schema";
import {
  ACTOR,
  type ActionResult,
  revalidateTradeMutation,
} from "./_shared";

/**
 * Split / contra-split (canje N nuevas por M antiguas): operación societaria
 * que re-escala la cantidad de TODA la posición del activo sin adquisición ni
 * transmisión. Fiscalmente neutra — los lotes FIFO conservan fecha de
 * adquisición y coste (bruto + comisiones); solo cambia el número de
 * unidades. Sin par fiscal, sin movimiento de caja y con `cashImpactEur = 0`:
 * la curva de patrimonio y el TWR/XIRR no ven flujo alguno.
 *
 * La fila se inserta a las 00:00 UTC de `effectiveDate` para que el replay la
 * aplique antes de cualquier operación intradía (altas manuales a las 12:00)
 * y las valoraciones de ese día usen ya la cantidad post-canje.
 */
export async function createAssetSplit(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createAssetSplitSchema.safeParse(input);
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
  const label = splitLabel(data.newShares, data.oldShares);

  try {
    const result = db.transaction((tx) => {
      const account = tx.select().from(accounts).where(eq(accounts.id, data.accountId)).get();
      if (!account) throw new Error("account not found");
      const asset = tx.select().from(assets).where(eq(assets.id, data.assetId)).get();
      if (!asset) throw new Error("asset not found");

      const tradedAt = new Date(`${data.effectiveDate}T00:00:00.000Z`).getTime();

      // Un canje sin unidades en cartera a esa fecha es un error de entrada
      // (fecha equivocada o activo equivocado), no un no-op silencioso.
      const priorRows = tx
        .select()
        .from(assetTransactions)
        .where(
          and(
            eq(assetTransactions.assetId, data.assetId),
            lt(assetTransactions.tradedAt, tradedAt),
          ),
        )
        .orderBy(asc(assetTransactions.tradedAt), asc(assetTransactions.id))
        .all();
      const held = foldLedger(priorRows).qty;
      if (held <= 0) throw new Error("no position at date");
      const resultingQty = round(
        applySplitFactor(held, data.newShares, data.oldShares),
        10,
      );

      const id = ulid();
      const base = assetSplitFingerprint({
        assetId: data.assetId,
        effectiveDate: data.effectiveDate,
        newShares: data.newShares,
        oldShares: data.oldShares,
      });
      const collision = tx
        .select({ id: assetTransactions.id })
        .from(assetTransactions)
        .where(eq(assetTransactions.rowFingerprint, base))
        .get();
      if (collision && !data.allowDuplicate) {
        throw new Error(`duplicate split: ${collision.id}`);
      }
      const rowFingerprint = collision ? `${base}:dup:${id}` : base;

      tx.insert(assetTransactions).values({
        id, accountId: data.accountId, assetId: data.assetId,
        transactionType: "split", tradedAt,
        quantity: 0,
        unitPrice: 0,
        splitNumerator: data.newShares,
        splitDenominator: data.oldShares,
        tradeCurrency: asset.currency, fxRateToEur: 1, fxSource: "unit",
        tradeGrossAmount: 0, tradeGrossAmountEur: 0,
        cashImpactEur: 0,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: 0,
        rowFingerprint,
        isListed: false, source: "manual",
        notes: data.notes ?? label,
      }).run();

      rebuildAfterTradeMutation(tx, data.accountId, data.assetId, data.effectiveDate);

      const row = tx
        .select()
        .from(assetTransactions)
        .where(eq(assetTransactions.id, id))
        .get();
      if (!row) throw new Error("split insert vanished");

      tx.insert(auditEvents).values({
        id: ulid(),
        entityType: "asset_transaction",
        entityId: id,
        action: "create-asset-split",
        actorType: "user",
        source: "ui",
        summary: `${label} ${asset.name}: ${held} → ${resultingQty} unidades`,
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
    if (message.startsWith("duplicate split")) {
      return {
        ok: false,
        error: {
          code: "duplicate",
          message: "Ya existe este mismo canje (mismo activo, fecha y factor).",
        },
      };
    }
    if (message.startsWith("no position at date")) {
      const friendly =
        "No hay unidades en cartera en la fecha efectiva del canje — revisa fecha y activo.";
      return {
        ok: false,
        error: {
          code: "validation",
          message: friendly,
          fieldErrors: { effectiveDate: [friendly] },
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
