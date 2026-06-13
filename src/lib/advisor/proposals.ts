import { readFileSync } from "node:fs";
import { ulid } from "ulid";
import { z } from "zod";
import { advisorPaths } from "./paths";
import { ensureDir, writeAtomic } from "./memory";
import { memoryProposalSchema, type MemoryOp, type MemoryProposal } from "./schemas";

/** Pending update/remove ops awaiting the Commander's confirmation. */
export function readProposals(): MemoryProposal[] {
  try {
    const parsed = z
      .array(memoryProposalSchema)
      .safeParse(JSON.parse(readFileSync(advisorPaths.proposals, "utf8")));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function write(list: MemoryProposal[]): void {
  ensureDir(advisorPaths.pendingDir);
  writeAtomic(advisorPaths.proposals, JSON.stringify(list, null, 2));
}

/** Queue update/remove ops; returns the full pending list afterwards. */
export function addProposals(ops: MemoryOp[], now: Date): MemoryProposal[] {
  const existing = readProposals();
  if (!ops.length) return existing;
  const fresh: MemoryProposal[] = ops.map((o) => ({
    ...o,
    id: ulid(),
    proposedAt: now.getTime(),
  }));
  const all = [...existing, ...fresh];
  write(all);
  return all;
}

export function findProposal(id: string): MemoryProposal | null {
  return readProposals().find((p) => p.id === id) ?? null;
}

export function removeProposal(id: string): void {
  write(readProposals().filter((p) => p.id !== id));
}
