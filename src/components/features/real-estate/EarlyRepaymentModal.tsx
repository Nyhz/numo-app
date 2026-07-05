"use client";

import type { PropertySummary } from "@/src/server/realEstate";

// STUB — Task 11 lo reemplaza por el modal real de amortización anticipada.
export function EarlyRepaymentModal({
  summary,
  open,
  onOpenChange,
}: {
  summary: PropertySummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return null;
}
