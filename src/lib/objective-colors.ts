/** Tag colour palette: theme tokens only (each has a dark and a light
 *  variant in globals.css), never raw hex — sensitive to SPEC §2. The stored
 *  value is the CSS variable name. */
export const OBJECTIVE_COLOR_VARS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--chart-7",
  "--chart-8",
  "--chart-9",
  "--chart-10",
  "--chart-11",
  "--chart-12",
] as const;

export type ObjectiveColorVar = (typeof OBJECTIVE_COLOR_VARS)[number];

export function objectiveColorCss(colorVar: string): string {
  return `hsl(var(${colorVar}))`;
}

/** Stored colour if valid, else a stable positional fallback (legacy rows). */
export function resolveObjectiveColorVar(
  stored: string | null | undefined,
  index: number,
): ObjectiveColorVar {
  const valid = (OBJECTIVE_COLOR_VARS as readonly string[]).includes(stored ?? "");
  return valid
    ? (stored as ObjectiveColorVar)
    : OBJECTIVE_COLOR_VARS[index % OBJECTIVE_COLOR_VARS.length];
}

export function resolveObjectiveColor(stored: string | null | undefined, index: number): string {
  return objectiveColorCss(resolveObjectiveColorVar(stored, index));
}

/** First palette entry not yet in use — the default for a new tag. */
export function firstFreeObjectiveColor(used: Array<string | null>): ObjectiveColorVar {
  const taken = new Set(used.filter(Boolean));
  return (
    OBJECTIVE_COLOR_VARS.find((c) => !taken.has(c)) ?? OBJECTIVE_COLOR_VARS[0]
  );
}
