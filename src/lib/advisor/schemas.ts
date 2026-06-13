import { z } from "zod";

/**
 * One mutation the advisor proposes to the personal memory. Hybrid policy
 * (decision c): `add` applies automatically (logged); `update`/`remove` require
 * the Commander's confirmation. The classification is enforced by the applier,
 * not by the model — an `add` can never delete.
 */
export const memoryOpSchema = z.object({
  op: z.enum(["add", "update", "remove"]),
  /** Short label of the fact/objective, e.g. "tolerancia al riesgo". */
  field: z.string().trim().min(1).max(80),
  /** New value; omitted for `remove`. */
  value: z.string().trim().max(600).optional(),
  /** Why the advisor proposes this — shown to the user and logged. */
  reason: z.string().trim().min(1).max(400),
});
export type MemoryOp = z.infer<typeof memoryOpSchema>;

export const memoryOpsSchema = z.object({
  ops: z.array(memoryOpSchema).max(20),
});
export type MemoryOps = z.infer<typeof memoryOpsSchema>;

/** A pending update/remove awaiting confirmation, persisted in pending/. */
export const memoryProposalSchema = memoryOpSchema.extend({
  id: z.string().min(1),
  proposedAt: z.number(),
});
export type MemoryProposal = z.infer<typeof memoryProposalSchema>;

const historyTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(20000),
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  sessionId: z.string().trim().min(1).max(64),
  history: z.array(historyTurnSchema).max(40).default([]),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;
