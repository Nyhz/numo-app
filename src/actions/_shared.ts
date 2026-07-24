import "server-only";
import { revalidatePath } from "next/cache";

export {
  ACTOR,
  ASSET_TYPES,
  ACCOUNT_TYPES,
  CASH_BEARING_ACCOUNT_TYPES,
  isCashBearingAccount,
} from "./_constants";
export type {
  ActionError,
  ActionResult,
  AssetType,
  AccountType,
} from "./_constants";

/**
 * Every action that mutates `asset_transactions` or its derived state needs
 * to invalidate the same set of pages (Overview, Accounts, Transactions,
 * Assets, Taxes, Audit, and the specific account's detail page).
 *
 * Centralising these helpers means future route additions / renames are a
 * single edit. Previously, each action maintained its own ad-hoc list and
 * they drifted — some missed `/taxes`, some missed `/audit`, etc.
 */
export function revalidateTradeMutation(accountId: string): void {
  for (const p of [
    "/",
    "/accounts",
    "/transactions",
    "/assets",
    "/taxes",
    "/audit",
    "/statement",
  ]) {
    revalidatePath(p);
  }
  revalidatePath(`/accounts/${accountId}`);
  // Detalle de activo: serie, lotes, KPIs y ledger filtrado derivan del trade.
  revalidatePath("/assets/[id]", "page");
}

export function revalidateCashMovement(accountId: string): void {
  // Los movimientos `interest` alimentan el informe fiscal y el efectivo en
  // divisa extranjera cuenta para los saldos M720 → incluir /taxes.
  for (const p of [
    "/",
    "/accounts",
    "/transactions",
    "/audit",
    "/statement",
    "/taxes",
  ]) {
    revalidatePath(p);
  }
  revalidatePath(`/accounts/${accountId}`);
}

export function revalidateAssetMetadata(): void {
  // El tipo/isin de un activo determina su clase fiscal y bloque M720/M721 →
  // incluir /taxes para que el informe refleje una re-clasificación.
  for (const p of ["/", "/assets", "/audit", "/taxes"]) {
    revalidatePath(p);
  }
  revalidatePath("/assets/[id]", "page");
}

// Watchlist membership, its alerts, and fired alert-events all surface on the
// Watchlist page, the global banner (mounted everywhere), the Assets table star,
// and the audit log.
export function revalidateWatchlist(): void {
  for (const p of ["/", "/watchlist", "/assets", "/audit"]) {
    revalidatePath(p);
  }
  // La estrella también vive en la cabecera del detalle de activo.
  revalidatePath("/assets/[id]", "page");
}

export function revalidateAccountMutation(): void {
  // Un saldo de apertura en divisa extranjera cuenta para los bloques M720 →
  // incluir /taxes.
  for (const p of ["/", "/accounts", "/audit", "/taxes"]) {
    revalidatePath(p);
  }
}

export function revalidateTaxEvent(year?: number): void {
  revalidatePath("/taxes");
  revalidatePath("/audit");
  if (year != null) revalidatePath(`/taxes/${year}`);
}

export function revalidateRealEstate(): void {
  for (const p of ["/", "/real-estate", "/statement"]) {
    revalidatePath(p);
  }
}
