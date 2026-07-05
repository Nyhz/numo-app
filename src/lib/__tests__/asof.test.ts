import { describe, expect, it } from "vitest";
import { parseAsOfParam, todayIsoLocal } from "../asof";

describe("parseAsOfParam", () => {
  it("null o vacío significa extracto actual", () => {
    expect(parseAsOfParam(null)).toEqual({ ok: true, asOf: null });
    expect(parseAsOfParam("")).toEqual({ ok: true, asOf: null });
  });

  it("acepta una fecha pasada válida", () => {
    expect(parseAsOfParam("2026-03-31")).toEqual({ ok: true, asOf: "2026-03-31" });
  });

  it("acepta hoy", () => {
    const today = todayIsoLocal();
    expect(parseAsOfParam(today)).toEqual({ ok: true, asOf: today });
  });

  it("rechaza formatos que no son YYYY-MM-DD", () => {
    for (const bad of ["31-03-2026", "2026/03/31", "2026-3-31", "ayer"]) {
      expect(parseAsOfParam(bad).ok).toBe(false);
    }
  });

  it("rechaza fechas de calendario inexistentes", () => {
    expect(parseAsOfParam("2026-02-30").ok).toBe(false);
    expect(parseAsOfParam("2026-13-01").ok).toBe(false);
  });

  it("rechaza fechas futuras", () => {
    expect(parseAsOfParam("2999-01-01").ok).toBe(false);
  });
});
