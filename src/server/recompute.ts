import { and, asc, eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import {
  accountCashMovements,
  accounts,
  assetPositions,
  assetTransactions,
} from "../db/schema";
import { applySplitFactor, isCashBearingAccount, splitFactorOf } from "../lib/domain";
import { round, roundEur } from "../lib/money";

import type { Tx } from "../db/client";

export type LedgerTrade = {
  transactionType: string;
  quantity: number;
  tradeGrossAmount: number;
  tradeGrossAmountEur: number;
  feesAmount: number;
  feesAmountEur: number;
  fxRateToEur: number;
  /** Solo filas "split": factor N:M de canje (ver applySplitFactor). */
  splitNumerator?: number | null;
  splitDenominator?: number | null;
};

export type LedgerFold = {
  /** Cantidad tras el replay, redondeada a 10dp. ≤ 0 ⇒ posición cerrada. */
  qty: number;
  totalCostNative: number;
  totalCostEur: number;
};

/**
 * Replay de coste medio ponderado sobre filas de asset_transactions en orden
 * cronológico. Única fuente de verdad de la matemática de coste: la consumen
 * el recompute de escritura y la lectura as-of del extracto.
 */
export function foldLedger(rows: LedgerTrade[]): LedgerFold {
  let qty = 0;
  let totalCostNative = 0;
  let totalCostEur = 0;

  for (const row of rows) {
    if (row.transactionType === "buy") {
      qty += row.quantity;
      // feesAmount may be denominated in EUR (degiro import, manual entry) —
      // derive the native-unit fee from the EUR snapshot instead of trusting
      // it, so the native cost pool never mixes currencies.
      totalCostNative +=
        row.tradeGrossAmount +
        (row.fxRateToEur > 0 ? row.feesAmountEur / row.fxRateToEur : row.feesAmount);
      totalCostEur += row.tradeGrossAmountEur + row.feesAmountEur;
    } else if (
      row.transactionType === "sell" ||
      // transfer_out: retirada a custodia externa — las unidades y su coste
      // salen del pool igual que en una venta, sin resultado fiscal asociado.
      row.transactionType === "transfer_out"
    ) {
      if (qty <= 0) {
        // Defensive: selling with no position; treat as no-op for cost basis.
        qty -= row.quantity;
        continue;
      }
      const fraction = Math.min(1, row.quantity / qty);
      totalCostNative -= totalCostNative * fraction;
      totalCostEur -= totalCostEur * fraction;
      qty -= row.quantity;
    } else if (row.transactionType === "split") {
      // Split / contra-split N:M: solo cambia el número de unidades. El pool
      // de coste queda intacto — no hay adquisición ni transmisión — y el
      // coste medio se re-escala solo al dividir coste/qty.
      const factor = splitFactorOf({
        splitNumerator: row.splitNumerator ?? null,
        splitDenominator: row.splitDenominator ?? null,
      });
      if (factor && qty > 0) {
        qty = applySplitFactor(qty, factor.numerator, factor.denominator);
      }
    }
    // dividend / fee: do not affect position quantity or cost basis here;
    // cash impact is captured on the paired cash_movement.
  }

  return { qty: round(qty, 10), totalCostNative, totalCostEur };
}

/**
 * Recompute the (global) asset_positions row by walking every asset_transactions
 * row for the asset in chronological order. The position row is scoped by
 * asset in the schema; `accountId` is accepted for call-site clarity but the
 * aggregation spans all accounts that hold the asset.
 *
 * Cost basis uses a running weighted-average: buys add `qty * unitPrice +
 * fees` to the pool; sells reduce the pool proportionally by the sold
 * fraction, leaving the average untouched. When quantity collapses to zero,
 * the position row is deleted so empty positions don't drift.
 */
export function recomputeAssetPosition(
  tx: Tx,
  _accountId: string,
  assetId: string,
): void {
  const rows = tx
    .select()
    .from(assetTransactions)
    .where(eq(assetTransactions.assetId, assetId))
    .orderBy(asc(assetTransactions.tradedAt), asc(assetTransactions.id))
    .all();

  const { qty, totalCostNative, totalCostEur } = foldLedger(rows);

  if (qty <= 0) {
    tx.delete(assetPositions).where(eq(assetPositions.assetId, assetId)).run();
    return;
  }

  const averageCostNative = round(totalCostNative / qty);
  const averageCostEur = round(totalCostEur / qty);
  const now = Date.now();

  const existing = tx
    .select()
    .from(assetPositions)
    .where(eq(assetPositions.assetId, assetId))
    .get();

  if (existing) {
    tx
      .update(assetPositions)
      .set({
        quantity: qty,
        averageCost: averageCostEur,
        averageCostNative,
        totalCostNative: round(totalCostNative),
        totalCostEur: round(totalCostEur),
        updatedAt: now,
      })
      .where(eq(assetPositions.assetId, assetId))
      .run();
  } else {
    tx
      .insert(assetPositions)
      .values({
        id: ulid(),
        assetId,
        quantity: qty,
        averageCost: averageCostEur,
        averageCostNative,
        totalCostNative: round(totalCostNative),
        totalCostEur: round(totalCostEur),
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

/**
 * Recompute `account.currentCashBalanceEur` as `openingBalanceEur + Σ
 * cash_movements.cashImpactEur` (where `affectsCashBalance = true`). Trades
 * write a paired cash_movement in the same tx, so this single rollup covers
 * every cash event including trade settlement.
 */
export function recomputeAccountCashBalance(tx: Tx, accountId: string): void {
  const account = tx.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new Error(`account not found: ${accountId}`);

  if (!isCashBearingAccount(account.accountType)) {
    tx
      .update(accounts)
      .set({ currentCashBalanceEur: 0, updatedAt: Date.now() })
      .where(eq(accounts.id, accountId))
      .run();
    return;
  }

  const sumRow = tx
    .select({ total: sql<number>`coalesce(sum(${accountCashMovements.cashImpactEur}), 0)` })
    .from(accountCashMovements)
    .where(
      and(
        eq(accountCashMovements.accountId, accountId),
        eq(accountCashMovements.affectsCashBalance, true),
      ),
    )
    .get();

  const movements = sumRow?.total ?? 0;
  const next = roundEur(account.openingBalanceEur + movements);

  tx
    .update(accounts)
    .set({ currentCashBalanceEur: next, updatedAt: Date.now() })
    .where(eq(accounts.id, accountId))
    .run();
}

