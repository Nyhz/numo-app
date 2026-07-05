"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  assetPositions,
  assetTransactions,
  assetValuations,
  auditEvents,
  dailyBalances,
  fxRates,
  taxLotConsumptions,
  taxLots,
  taxWashSaleAdjustments,
  taxYearSnapshots,
} from "../db/schema";
import { ACTOR, type ActionResult } from "./_shared";

const wipeAppSchema = z.object({
  confirmation: z.literal("WIPE"),
});

// Preserva los catálogos de referencia y los ajustes que no cuelgan del
// ledger: `assets`, `price_history`, `tax_declared_baselines`, `objectives`,
// `price_alerts`, `alert_events`, `watchlist_quotes`, `discover_candidates` y
// las tablas `advisor_*`. Trunca el estado transaccional y derivado: cuentas,
// transacciones, movimientos de efectivo, valoraciones, posiciones, lotes
// fiscales, tasas FX, saldos diarios y eventos de auditoría. No genera
// huérfanos: lo preservado o no referencia cuentas o cuelga de `assets`.
// (El importador CSV fue eliminado en 2026-06; el registro es solo manual.)
export async function wipeApp(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ wiped: true }>> {
  const parsed = wipeAppSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Escribe WIPE para confirmar",
      },
    };
  }

  try {
    db.transaction((tx) => {
      // Row counts captured BEFORE deletion — the one trace the wipe leaves.
      const tables = {
        tax_wash_sale_adjustments: taxWashSaleAdjustments,
        tax_lot_consumptions: taxLotConsumptions,
        tax_lots: taxLots,
        tax_year_snapshots: taxYearSnapshots,
        account_cash_movements: accountCashMovements,
        asset_transactions: assetTransactions,
        asset_positions: assetPositions,
        asset_valuations: assetValuations,
        fx_rates: fxRates,
        daily_balances: dailyBalances,
        accounts,
        audit_events: auditEvents,
      } as const;
      const deletedRowCounts: Record<string, number> = {};
      for (const [name, table] of Object.entries(tables)) {
        const row = tx.select({ n: sql<number>`count(*)` }).from(table).get();
        deletedRowCounts[name] = row?.n ?? 0;
      }

      // Children first for clarity (cascades would otherwise handle most).
      tx.delete(taxWashSaleAdjustments).run();
      tx.delete(taxLotConsumptions).run();
      tx.delete(taxLots).run();
      tx.delete(taxYearSnapshots).run();
      tx.delete(accountCashMovements).run();
      tx.delete(assetTransactions).run();
      tx.delete(assetPositions).run();
      tx.delete(assetValuations).run();
      tx.delete(fxRates).run();
      tx.delete(dailyBalances).run();
      tx.delete(accounts).run();
      tx.delete(auditEvents).run();

      // Terminal audit event: the freshly truncated audit_events table gets
      // exactly one row recording that (and how much) data was wiped.
      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "app",
          entityId: "app",
          action: "wipe",
          actorType: "user",
          source: "ui",
          summary: "full data wipe (assets & price_history kept)",
          previousJson: null,
          nextJson: null,
          contextJson: JSON.stringify({ actor: ACTOR, deletedRowCounts }),
          createdAt: Date.now(),
        })
        .run();
    });

    for (const p of [
      "/",
      "/accounts",
      "/transactions",
      "/assets",
      "/audit",
      "/taxes",
      "/statement",
      "/settings",
    ]) {
      revalidatePath(p);
    }

    return { ok: true, data: { wiped: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    return { ok: false, error: { code: "db", message } };
  }
}
