import { NextResponse } from "next/server";
import { db } from "@/src/db/client";
import { buildTaxReport } from "@/src/server/tax/report";
import { getSnapshot } from "@/src/server/tax/seals";
import { computeInformationalModelsStatus, type InformationalModelsStatus } from "@/src/server/tax/m720";
import { aggregateBlocksFromBalances } from "@/src/server/tax/m720Aggregate";
import { getInterestForYear } from "@/src/server/tax/interest";
import { buildTaxReportPdf } from "@/src/lib/pdf/tax-report";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = Number.parseInt(url.searchParams.get("year") ?? "", 10);
  if (!Number.isFinite(year)) return new NextResponse("year required", { status: 400 });
  const snapshot = getSnapshot(db, year);
  const report = snapshot?.payload.report ?? buildTaxReport(db, year);
  const models: InformationalModelsStatus = snapshot
    ? snapshot.payload
    : computeInformationalModelsStatus(
        db,
        year,
        aggregateBlocksFromBalances(report.yearEndBalances, report.yearEndCashBalances ?? []),
      );
  // Sealed years use the interest frozen at seal time — the sealed PDF must
  // be fully reproducible from the snapshot (audit F8).
  const interest = snapshot
    ? {
        grossEur: snapshot.payload.interestEur ?? 0,
        withholdingEur: snapshot.payload.interestWithholdingEur ?? 0,
      }
    : await getInterestForYear(year, db);
  const pdf = buildTaxReportPdf({
    year,
    report,
    models,
    sealedAt: snapshot?.sealedAt ?? null,
    interest,
  });
  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="taxes-${year}.pdf"`,
    },
  });
}
