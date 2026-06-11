import type { InformationalModelsStatus, AnnotatedBlock } from "../../server/tax/m720";

function needsAction(b: AnnotatedBlock): boolean {
  return b.status !== "ok";
}

export function buildM720DiffJson(models: InformationalModelsStatus): string {
  const all = [...models.m720.blocks, ...models.m721.blocks];
  const summary = {
    needsAction: all.some(needsAction),
    newBlocks: all.filter((b) => b.status === "new").length,
    delta20k: all.filter((b) => b.status === "delta_20k").length,
    fullExits: all.filter((b) => b.status === "full_exit").length,
  };
  return JSON.stringify({ summary, ...models }, null, 2);
}

export function buildM720DiffCsv(models: InformationalModelsStatus): string {
  const rows: string[] = ["\uFEFFmodel,country,type,status,value_eur,last_declared_eur,valuation_flags"];
  for (const [model, data] of [["m720", models.m720], ["m721", models.m721]] as const) {
    for (const b of data.blocks) {
      const flags = b.hasUnvalued ? "UNVALUED" : b.hasStale ? "stale" : "";
      rows.push(`${model},${b.country},${b.type},${b.status},${b.valueEur.toFixed(2)},${b.lastDeclaredEur?.toFixed(2) ?? ""},${flags}`);
    }
  }
  return rows.join("\n") + "\n";
}
