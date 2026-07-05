import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import { accounts, assets, assetTransactions } from "../../../db/schema";
import { buildYearEndBalances } from "../yearEnd";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function insertTrade(db: DB, accountId: string, assetId: string, opts: {
  type: string; qty: number; valueEur: number; tradedAt: number;
}): void {
  db.insert(assetTransactions).values({
    id: ulid(), accountId, assetId,
    transactionType: opts.type,
    tradedAt: opts.tradedAt,
    quantity: opts.qty, unitPrice: opts.valueEur / opts.qty,
    tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: opts.valueEur, tradeGrossAmountEur: opts.valueEur,
    cashImpactEur: opts.type === "buy" ? -opts.valueEur : opts.valueEur,
    feesAmount: 0, feesAmountEur: 0, netAmountEur: opts.type === "buy" ? -opts.valueEur : opts.valueEur,
    isListed: false, source: "manual",
  }).run();
}

describe("buildYearEndBalances — retiradas (transfer_out)", () => {
  it("un activo retirado íntegramente no aparece en la custodia de cierre", () => {
    const db = makeDb();
    const accountId = ulid();
    const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "BINANCE", currency: "EUR", accountType: "crypto", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "USDT", assetType: "crypto", currency: "EUR", isActive: true, assetClassTax: "crypto" }).run();

    insertTrade(db, accountId, assetId, { type: "buy", qty: 10, valueEur: 100, tradedAt: Date.UTC(2026, 5, 1) });
    insertTrade(db, accountId, assetId, { type: "transfer_out", qty: 10, valueEur: 100, tradedAt: Date.UTC(2026, 5, 29) });

    const balances = buildYearEndBalances(db, Date.UTC(2027, 0, 1));
    expect(balances.find((b) => b.assetId === assetId)).toBeUndefined();
  });
});
