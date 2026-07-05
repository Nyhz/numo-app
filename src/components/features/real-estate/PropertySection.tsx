"use client";

import type { PropertySummary } from "@/src/server/realEstate";

export function PropertySection({ summary }: { summary: PropertySummary }) {
  return <div className="text-sm text-muted-foreground">{summary.property.name}</div>;
}
