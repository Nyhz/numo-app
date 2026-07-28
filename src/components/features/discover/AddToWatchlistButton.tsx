"use client";

import * as React from "react";
import { Check, Star } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import { addSymbolToWatchlist } from "@/src/actions/addSymbolToWatchlist";
import { toast } from "@/src/lib/toast";

// Materialises a discovered ticker into the watchlist (find-or-create asset +
// flag + intraday quote). Flips to a confirmed state on success.
export function AddToWatchlistButton({ symbol, name }: { symbol: string; name: string }) {
  const [added, setAdded] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await addSymbolToWatchlist({ symbol, name });
      if (res.ok) {
        setAdded(true);
        toast.success("Añadido a la watchlist");
      } else setError(res.error.message);
    });
  }

  if (added) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
        <Check className="h-3.5 w-3.5" /> En watchlist
      </span>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="secondary" size="sm" onClick={add} disabled={pending}>
        <Star className="h-3.5 w-3.5" />
        {pending ? "Añadiendo…" : "Añadir a watchlist"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
