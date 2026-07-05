import { NextResponse } from "next/server";
import { getStatementReport } from "@/src/server/statement";
import { getNetWorthSeries } from "@/src/server/overview";
import { parseAsOfParam } from "@/src/lib/asof";
import { buildStatementCsv } from "@/src/lib/exports/statement-csv";
import { buildStatementMd } from "@/src/lib/exports/statement-md";
import { buildStatementXlsx } from "@/src/lib/exports/statement-xlsx";
import { buildStatementReportPdf } from "@/src/lib/pdf/statement-report";

const FORMATS = new Set(["pdf", "xlsx", "csv", "md"]);

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const format = params.get("format") ?? "pdf";
  if (!FORMATS.has(format)) {
    return new NextResponse("format must be pdf, xlsx, csv or md", { status: 400 });
  }
  const asOfParse = parseAsOfParam(params.get("asOf"));
  if (!asOfParse.ok) {
    return new NextResponse(asOfParse.error, { status: 400 });
  }

  const report = await getStatementReport(undefined, {
    asOf: asOfParse.asOf ?? undefined,
  });
  const stamp = report.asOf ?? new Date(report.generatedAt).toISOString().slice(0, 10);

  if (format === "csv") {
    return new NextResponse(buildStatementCsv(report), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="statement-${stamp}.csv"`,
      },
    });
  }

  if (format === "md") {
    return new NextResponse(buildStatementMd(report), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="statement-${stamp}.md"`,
      },
    });
  }

  if (format === "xlsx") {
    const bytes = await buildStatementXlsx(report);
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="statement-${stamp}.xlsx"`,
      },
    });
  }

  // Serie de evolución para el gráfico de área de la primera página; con
  // asOf se recorta al corte para no dibujar futuro respecto al extracto.
  const seriesAll = await getNetWorthSeries({ range: "ALL", accountIds: [] });
  const series = report.asOf
    ? seriesAll.filter((p) => p.date <= report.asOf!)
    : seriesAll;
  const pdf = buildStatementReportPdf(report, {
    series: series.map((p) => ({ date: p.date, valueEur: p.valueEur })),
  });
  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="statement-${stamp}.pdf"`,
    },
  });
}
