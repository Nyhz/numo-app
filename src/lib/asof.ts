/** Fecha de hoy en ISO yyyy-MM-dd en horario LOCAL (no UTC): el corte del
 *  extracto es "fin de día del usuario", igual que el cutoff de statement.ts. */
export function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type AsOfParse =
  | { ok: true; asOf: string | null }
  | { ok: false; error: string };

/** Valida el query param asOf de las rutas de export. null/"" = sin corte. */
export function parseAsOfParam(raw: string | null): AsOfParse {
  if (raw == null || raw === "") return { ok: true, asOf: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false, error: "asOf debe tener formato YYYY-MM-DD" };
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    return { ok: false, error: "asOf no es una fecha de calendario válida" };
  }
  if (raw > todayIsoLocal()) {
    return { ok: false, error: "asOf no puede ser una fecha futura" };
  }
  return { ok: true, asOf: raw };
}
