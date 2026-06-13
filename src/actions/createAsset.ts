"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { assets, auditEvents, type Asset } from "../db/schema";
import {
  ACTOR,
  type ActionResult,
  revalidateAssetMetadata,
} from "./_shared";
import { createAssetSchema } from "./createAsset.schema";

export async function createAsset(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Asset>> {
  const parsed = createAssetSchema.safeParse(input);
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
  const now = Date.now();
  const id = ulid();

  try {
    const inserted = db.transaction((tx) => {
      tx
        .insert(assets)
        .values({
          id,
          name: data.name,
          assetType: data.assetType,
          symbol: data.symbol,
          ter: data.ter ?? null,
          isin: data.isin ?? null,
          exchange: data.exchange ?? null,
          providerSymbol: data.providerSymbol ?? null,
          currency: data.currency,
          isActive: data.isActive,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const row = tx.select().from(assets).where(eq(assets.id, id)).get();
      if (!row) throw new Error("asset insert vanished");

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "asset",
          entityId: id,
          action: "create",
          actorType: "user",
          source: "ui",
          summary: null,
          previousJson: null,
          nextJson: JSON.stringify(row),
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: now,
        })
        .run();

      return row;
    });

    revalidateAssetMetadata();
    return { ok: true, data: inserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    return { ok: false, error: { code: "db", message } };
  }
}
