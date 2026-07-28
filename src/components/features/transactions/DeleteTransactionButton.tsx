"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { deleteTransaction } from "@/src/actions/deleteTransaction";
import { toast } from "@/src/lib/toast";

export function DeleteTransactionButton({ id }: { id: string }) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onConfirm() {
    setError(null);
    const result = await deleteTransaction({ id });
    if (!result.ok) {
      setError(result.error.message);
      throw new Error(result.error.message);
    }
    toast.success("Transacción eliminada");
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Eliminar transacción"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <ConfirmModal
        open={open}
        onOpenChange={setOpen}
        title="Eliminar transacción"
        description={
          error ??
          "Revierte el impacto en la posición y el saldo de efectivo y registra un evento de auditoría. No se puede deshacer."
        }
        confirmLabel="Eliminar"
        onConfirm={onConfirm}
      />
    </>
  );
}
