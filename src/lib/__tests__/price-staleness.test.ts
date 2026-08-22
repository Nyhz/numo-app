import { describe, expect, it } from "vitest";
import { isPriceHistoryStale } from "../price-staleness";
import { madridDateIso } from "../time";

// 12:00 UTC de un día de agosto (CEST): fecha Madrid = fecha UTC.
const NOON = Date.parse("2026-08-22T12:00:00Z");

describe("madridDateIso", () => {
  it("coincide con la fecha UTC a mediodía", () => {
    expect(madridDateIso(NOON)).toBe("2026-08-22");
  });

  it("adelanta un día pasada la medianoche Madrid aunque UTC siga en ayer", () => {
    // 22:30Z del 22 = 00:30 CEST del 23.
    expect(madridDateIso(Date.parse("2026-08-22T22:30:00Z"))).toBe("2026-08-23");
  });
});

describe("isPriceHistoryStale", () => {
  it("hoy y ayer son frescos", () => {
    expect(isPriceHistoryStale("2026-08-22", NOON)).toBe(false);
    expect(isPriceHistoryStale("2026-08-21", NOON)).toBe(false);
  });

  it("anteayer o más viejo es stale", () => {
    expect(isPriceHistoryStale("2026-08-20", NOON)).toBe(true);
    expect(isPriceHistoryStale("2026-07-01", NOON)).toBe(true);
  });

  it("BD sin precios no es stale (arranque fresh-DB silencioso)", () => {
    expect(isPriceHistoryStale(null, NOON)).toBe(false);
  });

  it("detecta el cron recién perdido en un arranque a las 00:30 Madrid", () => {
    // 22:30Z del 22 = 00:30 CEST del 23. En días UTC el último cierre (21)
    // sería «ayer» y pasaría por fresco; en días Madrid ayer es el 22 y el
    // sync de las 23:00 del 22 se perdió — debe reportar stale.
    const bootMs = Date.parse("2026-08-22T22:30:00Z");
    expect(isPriceHistoryStale("2026-08-21", bootMs)).toBe(true);
    expect(isPriceHistoryStale("2026-08-22", bootMs)).toBe(false);
  });
});
