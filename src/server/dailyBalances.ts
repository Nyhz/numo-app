import { asc, gte, max, sql } from "drizzle-orm";
import { db as defaultDb, type DB, type Tx } from "../db/client";
import {
  accountCashMovements,
  accounts,
  assets,
  assetTransactions,
  assetValuations,
  dailyBalances,
} from "../db/schema";
import { applySplitFactor, splitFactorOf } from "../lib/domain";
import { roundEur } from "../lib/money";
import { ulid } from "ulid";

/**
 * Serie diaria materializada (caché derivada de la curva de patrimonio).
 *
 * Una fila por (cuenta, día): `balanceEur` = caja a fin de día (apertura +
 * movimientos acumulados); `investedEur` = valor de mercado de los activos
 * atribuidos a la cuenta (última cuenta que los operó, mismo criterio que el
 * Extracto). La suma de `investedEur` por fecha reproduce la serie canónica
 * de la home (paridad fijada por test en dailyBalances.test.ts), de modo que
 * el gráfico «Evolución del valor» puede leerla en vez de reconstruir toda la
 * historia en cada visita.
 *
 * Disciplina anti-deriva: es una caché — toda mutación que toque el pasado
 * llama a `invalidateDailyBalancesFrom` (delete-forward) y el lector detecta
 * el hueco (max(balance_date) < max(valuation_date)) y cae al cómputo vivo.
 * El cron nocturno reconstruye tras el sync de precios.
 */

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Borra la materialización desde `fromIso` (incluida). El lector caerá al
 *  cómputo vivo hasta que el cron reconstruya. */
export function invalidateDailyBalancesFrom(db: DB | Tx, fromIso: string): void {
  db.delete(dailyBalances).where(gte(dailyBalances.balanceDate, fromIso)).run();
}

/** Reconstrucción completa. Misma matemática que computeNetWorthSeries en su
 *  camino canónico (sin filtros): fallback a coste antes del primer precio,
 *  regla de fin de semana, forward-fill con cursor de cantidad. Devuelve el
 *  número de filas escritas. */
