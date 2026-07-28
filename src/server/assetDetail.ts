// Agregador de lectura de la página de detalle de activo (/assets/[id]).
// Reúne en una sola llamada la serie de precio EUR (ventana de propiedad,
// retro-ajustada por splits), los marcadores de compra/venta, KPIs de
// posición, lotes FIFO abiertos, la estimación «si vendieras hoy» (previsión
// foral marginal) y el P&L realizado. Solo lecturas — cero mutaciones.

import { and, asc, eq, gt, lte } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  assetTransactions,
  assetValuations,
  fxRates,
  priceHistory,
  type Asset,
  type AssetPosition,
} from "../db/schema";
import { round, roundEur } from "../lib/money";
import { priceSymbolForAsset } from "../lib/price-sync";
import { toIsoDate } from "../lib/time";
import { getAssetPriceStatus, getAssetWithPositions, type AssetPriceStatus } from "./assets";
import { getCountryWeightingsForAsset } from "./countries";
import { listPositions } from "./positions";
import { getPeriodReturns, type PeriodReturns } from "./returns";
import { getSectorWeightingsForAsset, type AssetWeightings } from "./sectors";
import { backAdjustFactor, loadSplitEvents, type SplitEvent } from "./splitAdjust";
import { actualizationCoefficient } from "./tax/coeficientes";
import { estimateSavingsCuota, type TaxInterest } from "./tax/cuota";
import { getInterestForYearSync } from "./tax/interest";
import { getOpenLots, type OpenLotRow } from "./tax/openLots";
import { buildPrevision } from "./tax/prevision";
import { buildTaxReport, type SaleReportRow, type TaxReport } from "./tax/report";

export const ASSET_DETAIL_RANGES = ["1M", "3M", "6M", "1A", "MAX"] as const;
export type AssetDetailRange = (typeof ASSET_DETAIL_RANGES)[number];

export function parseAssetDetailRange(raw: string | undefined): AssetDetailRange {
  return (ASSET_DETAIL_RANGES as readonly string[]).includes(raw ?? "")
    ? (raw as AssetDetailRange)
    : "MAX";
}

export type AssetTradeMarker = {
  type: "buy" | "sell";
  /** Unidades operadas (en unidades de la fecha del trade, sin ajustar). */
  quantity: number;
  /** Precio unitario EUR del trade, retro-ajustado a unidades actuales. */
  unitPriceEur: number;
  /** False cuando el trade cayó en fecha sin valoración y se ancló al punto
   *  anterior más cercano de la serie. */
  exact: boolean;
};

export type AssetPricePoint = {
  date: string;
  /** Cierre EUR retro-ajustado a unidades post-split actuales. */
  unitPriceEur: number;
  /** Hasta dos marcadores (compra y/o venta) anclados a este punto. */
  markers?: AssetTradeMarker[];
  /** True en la cola de mercado: puntos derivados de price_history en fechas
   *  sin posición (activo vendido pero aún en seguimiento). Solo informativo
   *  para el detalle — nunca alimenta valoraciones ni cómputos agregados. */
  market?: boolean;
};

export type SellTodayEstimate = {
  year: number;
  proceedsEur: number;
  remainingBasisEur: number;
  /** Ganancia económica: proceeds − base restante histórica. */
  rawGainEur: number;
  /** Ganancia foral: por lote, proceeds − base × coeficiente art. 45.Dos. */
  foralGainEur: number;
  coefficientsAvailable: boolean;
  /** Impacto marginal en la cuota del ejercicio (negativo = ahorro). */
  cuotaDeltaEur: number;
  netIfSoldEur: number;
};

export type RealizedSummary = {
  sales: SaleReportRow[];
  totalRawEur: number;
  totalComputableEur: number;
};

export type DividendSummary = {
  count: number;
  grossEur: number;
  netEur: number;
  withholdingEur: number;
};

