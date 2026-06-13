import "server-only";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../../db/client";
import { advisorRuns } from "../../db/schema";
import type { AdvisorUsage } from "./client";

type RunUsage = Pick<AdvisorUsage, "costUsd" | "inputTokens" | "outputTokens" | "webSearches">;

/** Insert a completed advisor-run row (observability + cost tracking). */
export function recordAdvisorRun(
  r: {
    kind: string;
    slot?: string | null;
    status: "running" | "ok" | "error" | "skipped";
    model?: string;
    usage?: RunUsage;
    summary?: string;
    errorMessage?: string;
    startedAt: number;
    finishedAt?: number;
  },
  dbc: DB = defaultDb,
): void {
  dbc
    .insert(advisorRuns)
    .values({
      id: ulid(),
      kind: r.kind,
      slot: r.slot ?? null,
      status: r.status,
      model: r.model ?? null,
      inputTokens: r.usage?.inputTokens ?? null,
      outputTokens: r.usage?.outputTokens ?? null,
      webSearches: r.usage?.webSearches ?? null,
      costUsd: r.usage?.costUsd ?? null,
      errorMessage: r.errorMessage ?? null,
      summary: r.summary ?? null,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? Date.now(),
    })
    .run();
}
