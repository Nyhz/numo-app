import { resolve } from "node:path";
import { and, eq, gte } from "drizzle-orm";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import type { GapClients } from "../../lib/price-backfill";
import { DAY_MS, toIsoDate } from "../../lib/time";
import { runReactivationBackfill } from "../reactivation";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function isoDaysAgo(n: number): string {
  return toIsoDate(new Date(Date.now() - n * DAY_MS));
}

function clients(bars: Record<string, Array<{ date: string; close: number }>>): GapClients {
  const make = () => ({
    fetchHistory: vi.fn(async (symbol: string) =>
      (bars[symbol] ?? []).map((r) => ({ ...r, currency: "EUR" })),
    ),
  });
  return { yahoo: make(), coingecko: make(), ft: make() };
}

describe("runReactivationBackfill", () => {
  it("rellena el hueco, reconstruye valoraciones solo de días con posición y audita", async () => {
    const db = makeDb();
    db.insert(schema.accounts).values({
      id: "acct", name: "Binance", accountType: "crypto",
      currency: "EUR", openingBalanceEur: 0, currentCashBalanceEur: 0,
    }).run();
    // Crypto → valoración diaria (sin huecos de fin de semana en el test).
    db.insert(schema.assets).values({
      id: "ast", name: "DOGE", assetType: "crypto", symbol: "DOGE",
      providerSymbol: "dogecoin", currency: "EUR", isActive: true,
    }).run();
    db.insert(schema.assetTransactions).values({
      id: "tx1", accountId: "acct", assetId: "ast",
      transactionType: "buy", tradedAt: Date.now() - 10 * DAY_MS,
      quantity: 100, unitPrice: 0.1, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 10, tradeGrossAmountEur: 10,
      cashImpactEur: -10, feesAmount: 0, feesAmountEur: 0, netAmountEur: -10,
      isListed: true, source: "manual",
    }).run();
    // Histórico hasta hace 5 días — el «periodo desactivado» es el hueco.
    for (let n = 10; n >= 5; n--) {
      db.insert(schema.priceHistory).values({
        id: `ph_${n}`, symbol: "dogecoin", price: 0.1,
        pricedAt: Date.now() - n * DAY_MS, pricedDateUtc: isoDaysAgo(n),
        source: "coingecko", createdAt: 1,
      }).run();
    }

    const gapBars = [];
    for (let n = 4; n >= 0; n--) gapBars.push({ date: isoDaysAgo(n), close: 0.2 });
    const c = clients({ dogecoin: gapBars });

    const summary = await runReactivationBackfill("ast", db, c);

    expect(summary.gap.skipped).toBeUndefined();
    expect(summary.gap.fromIso).toBe(isoDaysAgo(4));
    expect(summary.gap.priceRowsInserted).toBe(5);
    expect(summary.valuationsRebuilt).toBe(true);

    // Valoraciones del hueco reconstruidas con la posición viva (qty 100).
    const vals = db.select().from(schema.assetValuations)
      .where(and(
        eq(schema.assetValuations.assetId, "ast"),
        gte(schema.assetValuations.valuationDate, isoDaysAgo(4)),
      )).all();
    expect(vals.length).toBe(5);
    for (const v of vals) {
      expect(v.quantity).toBe(100);
      expect(v.unitPriceEur).toBeCloseTo(0.2, 10);
    }

    const audit = db.select().from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, "ast")).all();
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("reactivation_backfill");
    expect(audit[0].actorType).toBe("system");
  });

  it("gap skipped (p. ej. TV sin histórico) → no reconstruye ni audita", async () => {
    const db = makeDb();
    db.insert(schema.assets).values({
      id: "ast_tv", name: "NGXA", assetType: "stock", symbol: "NGXA",
      priceSource: "tradingview", tradingviewSymbol: "NGXA",
      currency: "EUR", isActive: true,
    }).run();
    const summary = await runReactivationBackfill("ast_tv", db, clients({}));
    expect(summary.gap.skipped).toMatch(/tradingview/);
    expect(summary.valuationsRebuilt).toBe(false);
    expect(db.select().from(schema.auditEvents).all()).toHaveLength(0);
  });
});
