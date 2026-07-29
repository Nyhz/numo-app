// Relleno de histórico al reactivar un activo. Un activo desactivado queda
// fuera del cron de precios; al volver a activarlo su price_history tiene un
// hueco desde la desactivación hasta hoy. Este orquestador lo repara en
// segundo plano: gap-fill de precios+FX (src/lib/price-backfill), rebuild de
// las valoraciones del activo con el motor canónico (solo días con posición —
// qty<=0 nunca escribe fila, así que el resto de gráficas y cómputos no ven
// datos nuevos salvo los días realmente en cartera) y refresh de la serie
// diaria materializada.

import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../db/client";
import { auditEvents } from "../db/schema";
import {
  backfillAssetPriceGap,
  type AssetGapBackfillResult,
  type GapClients,
} from "../lib/price-backfill";
import { coingeckoProvider, ftProvider, yahooProvider } from "../lib/pricing";
import { withRetry } from "../lib/pricing/_net";
import { rebuildDailyBalances } from "./dailyBalances";
import { rebuildValuationsForAsset } from "./valuations";

export type ReactivationBackfillSummary = {
  assetId: string;
  gap: AssetGapBackfillResult;
  valuationsRebuilt: boolean;
  dailyBalanceRows: number | null;
};

function liveClients(): GapClients {
  return {
    yahoo: { fetchHistory: (s, f, t) => withRetry(() => yahooProvider.fetchHistory(s, f, t)) },
    coingecko: {
      fetchHistory: (s, f, t) => withRetry(() => coingeckoProvider.fetchHistory(s, f, t)),
    },
    ft: { fetchHistory: (s, f, t) => withRetry(() => ftProvider.fetchHistory(s, f, t)) },
  };
}

export async function runReactivationBackfill(
  assetId: string,
  db: DB = defaultDb,
  clients: GapClients = liveClients(),
): Promise<ReactivationBackfillSummary> {
  const gap = await backfillAssetPriceGap(db, assetId, clients);

  let valuationsRebuilt = false;
  let dailyBalanceRows: number | null = null;
  if (!gap.skipped && gap.fromIso) {
    // Los dos bloques de abajo son síncronos (better-sqlite3) y bloquean el
    // único event loop de Next mientras duran. Ceder el turno antes de cada
    // uno deja colar las requests encoladas entre etapa y etapa.
    await yieldEventLoop();
    const now = Date.now();
    db.transaction((tx) => {
      // Rebuild acotado al hueco — las filas previas no cambiaron (audit P1).
      rebuildValuationsForAsset(tx, assetId, gap.fromIso ?? undefined);
      tx.insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "asset",
          entityId: assetId,
          action: "reactivation_backfill",
          actorType: "system",
          source: "system",
          summary: `gap-fill ${gap.fromIso} → ${gap.toIso}: ${gap.priceRowsInserted} precios, ${gap.fxRowsInserted} FX`,
          previousJson: null,
          nextJson: null,
          contextJson: JSON.stringify(gap),
          createdAt: now,
        })
        .run();
    });
    valuationsRebuilt = true;
    await yieldEventLoop();
    dailyBalanceRows = rebuildDailyBalances(db);
  }

  return { assetId, gap, valuationsRebuilt, dailyBalanceRows };
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Backfills en curso, por activo: desactivar/reactivar dos veces seguidas no
 *  debe lanzar dos gap-fills concurrentes (inserts idempotentes, pero red y
 *  rebuilds duplicados). */
const backfillsInFlight = new Set<string>();

/** Disparo fire-and-forget desde el action de reactivación. Solo actúa sobre
 *  la BD real — los tests inyectan la suya y no deben tocar red. */
export function fireReactivationBackfill(assetId: string, db: DB): void {
  if (db !== defaultDb) return;
  if (backfillsInFlight.has(assetId)) return;
  backfillsInFlight.add(assetId);
  void runReactivationBackfill(assetId)
    .catch((err) => {
      console.error(`[reactivation-backfill] ${assetId}:`, err);
    })
    .finally(() => {
      backfillsInFlight.delete(assetId);
    });
}
