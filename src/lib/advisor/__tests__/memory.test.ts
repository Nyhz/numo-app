import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The Agent SDK spawns a subprocess; never load the real thing in tests.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));

import {
  MemoryValidationError,
  readTextOrEmpty,
  rotateBackups,
  writeAtomic,
  writeDigest,
  writeProfile,
} from "../memory";
import { parseMemoryOps } from "../extractMemory";
import { parseScanOutput } from "../scan";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(resolve(tmpdir(), "advisor-mem-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("writeAtomic / readTextOrEmpty", () => {
  it("writes and reads back, creating parent dirs", () => {
    const p = resolve(dir, "nested/deep/file.md");
    writeAtomic(p, "hola");
    expect(readTextOrEmpty(p)).toBe("hola");
  });

  it("returns empty string for a missing file", () => {
    expect(readTextOrEmpty(resolve(dir, "nope.md"))).toBe("");
  });
});

describe("rotateBackups", () => {
  it("rolls path → .bak.1 → .bak.2 and keeps the original", () => {
    const p = resolve(dir, "digest.md");
    writeFileSync(p, "v1");
    rotateBackups(p); // v1 → .bak.1
    writeFileSync(p, "v2");
    rotateBackups(p); // v1 → .bak.2, v2 → .bak.1
    expect(readFileSync(p, "utf8")).toBe("v2");
    expect(readFileSync(`${p}.bak.1`, "utf8")).toBe("v2");
    expect(readFileSync(`${p}.bak.2`, "utf8")).toBe("v1");
  });

  it("is a no-op when the file does not exist", () => {
    expect(() => rotateBackups(resolve(dir, "ghost.md"))).not.toThrow();
  });
});

describe("writeProfile validation (anti-wipe / budget)", () => {
  it("rejects an empty profile before touching disk", () => {
    expect(() => writeProfile("   ")).toThrow(MemoryValidationError);
  });

  it("rejects a profile over the byte budget", () => {
    const huge = "x".repeat(5000); // > default 4096
    expect(() => writeProfile(huge)).toThrow(MemoryValidationError);
  });
});

describe("parseMemoryOps (robustness against bad LLM output)", () => {
  it("parses a clean ops object", () => {
    const ops = parseMemoryOps('{"ops":[{"op":"add","field":"edad","value":"34","reason":"lo dijo"}]}');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "add", field: "edad", value: "34" });
  });

  it("extracts the JSON object even with surrounding prose / fences", () => {
    const ops = parseMemoryOps('Claro:\n```json\n{"ops":[{"op":"remove","field":"objetivo X","reason":"obsoleto"}]}\n```');
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe("remove");
  });

  it("returns [] for non-JSON / garbage", () => {
    expect(parseMemoryOps("no hay nada que guardar")).toEqual([]);
    expect(parseMemoryOps("{roto")).toEqual([]);
  });

  it("returns [] when ops fail schema validation", () => {
    expect(parseMemoryOps('{"ops":[{"op":"frobnicate","field":"x","reason":"y"}]}')).toEqual([]);
  });

  it("returns [] for an explicit empty ops list", () => {
    expect(parseMemoryOps('{"ops":[]}')).toEqual([]);
  });
});

const DIGEST_OK = `_Actualizado: 2026-06-13_

## Riesgos activos
- [estructural] X — Y (visto: 2026-06-13)

## Oportunidades
- nada

## Macro y geopolítica
- nada

## Watchlist
- nada`;

describe("writeDigest validation (anti-garbage / anti-wipe)", () => {
  it("rejects an empty digest", () => {
    expect(() => writeDigest("   ")).toThrow(MemoryValidationError);
  });

  it("rejects a digest over the byte budget", () => {
    expect(() => writeDigest(`${DIGEST_OK}\n${"x".repeat(9000)}`)).toThrow(MemoryValidationError);
  });

  it("rejects a digest missing the expected section structure", () => {
    expect(() => writeDigest("## Riesgos activos\n- solo una sección")).toThrow(
      MemoryValidationError,
    );
  });
});

describe("parseScanOutput (delimiter framing, robust to prose)", () => {
  const sample = `Aquí tienes el escaneo:
===JOURNAL===
- Titular A — importa porque… [fuente: http://x]
===DIGEST===
_Actualizado: 2026-06-13_

## Riesgos activos
- [transitorio] algo

## Oportunidades
- nada

## Macro y geopolítica
- nada

## Watchlist
- nada
===SUMMARY===
1 hallazgo: Titular A
===BRIEF===
Buenos días. Hoy destaca X.`;

  it("splits journal / digest / summary / brief by the delimiters", () => {
    const out = parseScanOutput(sample);
    expect(out).not.toBeNull();
    expect(out!.journal).toContain("Titular A");
    expect(out!.digest).toContain("## Riesgos activos");
    expect(out!.summary).toContain("1 hallazgo");
    expect(out!.brief).toContain("Buenos días");
    // The brief must not leak into the summary.
    expect(out!.summary).not.toContain("Buenos días");
  });

  it("leaves brief empty when the section is absent (optional)", () => {
    const noBrief = sample.slice(0, sample.indexOf("===BRIEF==="));
    const out = parseScanOutput(noBrief);
    expect(out).not.toBeNull();
    expect(out!.brief).toBe("");
  });

  it("returns null when a delimiter is missing", () => {
    expect(parseScanOutput("===JOURNAL===\nx\n===DIGEST===\ny")).toBeNull();
  });

  it("returns null when delimiters are out of order", () => {
    expect(parseScanOutput("===DIGEST===\ny\n===JOURNAL===\nx\n===SUMMARY===\nz")).toBeNull();
  });

  it("returns null when the digest section is empty", () => {
    expect(parseScanOutput("===JOURNAL===\nx\n===DIGEST===\n\n===SUMMARY===\nz")).toBeNull();
  });
});
