import { jsPDF } from "jspdf";
import type { DividendReportRow, SaleReportRow, TaxReport } from "../../server/tax/report";
import type { InformationalModelsStatus } from "../../server/tax/m720";
import { buildPrevision } from "../../server/tax/prevision";
import {
  ACCENT,
  ACCENT_SOFT,
  type Col,
  type Cursor,
  CONTENT_W,
  FAINT,
  HAIR,
  INK,
  M,
  MUTED,
  NEG,
  PANEL,
  POS,
  RIGHT,
  WHITE,
  continuationHeader,
  donut,
  ensureRoom,
  fill,
  finishFooters,
  fmtDateIso,
  fmtEur,
  hBars,
  headerBand,
  kicker,
  sectionTitle,
  statCards,
  stroke,
  tableHead,
  text,
  toneFor,
  totalRule,
  zebra,
} from "./_kit";

export type TaxPdfInput = {
  year: number;
  report: TaxReport;
  models: InformationalModelsStatus;
  sealedAt: number | null;
  /** Intereses de cuentas remuneradas del ejercicio (RCM), informativo. */
  interestEur: number;
};

type AssetSalesGroup = {
  label: string;
  isin: string | null;
  ops: number;
  quantity: number;
  proceedsEur: number;
  costBasisEur: number;
  feesEur: number;
  rawGainLossEur: number;
  nonComputableLossEur: number;
  computableGainLossEur: number;
};

function groupSalesByAsset(sales: SaleReportRow[]): AssetSalesGroup[] {
  const byAsset = new Map<string, AssetSalesGroup>();
  for (const s of sales) {
    let g = byAsset.get(s.assetId);
    if (!g) {
      g = {
        label: s.assetName ?? s.assetId,
        isin: s.isin,
        ops: 0,
        quantity: 0,
        proceedsEur: 0,
        costBasisEur: 0,
        feesEur: 0,
        rawGainLossEur: 0,
        nonComputableLossEur: 0,
        computableGainLossEur: 0,
      };
      byAsset.set(s.assetId, g);
    }
    g.ops += 1;
    g.quantity += s.quantity;
    g.proceedsEur += s.proceedsEur;
    g.costBasisEur += s.costBasisEur;
    g.feesEur += s.feesEur;
    g.rawGainLossEur += s.rawGainLossEur;
    g.nonComputableLossEur += s.nonComputableLossEur;
    g.computableGainLossEur += s.computableGainLossEur;
  }
  return [...byAsset.values()].sort((a, b) => a.label.localeCompare(b.label, "es"));
}

type AssetDividendGroup = {
  label: string;
  country: string | null;
  payments: number;
  grossEur: number;
  withholdingOrigenEur: number;
  withholdingDestinoEur: number;
  netEur: number;
};

function groupDividendsByAsset(dividends: DividendReportRow[]): AssetDividendGroup[] {
  const byAsset = new Map<string, AssetDividendGroup>();
  for (const d of dividends) {
    let g = byAsset.get(d.assetId);
    if (!g) {
      g = {
        label: d.assetName ?? d.assetId,
        country: d.sourceCountry,
        payments: 0,
        grossEur: 0,
        withholdingOrigenEur: 0,
        withholdingDestinoEur: 0,
        netEur: 0,
      };
      byAsset.set(d.assetId, g);
    }
    g.payments += 1;
    g.grossEur += d.grossEur;
    g.withholdingOrigenEur += d.withholdingOrigenEur;
    g.withholdingDestinoEur += d.withholdingDestinoEur;
    g.netEur += d.netEur;
  }
  return [...byAsset.values()].sort((a, b) => a.label.localeCompare(b.label, "es"));
}

const truncate = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

