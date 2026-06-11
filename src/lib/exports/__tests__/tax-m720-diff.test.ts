import { marketEur } from "../../money-types";
import { describe, expect, it } from "vitest";
import { buildM720DiffJson, buildM720DiffCsv } from "../tax-m720-diff";
import type { InformationalModelsStatus } from "../../../server/tax/m720";

const models: InformationalModelsStatus = {
  m720: { blocks: [
    { country: "IE", type: "broker-securities", valueEur: marketEur(80_000), hasUnvalued: false, hasStale: false, status: "delta_20k", lastDeclaredEur: marketEur(55_000) },
    { country: "NL", type: "broker-securities", valueEur: marketEur(10_000), hasUnvalued: false, hasStale: false, status: "ok", lastDeclaredEur: null },
  ] },
  m721: { blocks: [
    { country: "MT", type: "crypto", valueEur: marketEur(60_000), hasUnvalued: false, hasStale: false, status: "new", lastDeclaredEur: null },
  ] },
};

describe("buildM720DiffJson / Csv", () => {
  it("JSON shape has per-model arrays and summary", () => {
    const json = JSON.parse(buildM720DiffJson(models));
    expect(json.m720.blocks).toHaveLength(2);
    expect(json.m721.blocks).toHaveLength(1);
    expect(json.summary.needsAction).toBe(true);
  });
  it("CSV lists flagged blocks", () => {
    const csv = buildM720DiffCsv(models);
    expect(csv).toContain("m720,IE,broker-securities,delta_20k");
    expect(csv).toContain("m721,MT,crypto,new");
  });
});
