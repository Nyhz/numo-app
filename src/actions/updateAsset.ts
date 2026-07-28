"use server";


import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { assets, auditEvents, type Asset } from "../db/schema";
import { ACTOR, type ActionResult, revalidateAssetMetadata } from "./_shared";
import { inferAssetClassTax } from "../server/tax/classification";
import { fireReactivationBackfill } from "../server/reactivation";
import { updateAssetSchema } from "./updateAsset.schema";

export async function updateAsset(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Asset>> {
  const parsed = updateAssetSchema.safeParse(input);
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

  const { id, ...patch } = parsed.data;
  const now = Date.now();

  try {
    const { row: updated, reactivated } = db.transaction((tx) => {
      const previous = tx.select().from(assets).where(eq(assets.id, id)).get();
      if (!previous) throw new Error(`asset not found: ${id}`);

      const next: Partial<typeof assets.$inferInsert> = { updatedAt: now };
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.symbol !== undefined) next.symbol = patch.symbol;
      if (patch.isin !== undefined) next.isin = patch.isin;
      if (patch.assetType !== undefined) next.assetType = patch.assetType;
      if (patch.ter !== undefined) next.ter = patch.ter;
      if (patch.exchange !== undefined) next.exchange = patch.exchange;
      if (patch.providerSymbol !== undefined) next.providerSymbol = patch.providerSymbol;
      if (patch.tradingviewSymbol !== undefined) next.tradingviewSymbol = patch.tradingviewSymbol;
      if (patch.logoUrl !== undefined) next.logoUrl = patch.logoUrl;
      if (patch.priceSource !== undefined) next.priceSource = patch.priceSource;
      if (patch.isActive !== undefined) next.isActive = patch.isActive;

      // La clase fiscal se deriva de type/name/isin y decide la ventana
      // antiaplicación (2 vs 12 meses) y el bloque M720/M721. Si cambia
      // cualquiera de esas entradas hay que re-inferirla, o queda congelada en
      // la del alta y desalinea informe fiscal y sellado.
      if (
        patch.assetType !== undefined ||
        patch.isin !== undefined ||
        patch.name !== undefined
      ) {
        next.assetClassTax = inferAssetClassTax({
          assetType: next.assetType ?? previous.assetType,
          name: next.name ?? previous.name,
          ticker: next.symbol ?? previous.symbol,
          isin: next.isin ?? previous.isin,
        });
      }

      tx.update(assets).set(next).where(eq(assets.id, id)).run();

      const row = tx.select().from(assets).where(eq(assets.id, id)).get();
      if (!row) throw new Error("asset update vanished");

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "asset",
          entityId: id,
          action: "update",
          actorType: "user",
          source: "ui",
          summary: null,
          previousJson: JSON.stringify(previous),
          nextJson: JSON.stringify(row),
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: now,
        })
        .run();

      return { row, reactivated: !previous.isActive && row.isActive };
    });

    // Reactivación: rellenar en segundo plano el hueco de precios/FX del
    // periodo desactivado y reconstruir sus valoraciones — la respuesta del
    // action no espera a la red.
    if (reactivated) fireReactivationBackfill(id, db);

    revalidateAssetMetadata();
    return { ok: true, data: updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("asset not found")) {
      return { ok: false, error: { code: "not_found", message: "activo no encontrado" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