export function buildTaxReportPdf(input: TaxPdfInput): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const cur: Cursor = { doc, y: 0 };
  const t = input.report.totals;
  const prevision = buildPrevision(input.report, input.interestEur);
  const est = prevision.cuota;

  const room = (needed: number, onNewPage?: (c: Cursor) => void) =>
    ensureRoom(cur, needed, (c) => {
      continuationHeader(c, `Informe fiscal IRPF · ejercicio ${input.year}`);
      onNewPage?.(c);
    });

  // ── Cabecera ──────────────────────────────────────────────────────────────
  cur.y = headerBand(doc, {
    title: "Informe fiscal IRPF · Hacienda Foral de Bizkaia",
    big: `Ejercicio ${input.year}`,
    subtitle: "Ganancias patrimoniales, dividendos y previsión foral · NF 13/2013",
    metaLines: [`Generado el ${fmtDateIso(Date.now())}`],
    badge: input.sealedAt
      ? { label: `Sellado el ${fmtDateIso(input.sealedAt)}`, tone: "accent" }
      : { label: "Sin sellar · datos en vivo", tone: "muted" },
  });

  // ── Tarjetas de resumen ───────────────────────────────────────────────────
  const rcm = t.dividendsGrossEur + input.interestEur;
  statCards(cur, [
    {
      kicker: "Resultado de ventas",
      value: fmtEur(t.netComputableEur),
      sub: `${input.report.sales.length} venta${input.report.sales.length === 1 ? "" : "s"} · saldo computable`,
      tone: toneFor(t.netComputableEur),
    },
    {
      kicker: "Dividendos e intereses",
      value: fmtEur(rcm),
      sub:
        t.withholdingOrigenTotalEur + t.withholdingDestinoTotalEur > 0
          ? `ya retenido ${fmtEur(t.withholdingOrigenTotalEur + t.withholdingDestinoTotalEur)}`
          : "sin retenciones",
    },
    {
      kicker: est.resultadoEstimadoEur >= 0 ? "A pagar (estimado)" : "A devolver (estimado)",
      value: fmtEur(Math.abs(est.resultadoEstimadoEur)),
      sub: `previsión foral · base ${fmtEur(est.baseAhorroEur)}`,
    },
  ]);

  // ── 1 · Resumen del ejercicio ─────────────────────────────────────────────
  sectionTitle(cur, 1, "Resumen del ejercicio");
  const kv = (label: string, value: string, opts: { bold?: boolean; tone?: typeof INK } = {}) => {
    room(16);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(8.5);
    text(doc, opts.bold ? INK : MUTED);
    doc.text(label, M, cur.y);
    text(doc, opts.tone ?? INK);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.text(value, RIGHT, cur.y, { align: "right" });
    text(doc, INK);
    cur.y += 6;
    stroke(doc, HAIR);
    doc.setLineWidth(0.5);
    doc.line(M, cur.y, RIGHT, cur.y);
    cur.y += 11;
  };
  kv("Importe total de transmisiones", fmtEur(t.proceedsEur));
  kv("Coste de adquisición (FIFO, comisiones de compra incluidas)", fmtEur(t.costBasisEur));
  kv("Comisiones de venta deducidas", fmtEur(t.feesEur));
  kv("Ganancias patrimoniales realizadas", fmtEur(t.realizedGainsEur), { tone: POS });
  kv("Pérdidas patrimoniales computables", fmtEur(t.realizedLossesComputableEur), {
    tone: t.realizedLossesComputableEur < 0 ? NEG : INK,
  });
  if (t.nonComputableLossesEur > 0) {
    kv("Pérdidas no computables (recompra, art. 43)", fmtEur(t.nonComputableLossesEur));
  }
  kv("Saldo neto computable de ganancias y pérdidas", fmtEur(t.netComputableEur), {
    bold: true,
    tone: toneFor(t.netComputableEur),
  });
  kv("Dividendos brutos", fmtEur(t.dividendsGrossEur));
  kv("Retenciones en origen (extranjero)", fmtEur(t.withholdingOrigenTotalEur));
  kv("Retenciones en destino (pagos a cuenta)", fmtEur(t.withholdingDestinoTotalEur));
  if (input.interestEur !== 0) kv("Intereses de cuentas (RCM)", fmtEur(input.interestEur));
  if (input.report.excludedSales && input.report.excludedSales.count > 0) {
    room(12);
    doc.setFontSize(7);
    text(doc, FAINT);
    doc.text(
      `${input.report.excludedSales.count} microtransmisiones excluidas por umbral de 1 € ` +
        `(transmisión ${fmtEur(input.report.excludedSales.proceedsEur)}, coste ${fmtEur(input.report.excludedSales.costBasisEur)}).`,
      M,
      cur.y,
    );
    text(doc, INK);
    cur.y += 14;
  }
  cur.y += 6;

  // ── 2 · Declaración ───────────────────────────────────────────────────────
  sectionTitle(
    cur,
    2,
    "Declaración — operaciones a transcribir en Rentanet",
    "Una fila por pareja venta / compra (FIFO). Valores históricos sin actualizar: el programa foral aplica los coeficientes a partir de las fechas.",
  );
  const declaration = input.report.declaration ?? [];
  if (declaration.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    text(doc, MUTED);
    doc.text("Sin transmisiones en el ejercicio.", M, cur.y);
    text(doc, INK);
    cur.y += 20;
  } else {
    const cols: Col[] = [
      { label: "Activo", x: M },
      { label: "F. adq.", x: M + 190, align: "right" },
      { label: "F. venta", x: M + 244, align: "right" },
      { label: "Cant.", x: M + 282, align: "right" },
      { label: "V. adquis.", x: M + 344, align: "right" },
      { label: "V. transm.", x: M + 406, align: "right" },
      { label: "Gastos", x: M + 448, align: "right" },
      { label: "Resultado", x: RIGHT, align: "right" },
    ];
    tableHead(cur, cols);
    let totAdq = 0;
    let totTrans = 0;
    let totGastos = 0;
    let totRes = 0;
    declaration.forEach((d, i) => {
      const rowH = d.recompra ? 26 : 16;
      room(rowH + 6, (c) => tableHead(c, cols));
      zebra(cur, i, rowH);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      text(doc, INK);
      doc.text(truncate(d.assetName ?? d.isin ?? d.assetId, 24), M, cur.y);
      doc.text(fmtDateIso(d.acquiredAt), cols[1].x, cur.y, { align: "right" });
      doc.text(fmtDateIso(d.soldAt), cols[2].x, cur.y, { align: "right" });
      doc.text(d.qty.toLocaleString("es-ES", { maximumFractionDigits: 6 }), cols[3].x, cur.y, { align: "right" });
      doc.text(fmtEur(d.valorAdquisicionEur), cols[4].x, cur.y, { align: "right" });
      doc.text(fmtEur(d.valorTransmisionEur), cols[5].x, cur.y, { align: "right" });
      doc.text(fmtEur(d.gastosTransmisionEur), cols[6].x, cur.y, { align: "right" });
      doc.setFont("helvetica", "bold");
      text(doc, toneFor(d.resultadoEur));
      doc.text(fmtEur(d.resultadoEur), RIGHT, cur.y, { align: "right" });
      text(doc, INK);
      if (d.recompra) {
        cur.y += 10;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        text(doc, NEG);
        doc.text(
          "[!] Recompra de valores homogéneos — marcar la norma antiaplicación (art. 43) en esta operación.",
          M + 8,
          cur.y,
        );
        text(doc, INK);
      }
      cur.y += 16;
      totAdq += d.valorAdquisicionEur;
      totTrans += d.valorTransmisionEur;
      totGastos += d.gastosTransmisionEur;
      totRes += d.resultadoEur;
    });
    room(20);
    cur.y += 4;
    totalRule(cur);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Total", M, cur.y);
    doc.text(fmtEur(totAdq), cols[4].x, cur.y, { align: "right" });
    doc.text(fmtEur(totTrans), cols[5].x, cur.y, { align: "right" });
    doc.text(fmtEur(totGastos), cols[6].x, cur.y, { align: "right" });
    text(doc, toneFor(totRes));
    doc.text(fmtEur(totRes), RIGHT, cur.y, { align: "right" });
    text(doc, INK);
    cur.y += 22;
  }

  // ── 3 · Previsión foral ───────────────────────────────────────────────────
  room(180);
  sectionTitle(
    cur,
    3,
    "Previsión — cálculo foral estimado",
    `${est.scaleLabel} · coeficientes DF 125/2024 (2025) / DF 115/2025 (2026) · arts. 45 y 66 NF 13/2013. ` +
      "Estimación orientativa de la base del ahorro aislada — el cálculo vinculante es el del programa de renta foral.",
  );
  const pkv = (label: string, value: string, opts: { bold?: boolean; tone?: typeof INK } = {}) => {
    room(15);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(8.5);
    text(doc, opts.bold ? INK : MUTED);
    doc.text(label, M + 10, cur.y);
    text(doc, opts.tone ?? INK);
    doc.text(value, RIGHT - 10, cur.y, { align: "right" });
    text(doc, INK);
    cur.y += 14.5;
  };
  if (!prevision.coefficientsAvailable) {
    pkv("Sin tabla de coeficientes publicada para este ejercicio", "—");
  }
  pkv("Saldo histórico declarado (sin coeficientes)", fmtEur(t.netComputableEur));
  pkv("Saldo foral previsto (coste actualizado)", fmtEur(prevision.saldoGananciasForalEur), { bold: true });
  if (prevision.coefficientReliefEur !== 0) {
    pkv("Menor ganancia por coeficientes de actualización", fmtEur(-prevision.coefficientReliefEur), { tone: POS });
  }
  if (prevision.perdidasNoComputablesEur > 0) {
    pkv("Pérdidas no computables (recompra, art. 43)", fmtEur(prevision.perdidasNoComputablesEur));
  }
  if (est.dividendExemptionAppliedEur > 0) {
    pkv("Exención foral de dividendos (máx. 1.500 €)", fmtEur(-est.dividendExemptionAppliedEur), { tone: POS });
  }
  pkv("Saldo de rendimientos del capital mobiliario", fmtEur(est.saldoRcmEur));
  if (est.lossCarryForwardEur > 0) {
    pkv("Saldo negativo pendiente (4 ejercicios, art. 66)", fmtEur(est.lossCarryForwardEur));
  }
  pkv("Base liquidable del ahorro estimada", fmtEur(est.baseAhorroEur), { bold: true });
  pkv("Cuota íntegra estimada", fmtEur(est.cuotaIntegraEur), { bold: true });
  if (est.ddiCreditEur > 0) {
    pkv("Deducción doble imposición internacional (topada a cuota)", fmtEur(-est.ddiCreditEur));
  }
  if (est.withholdingDestinoEur > 0) {
    pkv("Retenciones ya practicadas en destino", fmtEur(-est.withholdingDestinoEur));
  }
  // Resultado destacado en banda de acento suave.
  room(30);
  fill(doc, ACCENT_SOFT);
  doc.roundedRect(M, cur.y - 11, CONTENT_W, 24, 4, 4, "F");
  fill(doc, ACCENT);
  doc.rect(M, cur.y - 11, 3, 24, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  text(doc, INK);
  doc.text(
    est.resultadoEstimadoEur >= 0 ? "Resultado estimado (a ingresar)" : "Resultado estimado (a devolver)",
    M + 12,
    cur.y + 4,
  );
  doc.text(fmtEur(est.resultadoEstimadoEur), RIGHT - 10, cur.y + 4, { align: "right" });
  cur.y += 32;

  // ── 4 · Ganancias y pérdidas por activo ───────────────────────────────────
  sectionTitle(cur, 4, "Ganancias y pérdidas patrimoniales por activo");
  const salesGroups = groupSalesByAsset(input.report.sales);
  if (salesGroups.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    text(doc, MUTED);
    doc.text("Sin transmisiones en el ejercicio.", M, cur.y);
    text(doc, INK);
    cur.y += 20;
  } else {
    const cols: Col[] = [
      { label: "Activo", x: M },
      { label: "Ops.", x: M + 238, align: "right" },
      { label: "Transmisión", x: M + 312, align: "right" },
      { label: "Coste adq.", x: M + 382, align: "right" },
      { label: "Comis.", x: M + 430, align: "right" },
      { label: "Computable", x: RIGHT, align: "right" },
    ];
    tableHead(cur, cols);
    salesGroups.forEach((g, i) => {
      const rowH = 26;
      room(rowH + 6, (c) => tableHead(c, cols));
      zebra(cur, i, rowH);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(truncate(g.label, 32), M, cur.y);
      doc.text(String(g.ops), cols[1].x, cur.y, { align: "right" });
      doc.text(fmtEur(g.proceedsEur), cols[2].x, cur.y, { align: "right" });
      doc.text(fmtEur(g.costBasisEur), cols[3].x, cur.y, { align: "right" });
      doc.text(fmtEur(g.feesEur), cols[4].x, cur.y, { align: "right" });
      doc.setFont("helvetica", "bold");
      text(doc, toneFor(g.computableGainLossEur));
      doc.text(fmtEur(g.computableGainLossEur), RIGHT, cur.y, { align: "right" });
      text(doc, INK);
      cur.y += 10;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      text(doc, FAINT);
      const detail = [
        g.isin ? `ISIN ${g.isin}` : null,
        `cantidad ${g.quantity.toLocaleString("es-ES", { maximumFractionDigits: 8 })}`,
        g.nonComputableLossEur !== 0
          ? `pérdida aplazada art. 43: ${fmtEur(g.nonComputableLossEur)} (G/P bruta ${fmtEur(g.rawGainLossEur)})`
          : null,
      ]
        .filter(Boolean)
        .join("  ·  ");
      doc.text(detail, M + 8, cur.y);
      text(doc, INK);
      cur.y += 16;
    });
    room(20);
    cur.y += 4;
    totalRule(cur);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Total", M, cur.y);
    doc.text(fmtEur(t.proceedsEur), M + 312, cur.y, { align: "right" });
    doc.text(fmtEur(t.costBasisEur), M + 382, cur.y, { align: "right" });
    doc.text(fmtEur(t.feesEur), M + 430, cur.y, { align: "right" });
    text(doc, toneFor(t.netComputableEur));
    doc.text(fmtEur(t.netComputableEur), RIGHT, cur.y, { align: "right" });
    text(doc, INK);
    cur.y += 24;

    if (salesGroups.length >= 2) {
      room(40 + salesGroups.length * 17);
      kicker(doc, "Resultado computable por activo", M, cur.y);
      cur.y += 14;
      hBars(
        cur,
        salesGroups.map((g) => ({ label: g.label, value: g.computableGainLossEur })),
        { labelW: 150 },
      );
      cur.y += 8;
    }
  }

  // ── 5 · Dividendos por activo ─────────────────────────────────────────────
  sectionTitle(cur, 5, "Dividendos por activo");
  const dividendGroups = groupDividendsByAsset(input.report.dividends);
  if (dividendGroups.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    text(doc, MUTED);
    doc.text("Sin dividendos en el ejercicio.", M, cur.y);
    text(doc, INK);
    cur.y += 20;
  } else {
    const cols: Col[] = [
      { label: "Activo", x: M },
      { label: "País", x: M + 220, align: "right" },
      { label: "Pagos", x: M + 256, align: "right" },
      { label: "Bruto", x: M + 320, align: "right" },
      { label: "R. origen", x: M + 384, align: "right" },
      { label: "R. destino", x: M + 444, align: "right" },
      { label: "Neto", x: RIGHT, align: "right" },
    ];
    tableHead(cur, cols);
    dividendGroups.forEach((g, i) => {
      room(20, (c) => tableHead(c, cols));
      zebra(cur, i, 15);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(truncate(g.label, 30), M, cur.y);
      doc.text(g.country ?? "—", cols[1].x, cur.y, { align: "right" });
      doc.text(String(g.payments), cols[2].x, cur.y, { align: "right" });
      doc.text(fmtEur(g.grossEur), cols[3].x, cur.y, { align: "right" });
      doc.text(fmtEur(g.withholdingOrigenEur), cols[4].x, cur.y, { align: "right" });
      doc.text(fmtEur(g.withholdingDestinoEur), cols[5].x, cur.y, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.text(fmtEur(g.netEur), RIGHT, cur.y, { align: "right" });
      cur.y += 15;
    });
    room(20);
    cur.y += 4;
    totalRule(cur);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Total", M, cur.y);
    doc.text(fmtEur(t.dividendsGrossEur), M + 320, cur.y, { align: "right" });
    doc.text(fmtEur(t.withholdingOrigenTotalEur), M + 384, cur.y, { align: "right" });
    doc.text(fmtEur(t.withholdingDestinoTotalEur), M + 444, cur.y, { align: "right" });
    cur.y += 24;
  }

  // ── 6 · Casillas ──────────────────────────────────────────────────────────
  sectionTitle(
    cur,
    6,
    "Casillas — numeración orientativa (modelo estatal)",
    "El modelo foral usa numeración propia: estas casillas sirven de guía de qué importe va en cada concepto.",
  );
  const casillas: { num: string; label: string; value: number }[] = [
    { num: "0326", label: "Ganancias patrimoniales (transmisión)", value: t.realizedGainsEur },
    { num: "0340", label: "Pérdidas computables", value: Math.abs(t.realizedLossesComputableEur) },
    { num: "0343", label: "Saldo neto de ganancias y pérdidas", value: t.netComputableEur },
    { num: "0027", label: "Rendimientos del capital mobiliario", value: t.dividendsGrossEur },
    {
      num: "0029",
      label: "Retenciones e ingresos a cuenta",
      value: t.withholdingOrigenTotalEur + t.withholdingDestinoTotalEur,
    },
    { num: "0588", label: "Deducción doble imposición internacional", value: est.ddiCreditEur },
  ];
  const boxW = (CONTENT_W - 10) / 2;
  const boxH = 36;
  for (let i = 0; i < casillas.length; i += 2) {
    room(boxH + 10);
    for (let j = 0; j < 2 && i + j < casillas.length; j++) {
      const c = casillas[i + j];
      const x = M + j * (boxW + 10);
      stroke(doc, HAIR);
      fill(doc, PANEL);
      doc.setLineWidth(0.75);
      doc.roundedRect(x, cur.y, boxW, boxH, 5, 5, "FD");
      fill(doc, ACCENT);
      doc.roundedRect(x + 10, cur.y + 10, 32, 16, 3, 3, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      text(doc, WHITE);
      doc.text(c.num, x + 26, cur.y + 21, { align: "center" });
      doc.setFontSize(7);
      text(doc, MUTED);
      doc.setFont("helvetica", "normal");
      doc.text(truncate(c.label, 38), x + 50, cur.y + 16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      text(doc, INK);
      doc.text(fmtEur(c.value), x + boxW - 12, cur.y + 27, { align: "right" });
    }
    cur.y += boxH + 10;
  }
  cur.y += 10;

  // ── 7 · Modelos informativos ──────────────────────────────────────────────
  sectionTitle(cur, 7, "Modelos informativos (720 · 721)");
  const renderBlocks = (label: string, blocks: InformationalModelsStatus["m720"]["blocks"]) => {
    room(18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    text(doc, INK);
    doc.text(label, M, cur.y);
    cur.y += 13;
    if (blocks.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      text(doc, FAINT);
      doc.text("Sin bloques declarables", M + 10, cur.y);
      text(doc, INK);
      cur.y += 14;
      return;
    }
    for (const b of blocks) {
      room(14);
      const flag = b.hasUnvalued ? "  [SIN VALORAR — incompleto]" : b.hasStale ? "  [valoración desfasada]" : "";
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      text(doc, b.hasUnvalued ? NEG : MUTED);
      doc.text(`${b.country}  ·  ${b.type}  ·  ${b.status}${flag}`, M + 10, cur.y);
      text(doc, INK);
      doc.setFont("helvetica", "bold");
      doc.text(fmtEur(b.valueEur), RIGHT, cur.y, { align: "right" });
      cur.y += 12;
    }
    cur.y += 6;
  };
  renderBlocks("Modelo 720 — bienes y derechos en el extranjero", input.models.m720.blocks);
  renderBlocks("Modelo 721 — monedas virtuales en el extranjero", input.models.m721.blocks);

  // Nota final.
  room(20);
  cur.y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  text(doc, FAINT);
  doc.text(
    "Documento generado por Finances Panel. Estimaciones orientativas según normativa foral; no constituye asesoramiento fiscal.",
    M,
    cur.y,
  );
  text(doc, INK);

  // Pequeño donut decorativo-informativo en la cabecera de página 1 si hay
  // composición de resultado (ganancias vs pérdidas) — lo dibujamos al final
  // para conocer los totales, sobre coordenadas fijas de la banda.
  if (t.realizedGainsEur > 0 && t.realizedLossesComputableEur < 0) {
    doc.setPage(1);
    donut(doc, RIGHT - 24, 84, 11, 7, [
      { value: t.realizedGainsEur, color: ACCENT },
      { value: Math.abs(t.realizedLossesComputableEur), color: [148, 163, 184] },
    ]);
  }

  finishFooters(doc, `Finances Panel · Informe fiscal IRPF ${input.year} · Bizkaia`);
  const out = doc.output("arraybuffer");
  return new Uint8Array(out);
}
