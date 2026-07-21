import { and, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  assetTransactions,
  type AccountCashMovement,
  type AssetTransaction,
} from "../db/schema";
import { decodeCursor, encodeCursor } from "../lib/pagination";

export type ListTransactionsArgs = {
  cursor?: string;
  limit?: number;
  accountId?: string;
  assetId?: string;
  type?: string;
};

export type ListTransactionsResult = {
  items: AssetTransaction[];
  nextCursor: string | null;
};

const DEFAULT_LIMIT = 50;

export async function listTransactions(
  args: ListTransactionsArgs = {},
  db: DB = defaultDb,
): Promise<ListTransactionsResult> {
  const limit = args.limit ?? DEFAULT_LIMIT;
  if (limit <= 0) throw new Error("listTransactions: limit must be > 0");

  const filters: SQL[] = [];
  if (args.accountId) filters.push(eq(assetTransactions.accountId, args.accountId));
  if (args.assetId) filters.push(eq(assetTransactions.assetId, args.assetId));
  if (args.type) filters.push(eq(assetTransactions.transactionType, args.type));

  if (args.cursor) {
    const cur = decodeCursor(args.cursor);
    const sortKey = typeof cur.sortKey === "number" ? cur.sortKey : Number(cur.sortKey);
    filters.push(
      or(
        lt(assetTransactions.tradedAt, sortKey),
        and(eq(assetTransactions.tradedAt, sortKey), lt(assetTransactions.id, cur.id)),
      ) as SQL,
    );
  }

  const where = filters.length ? and(...filters) : undefined;
  const rows = await db
    .select()
    .from(assetTransactions)
    .where(where)
    .orderBy(desc(assetTransactions.tradedAt), desc(assetTransactions.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ id: last.id, sortKey: last.tradedAt }) : null;
  return { items, nextCursor };
}

export async function getTransaction(
  id: string,
  db: DB = defaultDb,
): Promise<AssetTransaction | null> {
  const row = await db
    .select()
    .from(assetTransactions)
    .where(eq(assetTransactions.id, id))
    .get();
  return row ?? null;
}

export type LedgerEntry =
  | {
      kind: "transaction";
      id: string;
      occurredAt: number;
      label: string;
      amountEur: number;
      assetId: string;
      /** null en filas split: su dato es el factor N:M, no una cantidad. */
      quantity: number | null;
      description: string | null;
      source: AssetTransaction;
    }
  | {
      kind: "cash_movement";
      id: string;
      occurredAt: number;
      label: string;
      amountEur: number;
      assetId: null;
      quantity: null;
      description: string | null;
      source: AccountCashMovement;
    };

export type ListLedgerResult = {
  items: LedgerEntry[];
  nextCursor: string | null;
};

const LEDGER_DEFAULT_LIMIT = 50;

function compareDesc(a: LedgerEntry, b: LedgerEntry): number {
  if (a.occurredAt !== b.occurredAt) return b.occurredAt - a.occurredAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export async function getLedgerForAccount(
  accountId: string,
  args: { cursor?: string; limit?: number } = {},
  db: DB = defaultDb,
): Promise<ListLedgerResult> {
  const limit = args.limit ?? LEDGER_DEFAULT_LIMIT;
  if (limit <= 0) throw new Error("getLedgerForAccount: limit must be > 0");

  let cursorSortKey: number | undefined;
  let cursorId: string | undefined;
  if (args.cursor) {
    const cur = decodeCursor(args.cursor);
    cursorSortKey = typeof cur.sortKey === "number" ? cur.sortKey : Number(cur.sortKey);
    cursorId = cur.id;
  }

  const txFilters: SQL[] = [eq(assetTransactions.accountId, accountId)];
  if (cursorSortKey !== undefined && cursorId !== undefined) {
    txFilters.push(
      or(
        lt(assetTransactions.tradedAt, cursorSortKey),
        and(eq(assetTransactions.tradedAt, cursorSortKey), lt(assetTransactions.id, cursorId)),
      ) as SQL,
    );
  }

  const cmFilters: SQL[] = [
    eq(accountCashMovements.accountId, accountId),
    // A non-null externalReference marks the movement as the cash shadow of
    // an asset_transactions row already listed above (trade, dividend, swap)
    // — listing it too would double-count the event.
    isNull(accountCashMovements.externalReference),
  ];
  if (cursorSortKey !== undefined && cursorId !== undefined) {
    cmFilters.push(
      or(
        lt(accountCashMovements.occurredAt, cursorSortKey),
        and(
          eq(accountCashMovements.occurredAt, cursorSortKey),
          lt(accountCashMovements.id, cursorId),
        ),
      ) as SQL,
    );
  }

  const [txRows, cmRows] = await Promise.all([
    db
      .select()
      .from(assetTransactions)
      .where(and(...txFilters))
      .orderBy(desc(assetTransactions.tradedAt), desc(assetTransactions.id))
      .limit(limit + 1)
      .all(),
    db
      .select()
      .from(accountCashMovements)
      .where(and(...cmFilters))
      .orderBy(desc(accountCashMovements.occurredAt), desc(accountCashMovements.id))
      .limit(limit + 1)
      .all(),
  ]);

  const entries: LedgerEntry[] = [
    ...txRows.map<LedgerEntry>((r) => ({
      kind: "transaction",
      id: r.id,
      occurredAt: r.tradedAt,
      label: r.transactionType,
      amountEur: r.cashImpactEur,
      assetId: r.assetId,
      // Una fila split no tiene cantidad propia (su dato es el factor N:M,
      // que ya viaja en las notas) — null evita un «· 0.0000» en el ledger.
      quantity: r.transactionType === "split" ? null : r.quantity,
      description: r.notes,
      source: r,
    })),
    ...cmRows.map<LedgerEntry>((r) => ({
      kind: "cash_movement",
      id: r.id,
      occurredAt: r.occurredAt,
      label: r.movementType,
      amountEur: r.cashImpactEur,
      assetId: null,
      quantity: null,
      description: r.description,
      source: r,
    })),
  ].sort(compareDesc);

  const hasMore = entries.length > limit;
  const items = hasMore ? entries.slice(0, limit) : entries;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ id: last.id, sortKey: last.occurredAt }) : null;
  return { items, nextCursor };
}

export async function listRecentTransactions(
  limit = 10,
  db: DB = defaultDb,
): Promise<AssetTransaction[]> {
  return db
    .select()
    .from(assetTransactions)
    .orderBy(desc(assetTransactions.tradedAt), desc(assetTransactions.id))
    .limit(limit)
    .all();
}
