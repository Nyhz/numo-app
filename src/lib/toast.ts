"use client";

import { toast } from "sonner";
import type { ActionResult } from "./domain";

/**
 * Feedback estándar de mutaciones: toda operación que altera la base de datos
 * lanza un toast al resolverse su Server Action.
 *
 * - Éxito → `toast.success(success)`.
 * - Fallo → `toast.error` con el mensaje del action, salvo `silentError` (para
 *   los formularios que ya pintan el error inline y no deben duplicarlo).
 *
 * Devuelve `result.ok` para poder encadenar: `if (!toastResult(res, "…")) return;`
 * Los mensajes nunca incluyen importes — los toasts viven fuera del árbol de
 * `<SensitiveValue>` y no deben filtrar dinero en modo sensible.
 */
export function toastResult<T>(
  result: ActionResult<T>,
  success: string,
  opts: { silentError?: boolean; description?: string } = {},
): result is Extract<ActionResult<T>, { ok: true }> {
  if (result.ok) {
    toast.success(success, opts.description ? { description: opts.description } : undefined);
    return true;
  }
  if (!opts.silentError) {
    toast.error("La operación ha fallado", { description: result.error.message });
  }
  return false;
}

// Re-export para toasts a medida (p. ej. la reactivación de un activo, que
// informa del backfill en segundo plano). Un único punto de entrada evita
// imports directos de sonner dispersos por los features.
export { toast };