export function rebuildDailyBalances(db: DB = defaultDb): number {
  const trades = db
    .select()
    .from(assetTransactions)
    .orderBy(asc(assetTransactions.tradedAt), asc(assetTransactions.id))
    .all();

  const run = (tx: DB | Tx): number => {
    tx.delete(dailyBalances).run();
    if (trades.length === 0) return 0;

    const scopeAssetIds = [...new Set(trades.map((t) => t.assetId))];
    const valuations = db
      .select()
      .from(assetValuations)
      .orderBy(asc(assetValuations.valuationDate))
      .all()
      .filter((v) => scopeAssetIds.includes(v.assetId));

    type ValueRow = { assetId: string; valuationDate: string; marketValueEur: number };
    const allRows: ValueRow[] = valuations.map((v) => ({
      assetId: v.assetId,
      valuationDate: v.valuationDate,
      marketValueEur: v.marketValueEur,
    }));

    // Fallback a coste antes de la primera valoración real (misma síntesis
    // que la serie viva): el coste acumulado del activo cuenta como valor en
    // los días entre la compra y su primer precio publicado.
    const firstRealValByAsset = new Map<string, string>();
    for (const r of allRows) {
      const cur = firstRealValByAsset.get(r.assetId);
      if (cur === undefined || r.valuationDate < cur) {
        firstRealValByAsset.set(r.assetId, r.valuationDate);
      }
    }
    const runningByAsset = new Map<string, number>();
    for (const t of trades) {
      const running = (runningByAsset.get(t.assetId) ?? 0) - t.cashImpactEur;
      runningByAsset.set(t.assetId, running);
      if (running <= 0) continue;
      const tradeIso = toIsoDate(t.tradedAt);
      const firstReal = firstRealValByAsset.get(t.assetId);
      if (firstReal !== undefined && tradeIso >= firstReal) continue;
      allRows.push({
        assetId: t.assetId,
        valuationDate: tradeIso,
        marketValueEur: Math.round(running * 100) / 100,
      });
    }

    // Regla de fin de semana: solo si hay cripto en juego los sábados y
    // domingos aportan información; si no, son ruido forward-filled.
    const presentAssetIds = [...new Set(allRows.map((r) => r.assetId))];
    const assetRows =
      presentAssetIds.length > 0
        ? db.select().from(assets).all().filter((a) => presentAssetIds.includes(a.id))
        : [];
    const includeWeekends = assetRows.some((a) => a.assetType === "crypto");
    const keepDate = (iso: string): boolean => {
      if (includeWeekends) return true;
      const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
      return day !== 0 && day !== 6;
    };

    const datesSet = new Set<string>();
    const perAsset = new Map<string, Array<{ date: string; valueEur: number }>>();
    for (const row of allRows) {
      if (!keepDate(row.valuationDate)) continue;
      datesSet.add(row.valuationDate);
      const list = perAsset.get(row.assetId) ?? [];
      list.push({ date: row.valuationDate, valueEur: row.marketValueEur });
      perAsset.set(row.assetId, list);
    }
    const orderedDates = [...datesSet].sort();
    if (orderedDates.length === 0) return 0;

    // Cursor de cantidad por activo (buy/sell/transfer_out suman/restan;
    // split escala por su factor N:M): una posición cerrada deja de aportar
    // aunque su última valoración siga existiendo.
    type QtyEvent = {
      tradedAt: number;
      signedQty: number;
      split?: { numerator: number; denominator: number };
    };
    const tradesByAsset = new Map<string, QtyEvent[]>();
    // Atribución por cuenta: la última cuenta que operó el activo (mismo
    // criterio que primaryAccountByAsset en el Extracto).
    const accountByAsset = new Map<string, string>();
    for (const t of trades) {
      accountByAsset.set(t.assetId, t.accountId);
      let event: QtyEvent;
      if (t.transactionType === "buy" || t.transactionType === "sell" || t.transactionType === "transfer_out") {
        event = {
          tradedAt: t.tradedAt,
          signedQty: t.transactionType === "buy" ? t.quantity : -t.quantity,
        };
      } else if (t.transactionType === "split") {
        const factor = splitFactorOf(t);
        if (!factor) continue;
        event = { tradedAt: t.tradedAt, signedQty: 0, split: factor };
      } else {
        continue;
      }
      const list = tradesByAsset.get(t.assetId) ?? [];
      list.push(event);
      tradesByAsset.set(t.assetId, list);
    }

    // invested[cuenta][fecha]
    const investedByAccountDate = new Map<string, Map<string, number>>();
    for (const [assetId, series] of perAsset) {
      series.sort((a, b) => a.date.localeCompare(b.date));
      const accountId = accountByAsset.get(assetId);
      if (!accountId) continue;
      const assetTradeList = tradesByAsset.get(assetId) ?? [];
      let idx = 0;
      let last = 0;
      let seen = false;
      let tradeIdx = 0;
      let qty = 0;
      const byDate =
        investedByAccountDate.get(accountId) ?? new Map<string, number>();
      investedByAccountDate.set(accountId, byDate);
      for (const date of orderedDates) {
        while (idx < series.length && series[idx].date <= date) {
          last = series[idx].valueEur;
          seen = true;
          idx++;
        }
        const dayEnd = new Date(`${date}T23:59:59Z`).getTime();
        while (tradeIdx < assetTradeList.length && assetTradeList[tradeIdx].tradedAt <= dayEnd) {
          const ev = assetTradeList[tradeIdx];
          qty = ev.split
            ? applySplitFactor(qty, ev.split.numerator, ev.split.denominator)
            : qty + ev.signedQty;
          tradeIdx++;
        }
        if (!seen) continue;
        if (qty <= 1e-9) continue;
        byDate.set(date, (byDate.get(date) ?? 0) + last);
      }
    }

    // Caja por cuenta y día: apertura + movimientos acumulados a fin de día.
    const movements = db
      .select()
      .from(accountCashMovements)
      .orderBy(asc(accountCashMovements.occurredAt), asc(accountCashMovements.id))
      .all();
    const movementsByAccount = new Map<string, typeof movements>();
    for (const m of movements) {
      if (!m.affectsCashBalance) continue;
      const list = movementsByAccount.get(m.accountId) ?? [];
      list.push(m);
      movementsByAccount.set(m.accountId, list);
    }

    const accountRows = db.select().from(accounts).all();
    const now = Date.now();
    let written = 0;
    for (const account of accountRows) {
      const accMovements = movementsByAccount.get(account.id) ?? [];
      const invested = investedByAccountDate.get(account.id);
      let movIdx = 0;
      let cash = account.openingBalanceEur;
      for (const date of orderedDates) {
        const dayEnd = new Date(`${date}T23:59:59Z`).getTime();
        while (movIdx < accMovements.length && accMovements[movIdx].occurredAt <= dayEnd) {
          cash += accMovements[movIdx].cashImpactEur;
          movIdx++;
        }
        tx.insert(dailyBalances)
          .values({
            id: ulid(),
            accountId: account.id,
            balanceDate: date,
            balanceEur: roundEur(cash),
            investedEur: roundEur(invested?.get(date) ?? 0),
            createdAt: now,
          })
          .run();
        written++;
      }
    }
    return written;
  };

  // Reutilizable dentro de una transacción de acción o standalone.
  return "transaction" in db && typeof db.transaction === "function"
    ? db.transaction((tx) => run(tx))
    : run(db);
}

/** Serie canónica materializada (Σ investedEur por fecha) si está FRESCA:
 *  cubre hasta la última valoración de los activos en scope. Devuelve null
 *  si la tabla está vacía o invalidada — el llamante computa en vivo. */
export function materializedNetWorthByDate(
  db: DB,
  scopeAssetIds: string[],
  startIso: string | null,
): Map<string, number> | null {
  const maxBalance = db
    .select({ value: max(dailyBalances.balanceDate) })
    .from(dailyBalances)
    .get();
  if (!maxBalance?.value) return null;

  const maxValuation = db
    .select({ value: max(assetValuations.valuationDate) })
    .from(assetValuations)
    .where(
      scopeAssetIds.length > 0
        ? sql`${assetValuations.assetId} in ${scopeAssetIds}`
        : undefined,
    )
    .get();
  if (maxValuation?.value && maxValuation.value > maxBalance.value) return null;

  const rows = db
    .select({
      date: dailyBalances.balanceDate,
      valueEur: sql<number>`sum(${dailyBalances.investedEur})`,
    })
    .from(dailyBalances)
    .where(startIso ? gte(dailyBalances.balanceDate, startIso) : undefined)
    .groupBy(dailyBalances.balanceDate)
    .orderBy(asc(dailyBalances.balanceDate))
    .all();
  if (rows.length === 0) return null;

  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (r.valueEur > 0) byDate.set(r.date, r.valueEur);
  }
  return byDate.size > 0 ? byDate : null;
}
