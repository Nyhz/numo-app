import type { jsPDF } from "jspdf";
import { ASSET_TYPE_LABELS } from "../labels";

/**
 * Design kit compartido por los PDF generados (informe fiscal y extracto).
 * Estética "documento de banca privada": tinta sobria, un acento teal,
 * paneles claros redondeados, tablas zebra con aire y gráficos vectoriales
 * dibujados a mano (sin imágenes rasterizadas).
 */

export type RGB = readonly [number, number, number];

export const INK: RGB = [17, 24, 39];
export const MUTED: RGB = [107, 114, 128];
export const FAINT: RGB = [156, 163, 175];
export const HAIR: RGB = [229, 231, 235];
export const PANEL: RGB = [246, 247, 249];
export const BAND: RGB = [11, 18, 32];
export const BAND_TEXT: RGB = [226, 232, 240];
export const ACCENT: RGB = [15, 118, 110];
export const ACCENT_SOFT: RGB = [204, 229, 226];
export const POS: RGB = [4, 120, 87];
export const NEG: RGB = [185, 28, 28];
export const WHITE: RGB = [255, 255, 255];

/** Paleta categórica para gráficos (imprime bien en claro y en gris). */
export const CHART: RGB[] = [
  [15, 118, 110], // teal
  [67, 56, 202], // indigo
  [180, 83, 9], // amber
  [190, 18, 60], // rose
  [71, 85, 105], // slate
];

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const M = 48;
export const CONTENT_W = PAGE_W - M * 2;
export const RIGHT = PAGE_W - M;
export const BREAK_Y = PAGE_H - 70;

export type Cursor = { doc: jsPDF; y: number };

export function fill(doc: jsPDF, c: RGB): void {
  doc.setFillColor(c[0], c[1], c[2]);
}
export function stroke(doc: jsPDF, c: RGB): void {
  doc.setDrawColor(c[0], c[1], c[2]);
}
export function text(doc: jsPDF, c: RGB): void {
  doc.setTextColor(c[0], c[1], c[2]);
}

