"use server";

import { revalidatePath } from "next/cache";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { auditEvents } from "../db/schema";
import { BENCHMARK_KEYS, type BenchmarkKey } from "../lib/benchmarks";
import {
  ensureBenchmarkHistory,
  type EnsureBenchmarkSummary,
  type HistoryClient,
} from "../lib/benchmark-sync";
import { ACTOR, type ActionResult } from "./_shared";

const inputSchema = z.object({
  key: z.enum(BENCHMARK_KEYS as [BenchmarkKey, ...BenchmarkKey[]]),
});

/**
 * Backfills/refreshes a benchmark's price history before the overview chart
 * reads it. The provider fetch is async, so it runs OUTSIDE the transaction
 * (better-sqlite3 transactions are synchronous); the inserts dedup on the
 * (symbol, date) unique index, making the whole action idempotent.
 */
export async function activateBenchmark(
  input: unknown,
  db: DB = defaultDb,
  client?: HistoryClient,
): Promise<ActionResult<EnsureBenchmarkSummary>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "validation", message: "Benchmark desconocido" },
    };
  }

  try {
    const summary = await ensureBenchmarkHistory(db, parsed.data.key, client);

    if (summary.inserted > 0) {
      db.insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "benchmark",
          entityId: summary.key,
          action: "backfill",
          actorType: "user",
          source: "ui",
          summary: `${summary.symbol}: ${summary.inserted} precios (${summary.fromIso} → ${summary.toIso})`,
          previousJson: null,
          nextJson: JSON.stringify(summary),
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: Date.now(),
        })
        .run();
    }

    revalidatePath("/");
    return { ok: true, data: summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: { code: "db", message } };
  }
}