export type AssetDetail = {
  asset: Asset;
  position: AssetPosition | null;
  state: "open" | "closed" | "untraded";
  priceStatus: AssetPriceStatus;
  lastPrice: { unitPriceEur: number; date: string } | null;
  averageCostEur: number | null;
  marketValueEur: number | null;
  latentPnl: { eur: number; pct: number } | null;
  portfolioWeight: number | null;
  periodReturns: PeriodReturns;
  series: AssetPricePoint[];
  openLots: OpenLotRow[];
  sellToday: SellTodayEstimate | null;
  realized: RealizedSummary | null;
  sectors: AssetWeightings;
  regions: AssetWeightings;
  dividends: DividendSummary | null;
};

const EPS = 1e-9;
const EMPTY_RETURNS: PeriodReturns = { "1m": null, "3m": null, "6m": null, ytd: null, "1y": null };

const RANGE_MONTHS: Record<Exclude<AssetDetailRange, "MAX">, number> = {
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "1A": 12,
};

function rangeCutoffIso(range: AssetDetailRange, todayIso: string): string | null {
  if (range === "MAX") return null;
  const [y, m, d] = todayIso.split("-").map(Number);
  return toIsoDate(new Date(Date.UTC(y, m - 1 - RANGE_MONTHS[range], d)));
}

/** Serie EUR retro-ajustada (misma convención que returns.ts / sparklines). */
export function buildAdjustedSeries(
  rows: { valuationDate: string; unitPriceEur: number }[],
  splits: SplitEvent[] | undefined,
): AssetPricePoint[] {
  return rows.map((r) => ({
    date: r.valuationDate,
    unitPriceEur: r.unitPriceEur * backAdjustFactor(splits, r.valuationDate),
  }));
}

type TradeForMarker = {
  transactionType: string;
  tradedAt: number;
  quantity: number;
  tradeGrossAmountEur: number;
};

/** Ancla cada compra/venta a un punto de la serie: fecha exacta si existe,
 *  si no el último punto anterior (`exact: false`). Colapsa por punto y tipo
 *  para que un mismo día con varias órdenes pinte un solo triángulo. */
export function attachMarkers(
  series: AssetPricePoint[],
  trades: TradeForMarker[],
  splits: SplitEvent[] | undefined,
): AssetPricePoint[] {
  if (series.length === 0) return series;
  type Bucket = { qty: number; grossEur: number; exact: boolean };
  // key: `${index}:${type}`
  const buckets = new Map<string, Bucket>();

  for (const t of trades) {
    if (t.transactionType !== "buy" && t.transactionType !== "sell") continue;
    if (!(t.quantity > 0)) continue;
    const iso = toIsoDate(new Date(t.tradedAt));
    // Último punto ≤ fecha del trade (serie asc). Un trade anterior al primer
    // punto (no debería: las valoraciones nacen con la primera compra) se
    // ancla defensivamente al primero.
    let lo = 0;
    let hi = series.length - 1;
    let idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].date <= iso) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const exact = series[idx].date === iso;
    const factor = backAdjustFactor(splits, iso);
    const key = `${idx}:${t.transactionType}`;
    const bucket = buckets.get(key) ?? { qty: 0, grossEur: 0, exact: true };
    bucket.qty += t.quantity;
    bucket.grossEur += t.tradeGrossAmountEur * factor;
    bucket.exact = bucket.exact && exact;
    buckets.set(key, bucket);
  }
  if (buckets.size === 0) return series;

  const out = series.map((p) => ({ ...p }));
  for (const [key, b] of buckets) {
    const [idxStr, type] = key.split(":");
    const idx = Number(idxStr);
    const marker: AssetTradeMarker = {
      type: type as "buy" | "sell",
      quantity: b.qty,
      // Media ponderada del precio EUR del trade retro-ajustado: cada gross
      // se multiplicó por su factor, así que gross_aj / qty = (gross/qty)×f.
      unitPriceEur: b.qty > 0 ? b.grossEur / b.qty : 0,
      exact: b.exact,
    };
    const target = out[idx];
    target.markers = [...(target.markers ?? []), marker];
  }
  // Compra antes que venta cuando coinciden en el punto.
  for (const p of out) {
    if (p.markers && p.markers.length > 1) {
      p.markers.sort((a, b) => (a.type === b.type ? 0 : a.type === "buy" ? -1 : 1));
    }
  }
  return out;
}

