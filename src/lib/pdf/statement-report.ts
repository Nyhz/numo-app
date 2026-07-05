import { jsPDF } from "jspdf";
import type { StatementReport } from "../../server/statement";
import { accountTypeLabel } from "../labels";
import {
  ACCENT,
  BAND,
  CHART,
  type Col,
  type Cursor,
  CONTENT_W,
  FAINT,
  INK,
  M,
  MUTED,
  RIGHT,
  WHITE,
  areaChart,
  assetTypeLabelPdf,
  continuationHeader,
  donut,
  ensureRoom,
  fill,
  finishFooters,
  fmtDateIso,
  fmtEur,
  headerBand,
  kicker,
  sectionTitle,
  statCards,
  tableHead,
  text,
  toneFor,
  totalRule,
  zebra,
} from "./_kit";

export type StatementPdfInput = {
  report: StatementReport;
  /** Serie diaria de patrimonio para el gráfico de evolución (opcional). */
  series?: { date: string; valueEur: number }[];
};

function fmtQty(value: number): string {
  return value.toLocaleString("es-ES", { maximumFractionDigits: 8 });
}

function fmtPct(ratio: number | null): string {
  if (ratio == null) return "—";
  const pct = ratio * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2).replace(".", ",")}%`;
}

const truncate = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

export function buildStatementReportPdf(
  report: StatementReport,
  opts: { series?: { date: string; valueEur: number }[] } = {},
): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const cur: Cursor = { doc, y: 0 };
  const t = report.totals;

  const room = (needed: number, onNewPage?: (c: Cursor) => void) =>
    ensureRoom(cur, needed, (c) => {
      continuationHeader(c, "Extracto de cartera");
      onNewPage?.(c);
    });

  // ── Cabecera ──────────────────────────────────────────────────────────────
  const stamp = report.asOf ?? fmtDateIso(report.generatedAt);
  cur.y = headerBand(doc, {
    title: "Extracto de cartera · Finances Panel",
    big: stamp,
    subtitle: `${t.positionsCount} posiciones abiertas en ${t.accountsCount} cuenta${t.accountsCount === 1 ? "" : "s"} · valoración en EUR`,
    metaLines: [`Generado el ${fmtDateIso(report.generatedAt)}`],
    badge: report.asOf ? { label: "A día de fecha", tone: "accent" } : undefined,
  });

  // ── Tarjetas de resumen ───────────────────────────────────────────────────
  statCards(cur, [
    {
      kicker: "Patrimonio total",
      value: fmtEur(t.netWorthEur),
      sub: `efectivo ${fmtEur(t.cashEur)} · invertido ${fmtEur(t.investedMarketValueEur)}`,
    },
    {
      kicker: "Coste de lo invertido",
      value: fmtEur(t.investedCostEur),
    },
    {
      kicker: "Plusvalía latente",
      value: fmtEur(t.unrealizedPnlEur),
      sub: `${fmtPct(t.unrealizedPnlPct)} sobre coste`,
      tone: toneFor(t.unrealizedPnlEur),
    },
  ]);

  // ── Secciones (numeración dinámica según qué bloques existan) ────────────
  let sectionNum = 0;
  const series = opts.series ?? [];
  if (series.length >= 2) {
    sectionTitle(cur, ++sectionNum, "Evolución del patrimonio");
    room(160);
    areaChart(
      cur,
      CONTENT_W - 64,
      120,
      series.map((p) => ({ label: p.date, value: p.valueEur })),
    );
    cur.y += 6;
  }

  // ── 2 · Composición ──────────────────────────────────────────────────────
  const sliceGroups = report.groups.filter((g) => g.marketValueEur > 0);
  if (sliceGroups.length > 0) {
    sectionTitle(cur, ++sectionNum, "Composición de la cartera");
    const shownAccounts = report.accounts.filter((a) => a.totalEur !== 0).slice(0, 6);
    // Alturas reales de las tres columnas — el avance final usa el máximo
    // para que la columna derecha nunca pise la sección siguiente.
    const donutH = 128;
    const legendH = 16 + sliceGroups.length * 18;
    const barsH = shownAccounts.length > 0 ? 24 + shownAccounts.length * 26 + 14 : 0;
    const blockH = Math.max(donutH, legendH, barsH);
    room(blockH + 12);

    // Donut a la izquierda + leyenda; barras por cuenta a la derecha.
    const donutCx = M + 70;
    const donutCy = cur.y + 56;
    donut(
      doc,
      donutCx,
      donutCy,
      42,
      18,
      sliceGroups.map((g, i) => ({ value: g.marketValueEur, color: CHART[i % CHART.length] })),
    );
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    text(doc, MUTED);
    doc.text("INVERTIDO", donutCx, donutCy - 3, { align: "center" });
    doc.setFontSize(9);
    text(doc, INK);
    doc.text(fmtEur(t.investedMarketValueEur), donutCx, donutCy + 8, { align: "center" });

    // Leyenda del donut.
    let ly = cur.y + 14;
    const legendX = M + 158;
    for (let i = 0; i < sliceGroups.length; i++) {
      const g = sliceGroups[i];
      fill(doc, CHART[i % CHART.length]);
      doc.roundedRect(legendX, ly - 6.5, 9, 9, 2, 2, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      text(doc, INK);
      doc.text(
        `${assetTypeLabelPdf(g.assetType)} — ${(g.weight * 100).toFixed(1).replace(".", ",")}%`,
        legendX + 15,
        ly + 1,
      );
      doc.setFont("helvetica", "bold");
      doc.text(fmtEur(g.marketValueEur), legendX + 170, ly + 1, { align: "right" });
      ly += 18;
    }

    // Valor por cuenta (barras apiladas efectivo + invertido).
    if (shownAccounts.length > 0) {
      const bx = M + 348;
      const bw = RIGHT - bx;
      kicker(doc, "Valor por cuenta", bx, cur.y + 6);
      let by = cur.y + 22;
      const maxTotal = Math.max(...shownAccounts.map((a) => a.totalEur), 1e-9);
      for (const a of shownAccounts) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        text(doc, INK);
        doc.text(truncate(a.name, 20), bx, by);
        const wInv = Math.max(0, (a.investedEur / maxTotal) * (bw - 74));
        const wCash = Math.max(0, (a.cashEur / maxTotal) * (bw - 74));
        fill(doc, ACCENT);
        doc.rect(bx, by + 4, wInv, 7, "F");
        fill(doc, [148, 163, 184]);
        doc.rect(bx + wInv, by + 4, wCash, 7, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text(fmtEur(a.totalEur), bx + bw, by + 10, { align: "right" });
        by += 26;
      }
      // Mini leyenda.
      fill(doc, ACCENT);
      doc.rect(bx, by, 6, 6, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      text(doc, MUTED);
      doc.text("Invertido", bx + 9, by + 5);
      fill(doc, [148, 163, 184]);
      doc.rect(bx + 54, by, 6, 6, "F");
      doc.text("Efectivo", bx + 63, by + 5);
      text(doc, INK);
    }
    cur.y += blockH + 12;
  }

  // ── Posiciones por tipo de activo ─────────────────────────────────────────
  sectionTitle(cur, ++sectionNum, "Posiciones por tipo de activo");
  if (report.groups.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    text(doc, MUTED);
    doc.text("Sin posiciones abiertas.", M, cur.y);
    text(doc, INK);
    cur.y += 20;
  }
  const cols: Col[] = [
    { label: "Activo", x: M },
    { label: "Símbolo", x: M + 165 },
    { label: "Cantidad", x: M + 252, align: "right" },
    { label: "Precio", x: M + 310, align: "right" },
    { label: "Valor", x: M + 374, align: "right" },
    { label: "Coste", x: M + 438, align: "right" },
    { label: "P/G", x: RIGHT, align: "right" },
  ];
  report.groups.forEach((group, gi) => {
    // Sin redibujo de cabecera en el salto: el grupo pinta la suya justo después.
    room(64);
    // Cabecera de grupo con punto de color y subtotal.
    const color = CHART[gi % CHART.length];
    fill(doc, color);
    doc.circle(M + 4, cur.y - 2.5, 3.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    text(doc, INK);
    doc.text(assetTypeLabelPdf(group.assetType), M + 14, cur.y);
    // Medir el ancho ANTES de cambiar a la fuente pequeña — si no, el sufijo
    // se pega al nombre del grupo.
    const groupNameW = doc.getTextWidth(assetTypeLabelPdf(group.assetType));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    text(doc, MUTED);
    doc.text(
      `${(group.weight * 100).toFixed(1).replace(".", ",")}% de lo invertido`,
      M + 14 + groupNameW + 14,
      cur.y,
    );
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    text(doc, INK);
    doc.text(fmtEur(group.marketValueEur), RIGHT, cur.y, { align: "right" });
    cur.y += 20;
    tableHead(cur, cols);

    group.lines.forEach((line, i) => {
      room(20, (c) => tableHead(c, cols));
      zebra(cur, i, 17);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      text(doc, INK);
      doc.text(truncate(line.name, 26), M, cur.y);
      text(doc, MUTED);
      doc.text(truncate(line.symbol ?? "—", 12), M + 165, cur.y);
      text(doc, INK);
      doc.text(fmtQty(line.quantity), M + 252, cur.y, { align: "right" });
      doc.text(line.unitPriceEur != null ? fmtEur(line.unitPriceEur) : "—", M + 310, cur.y, { align: "right" });
      doc.text(line.marketValueEur != null ? fmtEur(line.marketValueEur) : "—", M + 374, cur.y, { align: "right" });
      doc.text(fmtEur(line.costEur), M + 438, cur.y, { align: "right" });
      const pnl = line.pnlEur ?? 0;
      doc.setFont("helvetica", "bold");
      text(doc, line.pnlEur == null ? FAINT : toneFor(pnl));
      doc.text(fmtPct(line.pnlPct), RIGHT, cur.y, { align: "right" });
      text(doc, INK);
      cur.y += 17;
    });

    room(20);
    cur.y += 3;
    totalRule(cur);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text(`Subtotal ${assetTypeLabelPdf(group.assetType)}`, M, cur.y);
    doc.text(fmtEur(group.marketValueEur), M + 374, cur.y, { align: "right" });
    doc.text(fmtEur(group.costEur), M + 438, cur.y, { align: "right" });
    text(doc, toneFor(group.pnlEur));
    doc.text(`${group.pnlEur >= 0 ? "+" : ""}${fmtEur(group.pnlEur)}`, RIGHT, cur.y, { align: "right" });
    text(doc, INK);
    cur.y += 28;
  });

  // ── Cuentas ───────────────────────────────────────────────────────────────
  sectionTitle(cur, ++sectionNum, "Cuentas");
  const acols: Col[] = [
    { label: "Cuenta", x: M },
    { label: "Tipo", x: M + 200 },
    { label: "Efectivo", x: M + 340, align: "right" },
    { label: "Invertido", x: M + 430, align: "right" },
    { label: "Total", x: RIGHT, align: "right" },
  ];
  tableHead(cur, acols);
  report.accounts.forEach((account, i) => {
    room(20, (c) => tableHead(c, acols));
    zebra(cur, i, 17);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(truncate(account.name, 40), M, cur.y);
    text(doc, MUTED);
    doc.text(accountTypeLabel(account.accountType), M + 200, cur.y);
    text(doc, INK);
    doc.text(fmtEur(account.cashEur), M + 340, cur.y, { align: "right" });
    doc.text(fmtEur(account.investedEur), M + 430, cur.y, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(fmtEur(account.totalEur), RIGHT, cur.y, { align: "right" });
    cur.y += 17;
  });

  // Banda final de patrimonio total.
  room(44);
  cur.y += 6;
  fill(doc, BAND);
  doc.roundedRect(M, cur.y - 12, CONTENT_W, 32, 5, 5, "F");
  fill(doc, ACCENT);
  doc.rect(M, cur.y - 12, 3, 32, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  text(doc, WHITE);
  doc.text("Patrimonio total", M + 14, cur.y + 8);
  doc.text(fmtEur(t.netWorthEur), RIGHT - 12, cur.y + 8, { align: "right" });
  text(doc, INK);
  cur.y += 34;

  finishFooters(doc, `Finances Panel · Extracto de cartera · ${stamp}`);
  const out = doc.output("arraybuffer");
  return new Uint8Array(out);
}