export function fmtEur(n: number): string {
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export function fmtDateIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function toneFor(n: number): RGB {
  return n > 0 ? POS : n < 0 ? NEG : INK;
}

export function ensureRoom(cur: Cursor, needed: number, onNewPage?: (cur: Cursor) => void): void {
  if (cur.y + needed > BREAK_Y) {
    cur.doc.addPage();
    cur.y = M;
    onNewPage?.(cur);
  }
}

/** charSpace persiste entre llamadas en jsPDF — siempre resetear tras usarlo. */
function resetCharSpace(doc: jsPDF): void {
  (doc as unknown as { setCharSpace?: (n: number) => void }).setCharSpace?.(0);
}

/** Etiqueta pequeña en mayúsculas con tracking — el "kicker" de cards y tablas. */
export function kicker(doc: jsPDF, label: string, x: number, y: number, color: RGB = MUTED, align?: "right"): void {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  text(doc, color);
  doc.text(label.toUpperCase(), x, y, { charSpace: 0.8, align });
  resetCharSpace(doc);
  text(doc, INK);
}

/** Banda de cabecera oscura de la primera página. */
export function headerBand(
  doc: jsPDF,
  opts: {
    title: string;
    big: string;
    subtitle: string;
    metaLines: string[];
    badge?: { label: string; tone: "accent" | "muted" };
  },
): number {
  const H = 112;
  fill(doc, BAND);
  doc.rect(0, 0, PAGE_W, H, "F");
  // Filo de acento en la base de la banda.
  fill(doc, ACCENT);
  doc.rect(0, H - 3, PAGE_W, 3, "F");

  kicker(doc, opts.title, M, 34, [148, 163, 184]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  text(doc, WHITE);
  doc.text(opts.big, M, 62);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  text(doc, BAND_TEXT);
  doc.text(opts.subtitle, M, 80);

  let metaY = 36;
  doc.setFontSize(8);
  for (const line of opts.metaLines) {
    doc.text(line, RIGHT, metaY, { align: "right" });
    metaY += 12;
  }
  if (opts.badge) {
    const label = opts.badge.label.toUpperCase();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    const w = doc.getTextWidth(label) + 14;
    const bx = RIGHT - w;
    const by = metaY - 2;
    if (opts.badge.tone === "accent") fill(doc, ACCENT);
    else fill(doc, [51, 65, 85]);
    doc.roundedRect(bx, by, w, 14, 7, 7, "F");
    text(doc, WHITE);
    doc.text(label, bx + 7, by + 9.5, { charSpace: 0.6 });
    resetCharSpace(doc);
  }
  text(doc, INK);
  return H + 24;
}

/** Cabecera de continuación en páginas interiores. */
export function continuationHeader(cur: Cursor, leftLabel: string): void {
  const { doc } = cur;
  kicker(doc, leftLabel, M, M - 14, FAINT);
  stroke(doc, HAIR);
  doc.setLineWidth(0.75);
  doc.line(M, M - 8, RIGHT, M - 8);
  cur.y = M + 6;
}

export type StatCard = {
  kicker: string;
  value: string;
  sub?: string;
  tone?: RGB;
};

/** Fila de tarjetas de resumen (paneles claros redondeados). */
export function statCards(cur: Cursor, cards: StatCard[]): void {
  const { doc } = cur;
  const gap = 10;
  const w = (CONTENT_W - gap * (cards.length - 1)) / cards.length;
  const h = 72;
  cards.forEach((c, i) => {
    const x = M + i * (w + gap);
    fill(doc, PANEL);
    doc.roundedRect(x, cur.y, w, h, 6, 6, "F");
    kicker(doc, c.kicker, x + 12, cur.y + 17);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    text(doc, c.tone ?? INK);
    doc.text(c.value, x + 12, cur.y + 40);
    if (c.sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      text(doc, MUTED);
      // Wrap within the card so a long breakdown (efectivo · invertido ·
      // inmuebles) flows to a second line instead of overflowing the card.
      const subLines = doc.splitTextToSize(c.sub, w - 24);
      doc.text(subLines, x + 12, cur.y + 56);
    }
    text(doc, INK);
  });
  cur.y += h + 26;
}

/** Título de sección numerado con chip de acento. */
export function sectionTitle(cur: Cursor, num: number, title: string, note?: string): void {
  ensureRoom(cur, note ? 58 : 44);
  const { doc } = cur;
  cur.y += 6;
  fill(doc, ACCENT);
  doc.roundedRect(M, cur.y - 9.5, 14, 14, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  text(doc, WHITE);
  doc.text(String(num), M + 7, cur.y + 0.5, { align: "center" });
  doc.setFontSize(11.5);
  text(doc, INK);
  doc.text(title, M + 22, cur.y + 1);
  cur.y += 9;
  stroke(doc, HAIR);
  doc.setLineWidth(0.75);
  doc.line(M, cur.y, RIGHT, cur.y);
  cur.y += 14;
  if (note) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    text(doc, MUTED);
    const lines = doc.splitTextToSize(note, CONTENT_W) as string[];
    for (const l of lines) {
      doc.text(l, M, cur.y);
      cur.y += 9.5;
    }
    text(doc, INK);
    cur.y += 4;
  }
}

export type Col = { label: string; x: number; align?: "right" };

/** Cabecera de tabla: etiquetas pequeñas en mayúsculas + regla. */
export function tableHead(cur: Cursor, cols: Col[]): void {
  const { doc } = cur;
  for (const c of cols) kicker(doc, c.label, c.x, cur.y, MUTED, c.align);
  cur.y += 5;
  stroke(doc, HAIR);
  doc.setLineWidth(0.75);
  doc.line(M, cur.y, RIGHT, cur.y);
  cur.y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
}

/** Banda zebra de una fila (llamar ANTES de escribir el texto de la fila).
 *  El rectángulo nace 10pt sobre la línea base del texto y crece hacia ABAJO
 *  rowH puntos — así una fila alta (con sublínea) nunca tapa a la anterior. */
export function zebra(cur: Cursor, index: number, rowH: number): void {
  if (index % 2 === 1) {
    fill(cur.doc, PANEL);
    cur.doc.rect(M - 4, cur.y - 10, CONTENT_W + 8, rowH, "F");
  }
}

/** Fila de total con regla superior. */
export function totalRule(cur: Cursor): void {
  stroke(cur.doc, [203, 213, 225]);
  cur.doc.setLineWidth(1);
  cur.doc.line(M, cur.y - 8, RIGHT, cur.y - 8);
}

/** Gráfico de barras horizontales con etiqueta y valor. */
export function hBars(
  cur: Cursor,
  rows: { label: string; value: number; color?: RGB; sub?: string }[],
  opts: { labelW?: number; valueFmt?: (n: number) => string } = {},
): void {
  const { doc } = cur;
  const labelW = opts.labelW ?? 130;
  const valueFmt = opts.valueFmt ?? fmtEur;
  const barX = M + labelW;
  const barMaxW = CONTENT_W - labelW - 86;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  for (const r of rows) {
    ensureRoom(cur, 22);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    text(doc, INK);
    doc.text(r.label.slice(0, 28), M, cur.y + 1);
    if (r.sub) {
      doc.setFontSize(6.5);
      text(doc, FAINT);
      doc.text(r.sub, M, cur.y + 9);
      text(doc, INK);
    }
    const w = Math.max(2, (Math.abs(r.value) / maxAbs) * barMaxW);
    fill(doc, r.color ?? (r.value >= 0 ? ACCENT : NEG));
    doc.roundedRect(barX, cur.y - 6, w, 9, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    text(doc, toneFor(r.value));
    doc.text(valueFmt(r.value), RIGHT, cur.y + 1, { align: "right" });
    text(doc, INK);
    cur.y += r.sub ? 22 : 17;
  }
}

/** Donut: arcos trazados como polilíneas gruesas (sin raster). */
export function donut(
  doc: jsPDF,
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  slices: { value: number; color: RGB }[],
): void {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return;
  const PAD = 0.03; // hueco entre porciones (radianes)
  let a = -Math.PI / 2;
  doc.setLineCap("butt");
  for (const s of slices) {
    const span = (s.value / total) * Math.PI * 2;
    const a0 = a + PAD / 2;
    const a1 = a + span - PAD / 2;
    a += span;
    if (a1 <= a0) continue;
    const steps = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 72));
    stroke(doc, s.color);
    doc.setLineWidth(thickness);
    let px = cx + radius * Math.cos(a0);
    let py = cy + radius * Math.sin(a0);
    const segs: [number, number][] = [];
    for (let i = 1; i <= steps; i++) {
      const ang = a0 + ((a1 - a0) * i) / steps;
      const nx = cx + radius * Math.cos(ang);
      const ny = cy + radius * Math.sin(ang);
      segs.push([nx - px, ny - py]);
      px = nx;
      py = ny;
    }
    doc.lines(segs, cx + radius * Math.cos(a0), cy + radius * Math.sin(a0), [1, 1], "S", false);
  }
  doc.setLineWidth(0.75);
}

/** Gráfico de área (evolución) con relleno translúcido y línea de acento. */
export function areaChart(
  cur: Cursor,
  w: number,
  h: number,
  points: { label: string; value: number }[],
): void {
  const { doc } = cur;
  if (points.length < 2) return;
  const x0 = M;
  const y0 = cur.y;
  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xAt = (i: number) => x0 + (i / (points.length - 1)) * w;
  const yAt = (v: number) => y0 + h - ((v - min) / span) * h;

  // Rejilla: tres reglas horizontales, sin valores — las cifras ya viven en
  // las tarjetas de resumen y el chart gana todo el ancho del contenido.
  stroke(doc, HAIR);
  doc.setLineWidth(0.5);
  for (const frac of [0, 0.5, 1]) {
    const gy = yAt(min + span * frac);
    doc.line(x0, gy, x0 + w, gy);
  }

  // Área rellena con opacidad (GState).
  type GStateCtor = new (opts: { opacity: number }) => unknown;
  // jsPDF expone GState en la instancia; los tipos publicados no lo recogen.
  const D = doc as unknown as {
    GState: GStateCtor;
    setGState: (g: unknown) => void;
    saveGraphicsState: () => void;
    restoreGraphicsState: () => void;
  };
  const poly: [number, number][] = [];
  let px = xAt(0);
  let py = yAt(values[0]);
  for (let i = 1; i < points.length; i++) {
    poly.push([xAt(i) - px, yAt(values[i]) - py]);
    px = xAt(i);
    py = yAt(values[i]);
  }
  D.saveGraphicsState();
  D.setGState(new D.GState({ opacity: 0.12 }));
  fill(doc, ACCENT);
  const closed = [...poly, [0, y0 + h - py] as [number, number], [xAt(0) - px, 0] as [number, number]];
  doc.lines(closed, xAt(0), yAt(values[0]), [1, 1], "F", true);
  D.restoreGraphicsState();

  // Línea principal.
  stroke(doc, ACCENT);
  doc.setLineWidth(1.4);
  doc.setLineCap("round");
  doc.lines(poly, xAt(0), yAt(values[0]), [1, 1], "S", false);
  doc.setLineWidth(0.75);

  // Etiquetas de fechas (primera y última).
  doc.setFontSize(6.5);
  text(doc, FAINT);
  doc.text(points[0].label, x0, y0 + h + 10);
  doc.text(points[points.length - 1].label, x0 + w, y0 + h + 10, { align: "right" });
  text(doc, INK);
  cur.y += h + 24;
}

/** Pies de página con numeración — llamar al FINAL, cuando ya existen todas. */
export function finishFooters(doc: jsPDF, leftText: string): void {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    stroke(doc, HAIR);
    doc.setLineWidth(0.5);
    doc.line(M, PAGE_H - 40, RIGHT, PAGE_H - 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    text(doc, FAINT);
    doc.text(leftText, M, PAGE_H - 28);
    doc.text(`Página ${i} de ${pages}`, RIGHT, PAGE_H - 28, { align: "right" });
    text(doc, INK);
  }
}

/** Etiquetas de tipos de activo para leyendas de gráficos — la fuente de
 *  verdad vive en lib/labels.ts; aquí solo el alias histórico del kit. */
export { ASSET_TYPE_LABELS };

export function assetTypeLabelPdf(type: string): string {
  return ASSET_TYPE_LABELS[type] ?? type;
}
