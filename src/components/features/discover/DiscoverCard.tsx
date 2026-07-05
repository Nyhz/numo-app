import { ExternalLink } from "lucide-react";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { criterionByKey } from "@/src/lib/discover/criteria";
import type { DiscoverCandidate } from "@/src/db/schema";
import { AddToWatchlistButton } from "./AddToWatchlistButton";

// One verified opportunity: the agent's thesis + the deterministic hard number
// (`detail`), plus a button to follow it. Numbers go through SensitiveValue.
export function DiscoverCard({ candidate }: { candidate: DiscoverCandidate }) {
  const label = criterionByKey(candidate.criterion)?.label ?? candidate.criterion;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{candidate.name}</span>
          </div>
          <span className="text-xs text-muted-foreground">{candidate.symbol}</span>
        </div>
        <Badge variant="neutral">{label}</Badge>
      </div>

      {candidate.price != null && (
        <SensitiveValue as="div" className="text-lg font-semibold tabular-nums">
          {candidate.price.toLocaleString("es-ES", { maximumFractionDigits: 4 })}{" "}
          {candidate.currency ?? ""}
        </SensitiveValue>
      )}

      {/* The verified hard number — the reason this passed the screen. */}
      <SensitiveValue as="div" className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-sm font-medium tabular-nums">
        {candidate.detail}
      </SensitiveValue>

      <p className="text-sm text-muted-foreground">{candidate.thesis}</p>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <AddToWatchlistButton symbol={candidate.symbol} name={candidate.name} />
        {candidate.sourceUrl && (
          <a
            href={candidate.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Fuente <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </Card>
  );
}
