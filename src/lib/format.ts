import { format as fnsFormat } from "date-fns";

const LOCALE = "es-ES";

const eurFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatEur(
  amount: number,
  opts?: { maximumFractionDigits?: number },
): string {
  if (!opts) return eurFormatter.format(amount);
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: opts.maximumFractionDigits ?? 2,
  }).format(amount);
}

/** Formato compacto para ejes de gráficos: «1,5 M€» / «12,3 k€» / «950 €».
 *  Por encima del millón usa M€ — «1.200 k€» (mil-doscientos-k) se lee fatal
 *  con el punto de millar español. */
export function formatEurCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} M€`;
  }
  if (abs >= 1000) {
    return `${(value / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} k€`;
  }
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: 0 })} €`;
}

/** Cantidades de unidades (no monetarias): «1.234,5678». */
export function formatQuantity(
  value: number,
  opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
): string {
  return value.toLocaleString(LOCALE, {
    maximumFractionDigits: opts?.maximumFractionDigits ?? 4,
    minimumFractionDigits: opts?.minimumFractionDigits,
  });
}

export function formatMoney(amount: number, currency: string): string {
  if (!currency) {
    throw new Error("formatMoney: currency is required");
  }
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(ratio: number): string {
  return percentFormatter.format(ratio);
}

export function formatDate(date: Date | string | number): string {
  return fnsFormat(new Date(date), "yyyy-MM-dd");
}

export function formatDateTime(date: Date | string | number): string {
  return fnsFormat(new Date(date), "yyyy-MM-dd HH:mm");
}
