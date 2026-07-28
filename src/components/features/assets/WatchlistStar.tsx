"use client";

import * as React from "react";
import { Star } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import { cn } from "@/src/lib/cn";
import { toggleAssetWatchlist } from "@/src/actions/toggleAssetWatchlist";
import { refreshWatchlistQuote } from "@/src/actions/refreshWatchlistQuote";
import { toastResult } from "@/src/lib/toast";

// Star toggle for the Assets table. Optimistic: flips instantly, reconciles when
// the server action resolves (and the revalidated page re-renders).
export function WatchlistStar({
  assetId,
  watchlisted,
}: {
  assetId: string;
  watchlisted: boolean;
}) {
  const [optimistic, setOptimistic] = React.useState(watchlisted);
  const [pending, startTransition] = React.useTransition();

  // Reconcile with the server value when the revalidated prop changes (React's
  // adjust-state-during-render pattern — no effect needed).
  const [prevWatchlisted, setPrevWatchlisted] = React.useState(watchlisted);
  if (prevWatchlisted !== watchlisted) {
    setPrevWatchlisted(watchlisted);
    setOptimistic(watchlisted);
  }

  function onClick() {
    const next = !optimistic;
    setOptimistic(next);
    startTransition(async () => {
      const res = await toggleAssetWatchlist({ id: assetId, watchlisted: next });
      if (!toastResult(res, next ? "Añadido a la watchlist" : "Quitado de la watchlist")) {
        setOptimistic(!next); // revert on failure
        return;
      }
      // Pull a price right away on add so the Watchlist card isn't blank until
      // the next 15-min cron tick. Best-effort: a failed fetch is harmless.
      if (next) await refreshWatchlistQuote({ assetId });
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={pending}
      aria-pressed={optimistic}
      aria-label={optimistic ? "Quitar de la watchlist" : "Añadir a la watchlist"}
      title={optimistic ? "Quitar de la watchlist" : "Añadir a la watchlist"}
    >
      <Star
        className={cn(
          "h-4 w-4 transition-colors",
          optimistic ? "fill-warning text-warning" : "text-muted-foreground",
        )}
      />
    </Button>
  );
}
