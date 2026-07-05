import { asc, eq, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import type { DbOrTx } from "../../db/client";
import { roundEur } from "../../lib/money";
import {
  assetTransactions,
  assets,
  taxLotConsumptions,
  taxLots,
  taxWashSaleAdjustments,
} from "../../db/schema";
import {
  addCalendarMonths,
  allocateLargestRemainder,
  washSaleWindowForAssetClass,
} from "./washSale";
import { inferAssetClassTax } from "./classification";


type MutableLot = {
  id: string;
  originTransactionId: string;
  accountId: string;
  acquiredAt: number;
  originalQty: number;
  remainingQty: number;
  // Exact remaining basis (gross + fees + integrated deferred losses),
  // unrounded. Consumptions subtract their ROUNDED cost from it, so every
  // half-cent of rounding stays in the lot and the final full drain absorbs
  // it: the consumed basis always reconciles with what was actually paid.
  remainingCostEur: number;
  // The deferred-loss portion of remainingCostEur, tracked for persistence
  // and UI; consumed proportionally alongside the rest of the basis.
  deferredLossAddedEur: number;
};

type PendingDeferral = { saleTransactionId: string; amountEur: number };

const EPS = 1e-9;

export function recomputeLotsForAsset(tx: DbOrTx, assetId: string): void {
  // 1. Wipe previous derivations for this asset.
  const txnRows = tx
    .select({ id: assetTransactions.id })
    .from(assetTransactions)
    .where(eq(assetTransactions.assetId, assetId))
    .all();
  const txnIds = txnRows.map((r) => r.id);
  if (txnIds.length > 0) {
    tx.delete(taxWashSaleAdjustments).where(inArray(taxWashSaleAdjustments.saleTransactionId, txnIds)).run();
    tx.delete(taxLotConsumptions).where(inArray(taxLotConsumptions.saleTransactionId, txnIds)).run();
  }
  tx.delete(taxLots).where(eq(taxLots.assetId, assetId)).run();

  const asset = tx.select().from(assets).where(eq(assets.id, assetId)).get();
  // Un assetClassTax nulo NO puede caer silenciosamente en la ventana de 2
  // meses (auditoría 2026-07): si falta, se infiere de los metadatos del
  // activo — la misma heurística que `pnpm backfill:asset-class`.
  const assetClassTax =
    asset?.assetClassTax ??
    (asset
      ? inferAssetClassTax({
          assetType: asset.assetType,
          subtype: asset.subtype,
          name: asset.name,
          ticker: asset.symbol,
          isin: asset.isin,
        })
      : null);
  const window = washSaleWindowForAssetClass(assetClassTax);

  // 2. Replay in chronological order. Wash-sale detection runs INLINE so a
  //    deferred loss lands on the absorbing lot before any later sell consumes
  //    it — the recovery the norm mandates ("a medida que se transmitan").
  const rows = tx
    .select()
    .from(assetTransactions)
    .where(eq(assetTransactions.assetId, assetId))
    .orderBy(
      asc(assetTransactions.tradedAt),
      asc(assetTransactions.transactionType), // buys ("buy") before disposals ("sell", "transfer_out") on same timestamp
      asc(assetTransactions.id),
    )
    .all();

  const open: MutableLot[] = [];
  const lotByOriginTxn = new Map<string, MutableLot>();
  // Deferred losses assigned to absorbing buys that happen AFTER the loss
  // sale: stashed by buy-transaction id, applied when that lot is created.
  const pendingDeferrals = new Map<string, PendingDeferral[]>();

  for (const row of rows) {
    if (row.transactionType === "buy") {
      if (row.quantity <= 0) {
        // Audit T11: a non-positive buy would silently vanish from cost basis.
        throw new Error(
          `tax-lots: buy ${row.id} for asset ${assetId} has non-positive quantity ${row.quantity} — corrupt row, fix or delete it`,
        );
      }
      const lotId = ulid();
      // Deferred losses from earlier loss-sales that this buy absorbs.
      let deferred = 0;
      const pending = pendingDeferrals.get(row.id);
      if (pending) {
        for (const p of pending) deferred += p.amountEur;
        pendingDeferrals.delete(row.id);
      }
      tx.insert(taxLots).values({
        id: lotId,
        assetId,
        accountId: row.accountId,
        originTransactionId: row.id,
        acquiredAt: row.tradedAt,
        originalQty: row.quantity,
        remainingQty: row.quantity,
        grossCostEur: row.tradeGrossAmountEur,
        feesEur: row.feesAmountEur,
        deferredLossAddedEur: deferred,
      }).run();
      // Adjustment rows reference the lot — insert AFTER it exists.
      if (pending) {
        for (const p of pending) {
          tx.insert(taxWashSaleAdjustments).values({
            id: ulid(),
            saleTransactionId: p.saleTransactionId,
            absorbingLotId: lotId,
            disallowedLossEur: p.amountEur,
            windowDays: window.daysLabel,
          }).run();
        }
      }
      const lot: MutableLot = {
        id: lotId,
        originTransactionId: row.id,
        accountId: row.accountId,
        acquiredAt: row.tradedAt,
        originalQty: row.quantity,
        remainingQty: row.quantity,
        remainingCostEur: row.tradeGrossAmountEur + row.feesAmountEur + deferred,
        deferredLossAddedEur: deferred,
      };
      open.push(lot);
      lotByOriginTxn.set(row.id, lot);
      continue;
    }

    // transfer_out (retirada a custodia externa) consume lotes FIFO como una
    // venta — las unidades dejan de existir para este ledger — pero sin
    // consumo fiscal: ni par FIFO en el informe ni antiaplicación. El coste
    // de lo retirado abandona el sistema sin generar resultado.
    const isDisposal =
      row.transactionType === "sell" || row.transactionType === "transfer_out";
    if (!isDisposal) continue;

    let remaining = row.quantity;
    const consumptions: { lot: MutableLot; qty: number; cost: number }[] = [];

    while (remaining > EPS && open.length > 0) {
      const lot = open[0];
      const fullDrain = remaining >= lot.remainingQty - EPS;
      const take = fullDrain ? lot.remainingQty : remaining;
      const share = take / lot.remainingQty;
      // Round once per consumption; subtract the ROUNDED cost from the exact
      // remainder so the lot carries the delta and the drain reconciles.
      const cost = fullDrain
        ? roundEur(lot.remainingCostEur)
        : roundEur(lot.remainingCostEur * share);
      const deferredConsumed = fullDrain
        ? lot.deferredLossAddedEur
        : lot.deferredLossAddedEur * share;
      consumptions.push({ lot, qty: take, cost });
      lot.remainingQty = fullDrain ? 0 : lot.remainingQty - take;
      lot.remainingCostEur = fullDrain ? 0 : lot.remainingCostEur - cost;
      lot.deferredLossAddedEur = Math.max(0, lot.deferredLossAddedEur - deferredConsumed);
      remaining -= take;
      if (lot.remainingQty <= EPS) open.shift();
    }

    if (remaining > EPS) {
      throw new Error(
        `tax-lots: ${row.transactionType} ${row.id} oversells asset ${assetId} by ${remaining} units — missing buy trades?`,
      );
    }

    for (const c of consumptions) {
      if (row.transactionType === "sell") {
        tx.insert(taxLotConsumptions).values({
          id: ulid(),
          saleTransactionId: row.id,
          lotId: c.lot.id,
          qtyConsumed: c.qty,
          costBasisEur: c.cost,
        }).run();
      }
      tx.update(taxLots).set({
        remainingQty: c.lot.remainingQty,
        deferredLossAddedEur: roundEur(c.lot.deferredLossAddedEur),
      }).where(eq(taxLots.id, c.lot.id)).run();
    }

    if (row.transactionType !== "sell") continue;

    // 3. Norma antiaplicación (art. 43.g/h NF 13/2013): a loss is deferred if
    //    homogeneous values were acquired within the calendar window around
    //    the sale. Past buys absorb on their SURVIVING units (units this very
    //    sale drained were definitively transmitted); future buys absorb on
    //    their full quantity once their lot is created.
    const consumedCostEur = consumptions.reduce((s, c) => s + c.cost, 0);
    const loss = row.tradeGrossAmountEur - consumedCostEur - row.feesAmountEur;
    if (loss >= 0) continue;

    const windowStart = addCalendarMonths(row.tradedAt, -window.months);
    const windowEnd = addCalendarMonths(row.tradedAt, window.months);

    type Absorber = { qty: number; lot: MutableLot | null; buyTxnId: string };
    const absorbers: Absorber[] = [];
    for (const buy of rows) {
      if (buy.transactionType !== "buy") continue;
      if (buy.tradedAt < windowStart || buy.tradedAt > windowEnd) continue;
      if (buy.tradedAt <= row.tradedAt) {
        const lot = lotByOriginTxn.get(buy.id);
        if (lot && lot.remainingQty > EPS) {
          absorbers.push({ qty: lot.remainingQty, lot, buyTxnId: buy.id });
        }
      } else {
        absorbers.push({ qty: buy.quantity, lot: null, buyTxnId: buy.id });
      }
    }
    if (absorbers.length === 0) continue;

    const soldQty = row.quantity;
    const acquiredQty = absorbers.reduce((s, a) => s + a.qty, 0);
    const absorbingQty = Math.min(soldQty, acquiredQty);
    if (absorbingQty <= 0) continue;

    const totalDisallowed = roundEur(Math.abs(loss) * (absorbingQty / soldQty));
    const shares = allocateLargestRemainder(totalDisallowed, absorbers.map((a) => a.qty));

    for (let i = 0; i < absorbers.length; i++) {
      const share = shares[i];
      if (share <= 0) continue;
      const a = absorbers[i];
      if (a.lot) {
        tx.insert(taxWashSaleAdjustments).values({
          id: ulid(),
          saleTransactionId: row.id,
          absorbingLotId: a.lot.id,
          disallowedLossEur: share,
          windowDays: window.daysLabel,
        }).run();
        a.lot.deferredLossAddedEur += share;
        a.lot.remainingCostEur += share;
        tx.update(taxLots).set({
          deferredLossAddedEur: roundEur(a.lot.deferredLossAddedEur),
        }).where(eq(taxLots.id, a.lot.id)).run();
      } else {
        const list = pendingDeferrals.get(a.buyTxnId) ?? [];
        list.push({ saleTransactionId: row.id, amountEur: share });
        pendingDeferrals.set(a.buyTxnId, list);
      }
    }
  }
}
