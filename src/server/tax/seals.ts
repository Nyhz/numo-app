import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { taxYearSnapshots } from "../../db/schema";
import { roundEur } from "../../lib/money";
import { buildTaxReport, type TaxReport } from "./report";
import type { InformationalModelsStatus } from "./m720";

export type Snapshot = {
  year: number;
  sealedAt: number;
  /** `interestEur` (bruto) e `interestWithholdingEur` frozen at seal time so
   *  the sealed PDF's cuota estimate never mixes sealed report data with live
   *  interest (audit F8). Optional: older snapshots lack them. */
  payload: {
    report: TaxReport;
    contentHash?: string;
    interestEur?: number;
    interestWithholdingEur?: number;
  } & InformationalModelsStatus;
};

/**
 * Order-independent fingerprint of the report's composition (audit T12).
 * Totals-only drift comparison misses compensating edits — one sale deleted,
 * another added with the same net. Hashing (id, amount) pairs catches them.
 */
export function reportContentHash(report: TaxReport): string {
  const sales = report.sales
    .map((s) => `${s.transactionId}:${s.computableGainLossEur.toFixed(2)}`)
    .sort();
  const dividends = report.dividends
    .map((d) => `${d.transactionId}:${d.grossEur.toFixed(2)}`)
    .sort();
  return createHash("sha256")
    .update(JSON.stringify({ sales, dividends }))
    .digest("hex");
}

export type DriftReport = {
  year: number;
  /** Same totals but different sale/dividend composition since the seal. */
  contentChanged: boolean;
  netComputableEurDelta: number;
  dividendsGrossEurDelta: number;
  withholdingOrigenTotalEurDelta: number;
  nonComputableLossesEurDelta: number;
  salesCountDelta: number;
  dividendsCountDelta: number;
};

export type SnapshotState =
  | { status: "none" }
  | { status: "ok"; snapshot: Snapshot }
  | { status: "corrupt"; sealedAt: number };

/**
 * Audit R9: a sealed row whose payload no longer parses must surface as
 * `corrupt`, not silently behave like an unsealed year — otherwise live
 * numbers replace filed numbers with no warning.
 */
export function getSnapshotState(db: DB, year: number): SnapshotState {
  const row = db.select().from(taxYearSnapshots).where(eq(taxYearSnapshots.year, year)).get();
  if (!row) return { status: "none" };
  try {
    const payload = JSON.parse(row.payloadJson) as Snapshot["payload"];
    if (!payload || typeof payload !== "object" || !payload.report) {
      throw new Error("payload missing report");
    }
    return {
      status: "ok",
      snapshot: { year: row.year, sealedAt: row.sealedAt, payload },
    };
  } catch (err) {
    console.error(`tax seals: snapshot for ${year} is unreadable:`, err);
    return { status: "corrupt", sealedAt: row.sealedAt };
  }
}

export function getSnapshot(db: DB, year: number): Snapshot | null {
  const state = getSnapshotState(db, year);
  return state.status === "ok" ? state.snapshot : null;
}

export function computeDriftSinceSeal(
  db: DB,
  year: number,
  // El caller que ya tiene el snapshot parseado (la página del año) lo pasa
  // para no re-leer y re-parsear el payload JSON completo en el mismo render.
  prefetched?: Snapshot | null,
): DriftReport | null {
  const snap = prefetched !== undefined ? prefetched : getSnapshot(db, year);
  if (!snap) return null;
  const live = buildTaxReport(db, year);
  const sealed = snap.payload.report;
  const sealedHash = snap.payload.contentHash;
  const contentChanged = sealedHash != null && sealedHash !== reportContentHash(live);
  const drift: DriftReport = {
    year,
    contentChanged,
    netComputableEurDelta: roundEur(live.totals.netComputableEur - sealed.totals.netComputableEur),
    dividendsGrossEurDelta: roundEur(live.totals.dividendsGrossEur - sealed.totals.dividendsGrossEur),
    withholdingOrigenTotalEurDelta: roundEur(live.totals.withholdingOrigenTotalEur - sealed.totals.withholdingOrigenTotalEur),
    nonComputableLossesEurDelta: roundEur(live.totals.nonComputableLossesEur - sealed.totals.nonComputableLossesEur),
    salesCountDelta: live.sales.length - sealed.sales.length,
    dividendsCountDelta: live.dividends.length - sealed.dividends.length,
  };
  if (
    !drift.contentChanged &&
    drift.netComputableEurDelta === 0 &&
    drift.dividendsGrossEurDelta === 0 &&
    drift.withholdingOrigenTotalEurDelta === 0 &&
    drift.nonComputableLossesEurDelta === 0 &&
    drift.salesCountDelta === 0 &&
    drift.dividendsCountDelta === 0
  ) return null;
  return drift;
}
