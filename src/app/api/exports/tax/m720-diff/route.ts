import { NextResponse } from "next/server";
import { db } from "@/src/db/client";
import { buildTaxReport } from "@/src/server/tax/report";
import { getSnapshot } from "@/src/server/tax/seals";
import { aggregateBlocksFromBalances } from "@/src/server/tax/m720Aggregate";
import { computeInformationalModelsStatus, type InformationalModelsStatus } from "@/src/server/tax/m720";
import { buildM720DiffCsv, buildM720DiffJson } from "@/src/lib/exports/tax-m720-diff";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = Number.parseInt(url.searchParams.get("year") ?? "", 10);
  const format = url.searchParams.get("format") ?? "json";
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
  if (format === "csv") {
    return new NextResponse(buildM720DiffCsv(models), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="taxes-${year}-m720-diff.csv"`,
      },
    });
  }
  return new NextResponse(buildM720DiffJson(models), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="taxes-${year}-m720-diff.json"`,
    },
  });
}
