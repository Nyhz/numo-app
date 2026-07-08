// Mapas de etiquetas de visualización compartidos. Los valores almacenados
// (enums de la DB) permanecen en inglés — aquí solo se traduce la UI.
// Client-safe: sin imports de servidor.

import type { AccountType } from "@/src/lib/domain";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  broker: "Bróker",
  crypto: "Cripto",
  investment: "Inversión",
  savings: "Ahorro",
};

export function accountTypeLabel(type: string): string {
  return ACCOUNT_TYPE_LABELS[type as AccountType] ?? type;
}

/** Cubre todos los CASH_MOVEMENT_KINDS más el "trade" derivado del ledger. */
export const CASH_MOVEMENT_LABELS: Record<string, string> = {
  deposit: "Ingreso",
  withdrawal: "Retirada",
  interest: "Intereses",
  fee: "Comisión",
  dividend: "Dividendo",
  trade: "Operación",
  "transfer-in": "Transferencia recibida",
  "transfer-out": "Transferencia enviada",
};

export function cashMovementLabel(kind: string): string {
  return CASH_MOVEMENT_LABELS[kind] ?? kind;
}

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  buy: "Compra",
  sell: "Venta",
  dividend: "Dividendo",
  // Distinto del kind de caja "transfer-out": esto es salida de UNIDADES de
  // un activo a custodia externa, sin venta fiscal ni movimiento de efectivo.
  transfer_out: "Retirada de activo",
};

export function transactionTypeLabel(type: string): string {
  return TRANSACTION_TYPE_LABELS[type] ?? type;
}

/** Etiqueta para filas de ledger mixto (transacciones + movimientos de efectivo). */
export function ledgerLabel(label: string): string {
  return TRANSACTION_TYPE_LABELS[label] ?? CASH_MOVEMENT_LABELS[label] ?? label;
}

/** País de la ENTIDAD custodia (broker/banco), no de los activos que contiene
 *  — es lo que decide si una cuenta alimenta los bloques del M720/M721.
 *  Selector cerrado: un typo en texto libre rompería el contraste por
 *  geografía. Lista acotada a custodios plausibles para este panel. */
export const ACCOUNT_COUNTRY_LABELS: Record<string, string> = {
  ES: "España",
  NL: "Países Bajos",
  IE: "Irlanda",
  DE: "Alemania",
  FR: "Francia",
  LU: "Luxemburgo",
  GB: "Reino Unido",
  US: "Estados Unidos",
  CH: "Suiza",
  PT: "Portugal",
  IT: "Italia",
  BE: "Bélgica",
  AT: "Austria",
  EE: "Estonia",
  LT: "Lituania",
  MT: "Malta",
  CY: "Chipre",
};

export function accountCountryLabel(code: string | null): string {
  if (!code) return "Sin asignar";
  return ACCOUNT_COUNTRY_LABELS[code] ?? code;
}

export const ASSET_TYPE_LABELS: Record<string, string> = {
  crypto: "Cripto",
  etf: "ETF",
  stock: "Acciones",
  bond: "Bonos",
  fund: "Fondos",
  "cash-equivalent": "Efectivo",
  other: "Otros",
};

export function assetTypeLabel(type: string): string {
  return ASSET_TYPE_LABELS[type] ?? type;
}

/** Categoría de bien en el extranjero (bloque M720/M721). */
export const M720_CATEGORY_LABELS: Record<string, string> = {
  "broker-securities": "Valores",
  "bank-accounts": "Cuentas",
  crypto: "Criptomonedas",
};

export function m720CategoryLabel(type: string): string {
  return M720_CATEGORY_LABELS[type] ?? type;
}

/** Entidad afectada por un evento de auditoría. */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  account: "Cuenta",
  asset: "Activo",
  asset_transaction: "Transacción",
  cash_movement: "Movimiento de efectivo",
  objective: "Objetivo",
  price_alert: "Alerta de precio",
  alert_event: "Alerta disparada",
  benchmark: "Índice de referencia",
  backup: "Copia de seguridad",
};

export function auditEntityLabel(type: string): string {
  return AUDIT_ENTITY_LABELS[type] ?? type;
}

/** Acción registrada en un evento de auditoría. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: "Alta",
  "create-dividend": "Alta de dividendo",
  "create-swap": "Alta de canje",
  update: "Edición",
  delete: "Borrado",
  deactivate: "Desactivación",
  backfill: "Relleno histórico",
  assign: "Asignación",
  retarget: "Reajuste de objetivo",
  reorder: "Reordenación",
  acknowledge: "Reconocimiento",
  watchlist_add: "Añadido a seguimiento",
  watchlist_remove: "Quitado de seguimiento",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/** Origen de un evento de auditoría. */
export const AUDIT_SOURCE_LABELS: Record<string, string> = {
  ui: "Interfaz",
  cron: "Tarea programada",
  system: "Sistema",
  advisor: "Asesor",
};

export function auditSourceLabel(source: string): string {
  return AUDIT_SOURCE_LABELS[source] ?? source;
}
