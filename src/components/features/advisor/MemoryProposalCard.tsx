"use client";

import * as React from "react";
import { Button } from "@/src/components/ui/Button";
import { applyMemoryProposal } from "@/src/actions/applyMemoryProposal";

export type Proposal = {
  id: string;
  op: string;
  field: string;
  value?: string;
  reason: string;
};

const OP_LABEL: Record<string, string> = {
  update: "Actualizar",
  remove: "Eliminar",
};

export function MemoryProposalCard({
  proposal,
  onResolved,
}: {
  proposal: Proposal;
  onResolved: (id: string) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function decide(decision: "confirm" | "discard") {
    setError(null);
    startTransition(async () => {
      const res = await applyMemoryProposal({ id: proposal.id, decision });
      if (res.ok) {
        onResolved(proposal.id);
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          El asesor propone: <span className="uppercase">{OP_LABEL[proposal.op] ?? proposal.op}</span>{" "}
          «{proposal.field}»
          {proposal.value ? ` → ${proposal.value}` : ""}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{proposal.reason}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => decide("confirm")} disabled={pending}>
          {pending ? "…" : "Confirmar"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => decide("discard")} disabled={pending}>
          Descartar
        </Button>
      </div>
    </div>
  );
}
