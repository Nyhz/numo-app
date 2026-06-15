import { describe, expect, it } from "vitest";
import {
  countryRegion,
  normalizeCountryKey,
  regionLabel,
} from "../countries";

describe("normalizeCountryKey", () => {
  it("slugifies JustETF country names", () => {
    expect(normalizeCountryKey("United States")).toBe("united_states");
    expect(normalizeCountryKey("South Korea")).toBe("south_korea");
    expect(normalizeCountryKey("Hong Kong")).toBe("hong_kong");
  });

  it("collapses Other/Others to the residual key", () => {
    expect(normalizeCountryKey("Other")).toBe("other");
    expect(normalizeCountryKey("Others")).toBe("other");
  });
});

describe("countryRegion", () => {
  it("maps countries to their continent", () => {
    expect(countryRegion("united_states")).toBe("north_america");
    expect(countryRegion("canada")).toBe("north_america");
    expect(countryRegion("germany")).toBe("europe");
    expect(countryRegion("united_kingdom")).toBe("europe");
    expect(countryRegion("japan")).toBe("asia");
    expect(countryRegion("china")).toBe("asia");
    expect(countryRegion("australia")).toBe("oceania");
    expect(countryRegion("brazil")).toBe("latin_america");
    expect(countryRegion("south_africa")).toBe("middle_east_africa");
  });

  it("routes the fund 'other' tail and unknown countries to 'other'", () => {
    expect(countryRegion("other")).toBe("other");
    expect(countryRegion("atlantis")).toBe("other");
  });
});

describe("regionLabel", () => {
  it("returns Spanish region labels", () => {
    expect(regionLabel("north_america")).toBe("Norteamérica");
    expect(regionLabel("europe")).toBe("Europa");
    expect(regionLabel("middle_east_africa")).toBe("Oriente Medio y África");
    expect(regionLabel("other")).toBe("Otros");
  });
});