/** Cola de mercado: puntos EUR desde price_history para fechas posteriores a
 *  la última valoración con posición. Un activo `isActive` sigue cotizando en
 *  el cron aunque su posición esté cerrada; esta cola hace visible ese
 *  seguimiento en el detalle sin escribir valoraciones (que solo existen con
 *  qty>0) ni afectar a ningún otro cómputo. Conversión EUR con la curva
 *  fx_rates por asset.currency y carry-forward — misma convención que
 *  `rebuildValuationsForAsset`. */
async function loadMarketTail(
  db: DB,
  asset: Asset,
  afterIso: string | null,
  todayIso: string,
  splits: SplitEvent[] | undefined,
): Promise<AssetPricePoint[]> {
  const symbol = priceSymbolForAsset(asset);
  if (!symbol) return [];

  const priceRows = await db
    .select({ date: priceHistory.pricedDateUtc, price: priceHistory.price })
    .from(priceHistory)
    .where(
      and(
        eq(priceHistory.symbol, symbol),
        afterIso ? gt(priceHistory.pricedDateUtc, afterIso) : undefined,
        lte(priceHistory.pricedDateUtc, todayIso),
      ),
    )
    .orderBy(asc(priceHistory.pricedDateUtc))
    .all();
  if (priceRows.length === 0) return [];

  const currency = (asset.currency ?? "EUR").toUpperCase();
  const fxCurve =
    currency === "EUR"
      ? null
      : await db
          .select({ date: fxRates.date, rateToEur: fxRates.rateToEur })
          .from(fxRates)
          .where(eq(fxRates.currency, currency))
          .orderBy(asc(fxRates.date))
          .all();

  const out: AssetPricePoint[] = [];
  let fxIdx = 0;
  let lastFx: number | null = currency === "EUR" ? 1 : null;
  for (const row of priceRows) {
    if (fxCurve) {
      while (fxIdx < fxCurve.length && fxCurve[fxIdx].date <= row.date) {
        lastFx = fxCurve[fxIdx].rateToEur;
        fxIdx++;
      }
    }
    if (lastFx == null) continue;
    out.push({
      date: row.date,
      unitPriceEur: round(row.price * lastFx, 6) * backAdjustFactor(splits, row.date),
      market: true,
    });
  }
  return out;
}

/** Estimación pura «si vendieras hoy»: ganancia foral por lote (coeficientes
 *  art. 45.Dos sobre la base restante) y cuota marginal contra la previsión
 *  real del ejercicio. */
export function estimateSellToday(input: {
  year: number;
  quantity: number;
  unitPriceEur: number;
  openLots: OpenLotRow[];
  report: TaxReport;
  interest: TaxInterest;
}): SellTodayEstimate {
  const { year, quantity, unitPriceEur, openLots, report, interest } = input;
  const coefficientsAvailable = actualizationCoefficient(year, year) != null;

  const proceedsEur = roundEur(quantity * unitPriceEur);
  let remainingBasisEur = 0;
  let foralGainEur = 0;
  for (const lot of openLots) {
    const lotProceeds = lot.remainingQty * unitPriceEur;
    const acqYear = new Date(lot.acquiredAt).getUTCFullYear();
    // Sin tabla publicada: coef 1 con aviso visible — misma convención que
    // buildPrevision, nunca silencioso.
    const coef = actualizationCoefficient(year, acqYear) ?? 1;
    remainingBasisEur += lot.remainingCostEur;
    foralGainEur += lotProceeds - roundEur(lot.remainingCostEur * coef);
  }
  remainingBasisEur = roundEur(remainingBasisEur);
  foralGainEur = roundEur(foralGainEur);
  const rawGainEur = roundEur(proceedsEur - remainingBasisEur);

  const prevision = buildPrevision(report, interest);
  const cuotaWith = estimateSavingsCuota(
    {
      year,
      dividends: report.dividends,
      totals: {
        netComputableEur: prevision.saldoGananciasForalEur + foralGainEur,
        dividendsGrossEur: report.totals.dividendsGrossEur,
        withholdingDestinoTotalEur: report.totals.withholdingDestinoTotalEur,
      },
    },
    interest,
  );
  const cuotaDeltaEur = roundEur(
    cuotaWith.resultadoEstimadoEur - prevision.cuota.resultadoEstimadoEur,
  );

  return {
    year,
    proceedsEur,
    remainingBasisEur,
    rawGainEur,
    foralGainEur,
    coefficientsAvailable,
    cuotaDeltaEur,
    netIfSoldEur: roundEur(proceedsEur - Math.max(0, cuotaDeltaEur)),
  };
}

