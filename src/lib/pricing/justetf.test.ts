import { describe, expect, it } from "vitest";
import { parseCountryWeightings } from "./justetf";

// Trimmed-down copy of the real `etf-holdings_countries` table markup so the
// parser is pinned to JustETF's actual structure (stable data-testids).
const COUNTRIES_HTML = `
<div data-testid="etf-holdings_countries_container">
  <h3>Countries</h3>
  <table data-testid="etf-holdings_countries_table">
    <tbody>
      <tr data-testid="etf-holdings_countries_row">
        <td data-testid="tl_etf-holdings_countries_value_name">United States</td>
        <td><span data-testid="tl_etf-holdings_countries_value_percentage">67.71%</span></td>
      </tr>
      <tr data-testid="etf-holdings_countries_row">
        <td data-testid="tl_etf-holdings_countries_value_name">Japan</td>
        <td><span data-testid="tl_etf-holdings_countries_value_percentage">5.57%</span></td>
      </tr>
      <tr data-testid="etf-holdings_countries_row">
        <td data-testid="tl_etf-holdings_countries_value_name">United Kingdom</td>
        <td><span data-testid="tl_etf-holdings_countries_value_percentage">3.25%</span></td>
      </tr>
      <tr data-testid="etf-holdings_countries_row">
        <td data-testid="tl_etf-holdings_countries_value_name">Other</td>
        <td><span data-testid="tl_etf-holdings_countries_value_percentage">20.39%</span></td>
      </tr>
    </tbody>
  </table>
</div>`;

describe("parseCountryWeightings", () => {
  it("extracts country names and weights as fractions, normalised", () => {
    const out = parseCountryWeightings(COUNTRIES_HTML);
    expect(out.map((r) => r.country)).toEqual([
      "united_states",
      "japan",
      "united_kingdom",
      "other",
    ]);
    expect(out[0]?.weight).toBeCloseTo(0.6771, 6);
    expect(out[1]?.weight).toBeCloseTo(0.0557, 6);
    expect(out[3]?.weight).toBeCloseTo(0.2039, 6);
  });

  it("returns an empty list when the page has no countries table", () => {
    expect(parseCountryWeightings("<html><body>nope</body></html>")).toEqual([]);
  });

  it("merges duplicate normalised keys", () => {
    const html = `
      <td data-testid="tl_etf-holdings_countries_value_name">Other</td>
      <td><span data-testid="tl_etf-holdings_countries_value_percentage">10%</span></td>
      <td data-testid="tl_etf-holdings_countries_value_name">Others</td>
      <td><span data-testid="tl_etf-holdings_countries_value_percentage">5%</span></td>`;
    const out = parseCountryWeightings(html);
    expect(out).toHaveLength(1);
    expect(out[0]?.country).toBe("other");
    expect(out[0]?.weight).toBeCloseTo(0.15, 6);
  });

  it("ignores rows whose percentage is unparseable or zero", () => {
    const html = `
      <td data-testid="tl_etf-holdings_countries_value_name">Spain</td>
      <td><span data-testid="tl_etf-holdings_countries_value_percentage">0%</span></td>
      <td data-testid="tl_etf-holdings_countries_value_name">France</td>
      <td><span data-testid="tl_etf-holdings_countries_value_percentage">2.5%</span></td>`;
    const out = parseCountryWeightings(html);
    expect(out).toHaveLength(1);
    expect(out[0]?.country).toBe("france");
    expect(out[0]?.weight).toBeCloseTo(0.025, 6);
  });
});
