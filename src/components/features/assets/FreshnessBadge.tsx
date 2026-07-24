import { Badge } from "@/src/components/ui/Badge";
import type { PriceFreshness } from "@/src/server/assets";

const KNOWN: Record<string, { label: string; variant: "success" | "neutral" | "warning" }> = {
  yahoo: { label: "Yahoo", variant: "success" },
  "yahoo-backfill": { label: "Yahoo", variant: "success" },
  coingecko: { label: "CoinGecko", variant: "success" },
  ft: { label: "Financial Times", variant: "success" },
  tradingview: { label: "TradingView", variant: "success" },
  rebuilt: { label: "Reconstruido", variant: "neutral" },
  manual: { label: "Manual", variant: "neutral" },
};

/** Badge de fuente + fecha del último precio. Compartido entre la tabla de
 *  activos y la cabecera del detalle — un solo mapa de proveedores. */
export function FreshnessBadge({ freshness }: { freshness: PriceFreshness }) {
  if (!freshness) {
    return <span className="text-xs text-muted-foreground">Sin precio</span>;
  }
  const when = new Date(freshness.pricedAt).toISOString().slice(0, 10);
  const known = KNOWN[freshness.source];
  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant={known?.variant ?? "warning"}>{known?.label ?? freshness.source}</Badge>
      <span className="text-xs text-muted-foreground">{when}</span>
    </span>
  );
}
