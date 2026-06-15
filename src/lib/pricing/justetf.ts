// JustETF client (composición geográfica por ISIN). Aislado aquí por la misma
// disciplina que el cliente de Yahoo: ninguna acción ni componente llama a
// JustETF directamente, y los tests stubean este módulo — sin red real.
//
// La vista de perfil renderiza solo el top de países + una fila «Other» en el
// HTML estático. El desglose COMPLETO está tras un enlace «Show more» que es un
// callback AJAX de Wicket: hacemos GET (para cookies + la URL de versión de
// página), luego POST a `loadMoreCountries`, y parseamos la tabla expandida.
// Si el POST falla, caemos a la lista truncada del GET.

import { withTimeout } from "./_net";
import { normalizeCountryKey } from "../countries";
import type { CountryWeight } from "./types";

const ORIGIN = "https://www.justetf.com";
const PROFILE_PATH = "/en/etf-profile.html?isin=";

// JustETF responde 403 a clientes sin User-Agent de navegador.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NAME_RE = /tl_etf-holdings_countries_value_name">([^<]+)<\/td>/g;
const PCT_RE = /tl_etf-holdings_countries_value_percentage">\s*([\d.,]+)\s*%/g;
// Wicket callback URL del «Show more» de países, embebida en el HTML.
const LOAD_MORE_RE =
  /\/en\/etf-profile\.html\?[0-9.\-]*-holdingsSection-countries-loadMoreCountries&isin=[^"&]+&_wicket=1/;

function baseHeaders(): Record<string, string> {
  return { "user-agent": BROWSER_UA, "accept-language": "en;q=0.9" };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Parse the country breakdown out of a JustETF profile page (or a Wicket
 *  AJAX partial). Names and percentages each carry a stable `data-testid`, so
 *  we collect them in document order and zip. Duplicate keys (e.g. anything
 *  normalising to `other`) are merged. Returns fractions 0..1. */
export function parseCountryWeightings(html: string): CountryWeight[] {
  const names = [...html.matchAll(NAME_RE)].map((m) => m[1]);
  const pcts = [...html.matchAll(PCT_RE)].map((m) => m[1]);
  const n = Math.min(names.length, pcts.length);
  const merged = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const weight = Number.parseFloat(pcts[i].replace(",", ".")) / 100;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const country = normalizeCountryKey(decodeEntities(names[i].trim()));
    if (!country) continue;
    merged.set(country, (merged.get(country) ?? 0) + weight);
  }
  return [...merged.entries()].map(([country, weight]) => ({ country, weight }));
}

/** Expand the truncated top-N list to the full country breakdown via the
 *  Wicket `loadMoreCountries` callback. Returns the full list when the partial
 *  re-renders the whole table (detected by the top country reappearing), the
 *  union when it returns only the extra rows, or the truncated list on any
 *  failure. */
async function expandFullList(
  isin: string,
  html: string,
  cookieHeader: string,
  top: CountryWeight[],
): Promise<CountryWeight[]> {
  const match = html.match(LOAD_MORE_RE);
  if (!match || !cookieHeader) return top;
  const res = await fetch(`${ORIGIN}${match[0]}`, {
    method: "POST",
    headers: {
      ...baseHeaders(),
      cookie: cookieHeader,
      "wicket-ajax": "true",
      "wicket-ajax-baseurl": `en/etf-profile.html?isin=${encodeURIComponent(isin)}`,
      "x-requested-with": "XMLHttpRequest",
    },
  });
  if (!res.ok) return top;
  const expanded = parseCountryWeightings(await res.text());
  if (expanded.length === 0) return top;
  const topCountry = top[0]?.country;
  // Wicket usually re-renders the whole table: if the top country is present,
  // the partial IS the full list.
  if (topCountry && expanded.some((r) => r.country === topCountry)) {
    return expanded;
  }
  // Otherwise it returned only the extra rows — union them onto the top list.
  const byCountry = new Map(top.map((r) => [r.country, r.weight]));
  for (const r of expanded) byCountry.set(r.country, r.weight);
  return [...byCountry.entries()].map(([country, weight]) => ({
    country,
    weight,
  }));
}

async function load(isin: string): Promise<CountryWeight[]> {
  const res = await fetch(`${ORIGIN}${PROFILE_PATH}${encodeURIComponent(isin)}`, {
    headers: baseHeaders(),
  });
  if (!res.ok) throw new Error(`justetf ${isin}: HTTP ${res.status}`);
  const html = await res.text();
  const top = parseCountryWeightings(html);
  const cookieHeader = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  try {
    return await expandFullList(isin, html, cookieHeader, top);
  } catch {
    // Any hiccup expanding the list → fall back to the truncated top-N.
    return top;
  }
}

export async function fetchCountryWeightings(
  isin: string,
): Promise<CountryWeight[]> {
  return withTimeout(load(isin), undefined, `justetf countries ${isin}`);
}
