import { Badge } from "@/src/components/ui/Badge";
import { AssetLogo } from "@/src/components/ui/AssetLogo";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { FreshnessBadge } from "@/src/components/features/assets/FreshnessBadge";
import { WatchlistStar } from "@/src/components/features/assets/WatchlistStar";
import { formatEur, formatPercent } from "@/src/lib/format";
import { assetClassTaxLabel, assetTypeLabel } from "@/src/lib/labels";
import type { AssetDetail } from "@/src/server/assetDetail";

const STATE_BADGE: Record<AssetDetail["state"], { label: string; variant: "success" | "neutral" }> = {
  open: { label: "Posición abierta", variant: "success" },
  closed: { label: "Posición cerrada", variant: "neutral" },
  untraded: { label: "Sin operaciones", variant: "neutral" },
};

export function AssetDetailHeader({ detail }: { detail: AssetDetail }) {
  const { asset, state, priceStatus, lastPrice } = detail;
  const stateBadge = STATE_BADGE[state];
  const dayChange = priceStatus.dayChange;
  const dayTone =
    dayChange == null
      ? ""
      : dayChange.pct > 0
        ? "text-success"
        : dayChange.pct < 0
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-4">
        <AssetLogo name={asset.name} logoUrl={asset.logoUrl} size={40} />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{asset.name}</h1>
            <WatchlistStar assetId={asset.id} watchlisted={asset.isWatchlisted} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {asset.symbol && <span className="font-medium tabular-nums">{asset.symbol}</span>}
            {asset.symbol && asset.isin && <span aria-hidden>·</span>}
            {asset.isin && <span className="tabular-nums">{asset.isin}</span>}
            <Badge variant="neutral">{assetTypeLabel(asset.assetType)}</Badge>
            {asset.assetClassTax && (
              <Badge variant="neutral" title="Clase fiscal">
                {assetClassTaxLabel(asset.assetClassTax)}
              </Badge>
            )}
            <Badge variant={stateBadge.variant}>{stateBadge.label}</Badge>
            {!asset.isActive && <Badge variant="warning">Inactivo</Badge>}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1.5">
        {lastPrice ? (
          <>
            <SensitiveValue className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatEur(lastPrice.unitPriceEur)}
            </SensitiveValue>
            {asset.priceSource === "ft" ? (
              <span className="text-xs text-muted-foreground">
                Último NAV {lastPrice.date}
              </span>
            ) : dayChange ? (
              <span
                className={`text-sm font-medium tabular-nums ${dayTone}`}
                title={`Cierre ${dayChange.lastDate} vs ${dayChange.prevDate}`}
              >
                {dayChange.pct >= 0 ? "+" : ""}
                {formatPercent(dayChange.pct)}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Sin precio de mercado</span>
        )}
        <FreshnessBadge freshness={priceStatus.freshness} />
      </div>
    </header>
  );
}
