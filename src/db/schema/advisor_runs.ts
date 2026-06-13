import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { idCol } from "./_shared";

/**
 * Observability + idempotency ledger for every AI-advisor invocation (chat,
 * memory extraction, market scan, weekly curation, …). Cost is the SDK-reported
 * `total_cost_usd` — the $200/mo subscription credit is denominated in USD.
 */
export const advisorRuns = sqliteTable(
  "advisor_runs",
  {
    id: idCol(),
    /** chat | memory | scan | curate | chat_compact | telegram */
    kind: text("kind").notNull(),
    /** Idempotency key per kind: '2026-06-14T09' (scan), '2026-W24' (curate); null for chat/memory. */
    slot: text("slot"),
    /** running | ok | error | skipped */
    status: text("status").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    webSearches: integer("web_searches"),
    costUsd: real("cost_usd"),
    errorMessage: text("error_message"),
    summary: text("summary"),
    startedAt: integer("started_at", { mode: "number" }).notNull(),
    finishedAt: integer("finished_at", { mode: "number" }),
  },
  (t) => ({
    kindIdx: index("advisor_runs_kind_idx").on(t.kind),
    startedAtIdx: index("advisor_runs_started_at_idx").on(t.startedAt),
    // Non-unique: code checks for an existing `ok` row per (kind, slot) before
    // running. A partial-unique index is deferred to Phase 2 if needed.
    slotIdx: index("advisor_runs_slot_idx").on(t.kind, t.slot),
  }),
);

export type AdvisorRun = typeof advisorRuns.$inferSelect;
export type NewAdvisorRun = typeof advisorRuns.$inferInsert;
