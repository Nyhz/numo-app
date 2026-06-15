"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/src/components/ui/Card";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import {
  setAssetObjective,
  setAssetExcludeFromObjectives,
} from "@/src/actions/objectives";
import { assetTypeLabel } from "@/src/components/ui/AssetTypeBadge";
import { formatEur } from "@/src/lib/format";
import type { Objective } from "@/src/db/schema";
import type { AssignableAsset } from "@/src/server/objectives";

export function AssetAssignmentTable({
  assets,
  objectives,
}: {
  assets: AssignableAsset[];
  objectives: Array<Pick<Objective, "id" | "name">>;
}) {
  const router = useRouter();
  const [pendingAsset, setPendingAsset] = React.useState<string | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);

  // Sentinel select value: "leave this asset out of the objectives plan".
  const EXCLUDE = "__exclude__";

  async function change(asset: AssignableAsset, value: string) {
    setPendingAsset(asset.assetId);
    setBanner(null);
    let result;
    if (value === EXCLUDE) {
      result = await setAssetExcludeFromObjectives({ assetId: asset.assetId, excluded: true });
    } else {
      // Re-including a previously excluded asset before (re)assigning it.
      if (asset.excludedFromObjectives) {
        const reinc = await setAssetExcludeFromObjectives({
          assetId: asset.assetId,
          excluded: false,
        });
        if (!reinc.ok) {
          setPendingAsset(null);
          setBanner(reinc.error.message);
          return;
        }
      }
      result = await setAssetObjective({
        assetId: asset.assetId,
        objectiveId: value === "" ? null : value,
      });
    }
    setPendingAsset(null);
    if (!result.ok) {
      setBanner(result.error.message);
      return;
    }
    router.refresh();
  }

  return (
    <Card title="Asignación de activos">
      {banner && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {banner}
        </div>
      )}
      {assets.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="Sin posiciones abiertas"
          description="Cuando tengas posiciones podrás asignarlas a un objetivo."
        />
      ) : (
        <DataTable<AssignableAsset>
          rows={assets}
          getRowKey={(a) => a.assetId}
          columns={[
            {
              key: "asset",
              header: "Activo",
              cell: (a) => (
                <div className="flex flex-col leading-tight">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.symbol ?? "—"} · {assetTypeLabel(a.assetType)}
                  </span>
                </div>
              ),
            },
            {
              key: "value",
              header: "Valor",
              align: "right",
              cell: (a) =>
                a.valueEur == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <SensitiveValue className="tabular-nums">
                    {formatEur(a.valueEur)}
                  </SensitiveValue>
                ),
            },
            {
              key: "objective",
              header: "Objetivo",
              align: "right",
              cell: (a) => (
                <select
                  value={a.excludedFromObjectives ? EXCLUDE : a.objectiveId ?? ""}
                  onChange={(e) => change(a, e.target.value)}
                  disabled={pendingAsset === a.assetId}
                  aria-label={`Objetivo de ${a.name}`}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                >
                  <option value="">Sin objetivo</option>
                  {objectives.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                  <option value={EXCLUDE}>Excluir de objetivos</option>
                </select>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}
