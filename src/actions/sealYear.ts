"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../db/client";
import { auditEvents, taxYearSnapshots } from "../db/schema";
import { buildTaxReport } from "../server/tax/report";
import { computeInformationalModelsStatus } from "../server/tax/m720";
import { reportContentHash } from "../server/tax/seals";
import { getInterestForYearSync } from "../server/tax/interest";
import { aggregateBlocksFromBalances } from "../server/tax/m720Aggregate";
import { ACTOR, type ActionResult, revalidateTaxEvent } from "./_shared";
import { sealYearSchema } from "./sealYear.schema";

export async function sealYear(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ year: number; snapshotId: string }>> {
  const parsed = sealYearSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "validation", message: "Datos no válidos" } };
  const { year, notes, acknowledgeUnvalued, acknowledgeUnknownCountry } = parsed.data;

  try {
    const result = db.transaction((tx) => {
      const existing = tx.select().from(taxYearSnapshots).where(eq(taxYearSnapshots.year, year)).get();
      if (existing) throw new Error(`el ejercicio ${year} ya está sellado`);
      const report = buildTaxReport(tx as unknown as DB, year);
      const blocks = aggregateBlocksFromBalances(
        report.yearEndBalances,
        report.yearEndCashBalances ?? [],
      );
      const models = computeInformationalModelsStatus(tx as unknown as DB, year, blocks);
      // Audit T4: sealing freezes the declared M720/M721 values. Refuse when
      // a foreign block contains unvalued positions unless the Commander
      // explicitly acknowledged that the thresholds may be wrong.
      const unvaluedBlocks = [...models.m720.blocks, ...models.m721.blocks].filter(
        (b) => b.hasUnvalued,
      );
      if (unvaluedBlocks.length > 0 && !acknowledgeUnvalued) {
        const list = unvaluedBlocks.map((b) => `${b.country}/${b.type}`).join(", ");
        throw new Error(
          `cannot seal ${year}: unvalued foreign year-end balances (${list}). ` +
            `Set a manual price for the affected assets, or seal with explicit acknowledgement.`,
        );
      }
      // Same discipline for balances whose account has no country: they land
      // in the "??" sentinel block and cannot be checked against any
      // geography, so sealing them requires the same explicit acknowledgement.
      const unknownCountryBlocks = [...models.m720.blocks, ...models.m721.blocks].filter(
        (b) => b.hasUnknownCountry,
      );
      if (unknownCountryBlocks.length > 0 && !acknowledgeUnknownCountry) {
        const list = unknownCountryBlocks.map((b) => `${b.country}/${b.type}`).join(", ");
        throw new Error(
          `cannot seal ${year}: unknown-country year-end balances (${list}). ` +
            `Set the country on the affected accounts, or seal with explicit acknowledgement.`,
        );
      }
      // Freeze interest too: the sealed PDF's cuota estimate must be fully
      // reproducible from the snapshot (audit F8).
      const interest = getInterestForYearSync(year, tx as unknown as DB);
      const payload = {
        report,
        contentHash: reportContentHash(report),
        interestEur: interest.grossEur,
        interestWithholdingEur: interest.withholdingEur,
        ...models,
      };
      const id = ulid();
      tx.insert(taxYearSnapshots).values({
        id, year,
        sealedAt: Date.now(),
        payloadJson: JSON.stringify(payload),
        notes: notes ?? null,
      }).run();
      tx.insert(auditEvents).values({
        id: ulid(),
        entityType: "tax_year",
        entityId: String(year),
        action: "seal",
        actorType: "user",
        source: "ui",
        summary: `sealed year ${year}`,
        previousJson: null,
        nextJson: JSON.stringify({ snapshotId: id }),
        contextJson: JSON.stringify({ actor: ACTOR, acknowledgeUnvalued, acknowledgeUnknownCountry }),
        createdAt: Date.now(),
      }).run();
      return { year, snapshotId: id };
    });
    revalidateTaxEvent(year);
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    if (message.startsWith("cannot seal")) {
      // The thrown messages are internal English sentinels; rebuild the
      // user-facing sentence in Spanish from their parts.
      const unvalued = message.match(
        /^cannot seal (\d+): unvalued foreign year-end balances \((.+)\)\./,
      );
      const unknownCountry = message.match(
        /^cannot seal (\d+): unknown-country year-end balances \((.+)\)\./,
      );
      const friendly = unvalued
        ? `No se puede sellar ${unvalued[1]}: hay saldos extranjeros sin valorar a cierre de ejercicio (${unvalued[2]}). ` +
          `Establece un precio manual para los activos afectados, o sella con confirmación explícita.`
        : unknownCountry
          ? `No se puede sellar ${unknownCountry[1]}: hay saldos a cierre de ejercicio sin país asignado (${unknownCountry[2]}). ` +
            `Asigna el país a las cuentas afectadas, o sella con confirmación explícita.`
          : "No se puede sellar el ejercicio: hay saldos a cierre de ejercicio sin valorar o sin país asignado.";
      return { ok: false, error: { code: "conflict", message: friendly } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