export async function getAssetDetail(
  assetId: string,
  range: AssetDetailRange,
  db: DB = defaultDb,
  todayIso: string = toIsoDate(new Date()),
): Promise<AssetDetail | null> {
  const found = await getAssetWithPositions(assetId, db);
  if (!found) return null;
  const { asset, position } = found;

  const [valuationRows, txRows, openLots, allPositions, returnsMap, priceStatus, sectors, regions] =
    await Promise.all([
      db
        .select({
          valuationDate: assetValuations.valuationDate,
          unitPriceEur: assetValuations.unitPriceEur,
        })
        .from(assetValuations)
        // qty>0: el motor de rebuild nunca escribe filas sin posición; las
        // qty=0 que existan son legacy del cron pre-2026-07 y aquí pintarían
        // como «en cartera» un tramo que ya no lo estaba.
        .where(and(eq(assetValuations.assetId, assetId), gt(assetValuations.quantity, 0)))
        .orderBy(asc(assetValuations.valuationDate))
        .all(),
      db
        .select({
          transactionType: assetTransactions.transactionType,
          tradedAt: assetTransactions.tradedAt,
          quantity: assetTransactions.quantity,
          tradeGrossAmountEur: assetTransactions.tradeGrossAmountEur,
          cashImpactEur: assetTransactions.cashImpactEur,
          withholdingTax: assetTransactions.withholdingTax,
        })
        .from(assetTransactions)
        .where(eq(assetTransactions.assetId, assetId))
        .orderBy(asc(assetTransactions.tradedAt))
        .all(),
      getOpenLots(assetId, db),
      listPositions(db),
      getPeriodReturns([assetId], db, todayIso),
      getAssetPriceStatus(asset, position, db),
      getSectorWeightingsForAsset(assetId, db),
      getCountryWeightingsForAsset(assetId, db),
    ]);

  const hasTrades = txRows.some((t) => t.transactionType !== "dividend");
  const quantity = position?.quantity ?? 0;
  const state: AssetDetail["state"] = !hasTrades ? "untraded" : quantity > EPS ? "open" : "closed";

  // Serie completa ajustada + marcadores; el filtro de rango va al final para
  // que el ancla «último punto ≤ fecha» no dependa de la ventana visible.
  const splits = loadSplitEvents(db, [assetId]).get(assetId);
  const marketTail = await loadMarketTail(
    db,
    asset,
    valuationRows.at(-1)?.valuationDate ?? null,
    todayIso,
    splits,
  );
  const fullSeries = attachMarkers(
    [...buildAdjustedSeries(valuationRows, splits), ...marketTail],
    txRows,
    splits,
  );
  const cutoff = rangeCutoffIso(range, todayIso);
  const series = cutoff ? fullSeries.filter((p) => p.date >= cutoff) : fullSeries;

  // KPIs de posición (misma semántica que listPositions/statement).
  const positionRow = allPositions.find((r) => r.position.assetId === assetId) ?? null;
  let lastPrice = positionRow?.valuation
    ? {
        unitPriceEur: positionRow.valuation.unitPriceEur,
        date: positionRow.valuation.valuationDate,
      }
    : null;
  // Con cola de mercado más fresca que la última valoración (posición cerrada
  // pero activo en seguimiento), el «último precio» es el de mercado. El
  // factor de retro-ajuste de hoy es 1, así que el valor está en unidades
  // actuales igual que el de la valoración.
  const lastMarket = marketTail.at(-1);
  if (lastMarket && (!lastPrice || lastMarket.date > lastPrice.date)) {
    lastPrice = { unitPriceEur: lastMarket.unitPriceEur, date: lastMarket.date };
  }
  const marketValueEur = state === "open" ? (positionRow?.valuationEur ?? null) : null;
  const averageCostEur =
    state === "open" && position && quantity > EPS ? position.totalCostEur / quantity : null;
  const latentPnl =
    state === "open" && position && marketValueEur != null && position.totalCostEur > 0
      ? {
          eur: marketValueEur - position.totalCostEur,
          pct: (marketValueEur - position.totalCostEur) / position.totalCostEur,
        }
      : null;
  const totalPortfolioEur = allPositions
    .filter((r) => r.position.quantity > EPS)
    .reduce((s, r) => s + r.marketOrCostEur, 0);
  const portfolioWeight =
    state === "open" && positionRow && totalPortfolioEur > 0
      ? positionRow.marketOrCostEur / totalPortfolioEur
      : null;

  // Informes fiscales por año, construidos una sola vez y compartidos entre
  // «si vendieras hoy» (año actual) y el P&L realizado (años con ventas).
  const reportCache = new Map<number, TaxReport>();
  const reportForYear = (year: number): TaxReport => {
    let r = reportCache.get(year);
    if (!r) {
      r = buildTaxReport(db, year);
      reportCache.set(year, r);
    }
    return r;
  };

  // «Si vendieras hoy» — solo posición abierta con precio de mercado y lotes.
  let sellToday: SellTodayEstimate | null = null;
  const currentYear = Number(todayIso.slice(0, 4));
  if (state === "open" && lastPrice && marketValueEur != null && openLots.length > 0) {
    sellToday = estimateSellToday({
      year: currentYear,
      quantity,
      unitPriceEur: lastPrice.unitPriceEur,
      openLots,
      report: reportForYear(currentYear),
      interest: getInterestForYearSync(currentYear, db),
    });
  }

  // P&L realizado: informe fiscal de cada año con ventas, filtrado al activo —
  // reutiliza permuta/antiaplicación/dust del motor en vez de recalcular.
  const saleYears = [
    ...new Set(
      txRows
        .filter((t) => t.transactionType === "sell")
        .map((t) => new Date(t.tradedAt).getUTCFullYear()),
    ),
  ].sort();
  let realized: RealizedSummary | null = null;
  if (saleYears.length > 0) {
    const sales: SaleReportRow[] = [];
    for (const year of saleYears) {
      sales.push(...reportForYear(year).sales.filter((s) => s.assetId === assetId));
    }
    if (sales.length > 0) {
      realized = {
        sales,
        totalRawEur: roundEur(sales.reduce((s, r) => s + r.rawGainLossEur, 0)),
        totalComputableEur: roundEur(sales.reduce((s, r) => s + r.computableGainLossEur, 0)),
      };
    }
  }

  // Dividendos cobrados del activo — convención EUR del informe fiscal:
  // bruto = tradeGrossAmountEur, neto = cashImpactEur, retención = withholdingTax.
  const divRows = txRows.filter((t) => t.transactionType === "dividend");
  const dividends: DividendSummary | null =
    divRows.length > 0
      ? {
          count: divRows.length,
          grossEur: roundEur(divRows.reduce((s, d) => s + d.tradeGrossAmountEur, 0)),
          netEur: roundEur(divRows.reduce((s, d) => s + d.cashImpactEur, 0)),
          withholdingEur: roundEur(divRows.reduce((s, d) => s + (d.withholdingTax ?? 0), 0)),
        }
      : null;

  return {
    asset,
    position,
    state,
    priceStatus,
    lastPrice,
    averageCostEur,
    marketValueEur,
    latentPnl,
    portfolioWeight,
    periodReturns: returnsMap.get(assetId) ?? { ...EMPTY_RETURNS },
    series,
    openLots,
    sellToday,
    realized,
    sectors,
    regions,
    dividends,
  };
}
