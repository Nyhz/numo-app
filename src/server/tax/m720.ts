import { lt } from "drizzle-orm";
import { marketEur, type MarketEur } from "../../lib/money-types";
import type { DB } from "../../db/client";
import { taxDeclaredBaselines, taxYearSnapshots } from "../../db/schema";

export type Model720Block = {
  country: string;
  type: "broker-securities" | "bank-accounts" | "crypto";
  /** Sum of the VALUED balances only — see hasUnvalued. */
  valueEur: MarketEur;
  /** At least one position in this block has no year-end valuation; the
   *  50k/20k threshold checks below are unreliable until it is valued. */
  hasUnvalued: boolean;
  /** At least one position was valued with a stale (>10d old) valuation. */
  hasStale: boolean;
  /** The account behind these balances has no countryCode — the block is the
   *  "??" sentinel and cannot be matched to any treaty/threshold geography.
   *  Optional so sealed payloads from before this field existed still parse. */
  hasUnknownCountry?: boolean;
};

export type AnnotatedBlock = Model720Block & {
  status: "ok" | "new" | "delta_20k" | "full_exit";
  lastDeclaredEur: number | null;
  /** True when this block's status implies an actual filing for its year
   *  (first declaration, re-declaration, or extinction). Persisted at seal
   *  time; optional so older sealed payloads — which only carry the status
   *  string — still parse and are interpreted via wasDeclared(). */
  declared?: boolean;
};

// The D-6 was tracked here until 2026-06: Orden ECM/57/2023 dropped its
// annual "depósitos" declaration and Orden ECM/57/2024 abolished the form
// entirely (portfolio investment no longer declares; ≥10% stakes moved to the
// D-1A/D-2A family). Old sealed payloads may still carry a `d6` key — it is
// ignored on read; its blocks were always a subset of the m720 securities
// blocks, so no declared-value history is lost.
export type InformationalModelsStatus = {
  m720: { blocks: AnnotatedBlock[] };
  m721: { blocks: AnnotatedBlock[] };
};

type SnapshotPayload = {
  m720?: { blocks?: AnnotatedBlock[] };
  m721?: { blocks?: AnnotatedBlock[] };
};

/** A filed declaration the current year is compared against. Two origins:
 *  blocks frozen by the seal flow (per country+type), and manual baselines
 *  recorded by the Commander for filings made outside the app — those carry
 *  no geography (country: null) and hold the JOINT category value. */
type DeclaredRecord = {
  year: number;
  type: Model720Block["type"];
  country: string | null;
  valueEur: number;
};

function blocksFromPayload(payload: SnapshotPayload): AnnotatedBlock[] {
  return [
    ...(payload.m720?.blocks ?? []),
    ...(payload.m721?.blocks ?? []),
  ].filter((b): b is AnnotatedBlock => !!b && !!b.country && !!b.type);
}

/** Did this prior sealed block correspond to an ACTUAL filing? A year sealed
 *  at €45k with status "ok" was never presented — it must not poison
 *  lastDeclaredEur. New payloads persist an explicit `declared` flag; older
 *  payloads only carry the status string, where "new" and "delta_20k" are the
 *  statuses that implied a filing. */
function wasDeclared(b: AnnotatedBlock): boolean {
  return b.declared ?? (b.status === "new" || b.status === "delta_20k");
}

/** All filed declarations prior to `year`, newest first. Within a year,
 *  sealed (geographic) records win over a manual category-level baseline. */
function loadDeclaredRecords(db: DB, year: number): DeclaredRecord[] {
  const records: DeclaredRecord[] = [];

  const snaps = db.select().from(taxYearSnapshots).where(lt(taxYearSnapshots.year, year)).all();
  for (const snap of snaps) {
    let payload: SnapshotPayload;
    try {
      payload = JSON.parse(snap.payloadJson) as SnapshotPayload;
    } catch {
      continue;
    }
    for (const b of blocksFromPayload(payload)) {
      if (!wasDeclared(b)) continue;
      records.push({ year: snap.year, type: b.type, country: b.country, valueEur: b.valueEur });
    }
  }

  const baselines = db
    .select()
    .from(taxDeclaredBaselines)
    .where(lt(taxDeclaredBaselines.year, year))
    .all();
  for (const b of baselines) {
    records.push({ year: b.year, type: b.category, country: null, valueEur: b.amountEur });
  }

  records.sort(
    (a, b) => b.year - a.year || Number(a.country === null) - Number(b.country === null),
  );
  return records;
}

function annotate(records: DeclaredRecord[], blocks: Model720Block[]): AnnotatedBlock[] {
  const out: AnnotatedBlock[] = [];

  // Art. 42 bis/ter RD 1065/2007 (and the M721 crypto rule) set the €50.000
  // first-declaration threshold on the JOINT value of each asset CATEGORY —
  // all foreign securities together, all foreign accounts together, all
  // crypto together — regardless of country. Blocks stay per-country for
  // presentation, but the obligation is decided at category level.
  const categoryTotals = new Map<Model720Block["type"], number>();
  for (const b of blocks) {
    categoryTotals.set(b.type, (categoryTotals.get(b.type) ?? 0) + b.valueEur);
  }

  for (const b of blocks) {
    const record = records.find(
      (r) => r.type === b.type && (r.country === null || r.country === b.country),
    );
    let status: AnnotatedBlock["status"];
    if (!record) {
      status = (categoryTotals.get(b.type) ?? 0) >= 50_000 ? "new" : "ok";
    } else {
      // A manual baseline holds the joint category value, which is also what
      // the €20k re-declaration delta legally measures — compare against the
      // category total. Sealed records keep the finer per-block comparison.
      const current =
        record.country === null ? (categoryTotals.get(b.type) ?? 0) : b.valueEur;
      status = Math.abs(current - record.valueEur) > 20_000 ? "delta_20k" : "ok";
    }
    out.push({
      ...b,
      status,
      lastDeclaredEur: record?.valueEur ?? null,
      declared: status === "new" || status === "delta_20k",
    });
  }

  // Extinctions: a previously-filed geographic block that no longer exists
  // must declare its cancellation. Manual baselines carry no geography and
  // cannot drive an extinction block.
  const seenKeys = new Set(out.map((b) => `${b.country}::${b.type}`));
  const exitSeen = new Set<string>();
  for (const prior of records) {
    if (prior.country === null) continue;
    const key = `${prior.country}::${prior.type}`;
    if (seenKeys.has(key) || exitSeen.has(key)) continue;
    exitSeen.add(key);
    // valueEur > 0 keeps a declared extinction from re-emitting forever.
    if (prior.valueEur <= 0) continue;
    out.push({
      country: prior.country,
      type: prior.type,
      valueEur: marketEur(0),
      hasUnvalued: false,
      hasStale: false,
      status: "full_exit",
      lastDeclaredEur: prior.valueEur,
      declared: true,
    });
  }

  return out;
}

export function computeInformationalModelsStatus(
  db: DB,
  year: number,
  blocks: Model720Block[],
): InformationalModelsStatus {
  const foreign = blocks.filter((b) => b.country !== "ES");
  const records = loadDeclaredRecords(db, year);
  const annotated = annotate(records, foreign);
  const m720 = annotated.filter(
    (b) => b.type === "broker-securities" || b.type === "bank-accounts",
  );
  const m721 = annotated.filter((b) => b.type === "crypto");
  return { m720: { blocks: m720 }, m721: { blocks: m721 } };
}
