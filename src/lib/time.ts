// Time helpers shared across server / lib / scripts. Consolidates what was
// previously duplicated as private functions in `server/overview.ts`,
// `server/savings.ts`, `server/valuations.ts`, `lib/fx-backfill.ts` and as
// inline `.toISOString().slice(0, 10)` calls in several more files.

export const DAY_MS = 86_400_000;

/** ISO yyyy-MM-dd in UTC. Accepts a Date or an already-formatted string. */
export function toIsoDate(date: Date | string): string {
  if (typeof date === "string") return date.slice(0, 10);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True when the UTC day-of-week is Mon-Fri. Weekends drop out of equity
 *  price feeds, so loops over weekday-only series use this to filter. */
export function isWeekday(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
}

/** ISO yyyy-MM-dd of the given instant in Europe/Madrid. Freshness math for
 *  the 23:00-Madrid cron must count days in Madrid, not UTC: a boot at 00:30
 *  CEST is still "yesterday" in UTC and would mask a just-missed run. */
export function madridDateIso(msUtc: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(msUtc));
}
