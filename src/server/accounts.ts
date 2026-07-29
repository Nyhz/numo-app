import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, dailyBalances, type Account, type DailyBalance } from "../db/schema";
import { isCashBearingAccount } from "../lib/domain";

export type AccountWithTotals = Account & {
  totalBalanceEur: number;
};

function effectiveCashEur(row: Account): number {
  return isCashBearingAccount(row.accountType) ? row.currentCashBalanceEur : 0;
}

// Memoizada por request: el shell de '/' y varios agregados de /statement la
// piden en el mismo render.
export const listAccounts = cache(
  async (db: DB = defaultDb): Promise<AccountWithTotals[]> => {
    const rows = await db.select().from(accounts).orderBy(asc(accounts.name)).all();
    return rows.map((row) => ({ ...row, totalBalanceEur: effectiveCashEur(row) }));
  },
);

export async function getAccount(id: string, db: DB = defaultDb): Promise<Account | null> {
  const row = await db.select().from(accounts).where(eq(accounts.id, id)).get();
  return row ?? null;
}

export const getAccountById = getAccount;

export async function getAccountDailyBalances(
  accountId: string,
  db: DB = defaultDb,
): Promise<DailyBalance[]> {
  return db
    .select()
    .from(dailyBalances)
    .where(eq(dailyBalances.accountId, accountId))
    .orderBy(asc(dailyBalances.balanceDate))
    .all();
}

export type AccountsSummary = {
  count: number;
  totalEur: number;
  byCurrency: Record<string, { count: number; totalEur: number }>;
};

export async function getAccountsSummary(db: DB = defaultDb): Promise<AccountsSummary> {
  const rows = await db.select().from(accounts).all();
  const byCurrency: Record<string, { count: number; totalEur: number }> = {};
  let totalEur = 0;
  for (const row of rows) {
    const cash = effectiveCashEur(row);
    totalEur += cash;
    const bucket = byCurrency[row.currency] ?? { count: 0, totalEur: 0 };
    bucket.count += 1;
    bucket.totalEur += cash;
    byCurrency[row.currency] = bucket;
  }
  return { count: rows.length, totalEur, byCurrency };
}
