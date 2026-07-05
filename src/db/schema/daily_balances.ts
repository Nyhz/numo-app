import { index, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts";
import { createdAtCol, idCol } from "./_shared";

/** Serie diaria materializada por cuenta (escrita por rebuildDailyBalances):
 *  `balanceEur` = caja a fin de día; `investedEur` = valor de mercado de los
 *  activos atribuidos a la cuenta (Σ por fecha = serie canónica de la home).
 *  Es caché derivada: se invalida delete-forward en cada mutación y se
 *  reconstruye en el cron nocturno. */
export const dailyBalances = sqliteTable(
  "daily_balances",
  {
    id: idCol(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    balanceDate: text("balance_date").notNull(), // ISO yyyy-MM-dd
    balanceEur: real("balance_eur").notNull(),
    investedEur: real("invested_eur").notNull().default(0),
    createdAt: createdAtCol(),
  },
  (t) => ({
    accountDateIdx: uniqueIndex("daily_balances_account_date_idx").on(t.accountId, t.balanceDate),
    dateIdx: index("daily_balances_date_idx").on(t.balanceDate),
  }),
);

export type DailyBalance = typeof dailyBalances.$inferSelect;
export type NewDailyBalance = typeof dailyBalances.$inferInsert;
