import { describe, expect, it } from "vitest";
import { isoWeekKey } from "../dates";

describe("isoWeekKey (idempotency slot for weekly jobs)", () => {
  it("computes the ISO-8601 week", () => {
    // 2026-06-15 is a Monday → ISO week 25 of 2026.
    expect(isoWeekKey(new Date(2026, 5, 15))).toBe("2026-W25");
    // Same week, different day → same key (idempotency across the week).
    expect(isoWeekKey(new Date(2026, 5, 21))).toBe("2026-W25"); // Sunday
  });

  it("assigns the first days of January to the correct ISO year", () => {
    // 2027-01-01 is a Friday → still ISO week 53 of 2026.
    expect(isoWeekKey(new Date(2027, 0, 1))).toBe("2026-W53");
  });

  it("is stable for a given calendar day", () => {
    const a = isoWeekKey(new Date(2026, 0, 5));
    const b = isoWeekKey(new Date(2026, 0, 5, 23, 59));
    expect(a).toBe(b);
    expect(a).toBe("2026-W02");
  });
});
