# Mejoras financial-hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TradingView como fallback dormido de Yahoo para acciones/ETFs, logos de activos vía CDN de TV, desglose por activo con rentabilidades por ventana en el Extracto web, y badge de frescura de precios.

**Architecture:** Un cliente TradingView nuevo bajo `src/lib/pricing/` (scanner batch, sin histórico) se invoca solo cuando Yahoo falla; dos columnas nuevas en `assets` (`tradingview_symbol`, `logo_url`) se rellenan una vez con un script de backfill; las rentabilidades por ventana se calculan on-read desde `asset_valuations` (serie EUR canónica); el Extracto gana una tabla de desglose y un badge de frescura.

**Tech Stack:** Next 16 (App Router, Server Components), Drizzle + better-sqlite3, Zod, Vitest (red stubbeada), Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-08-financial-hub-mejoras-design.md`

## Global Constraints

- TypeScript strict; sin `any` sin comentario justificativo de una línea.
- Sin SQL crudo en código de app; Drizzle query builder. Migraciones solo generadas (`pnpm db:generate`), nunca editar migraciones pasadas.
- ULID para ids nuevos. Dinero en EUR dentro de `<SensitiveValue>` siempre.
- Proveedores de mercado solo bajo `src/lib/pricing/`; tests stubbean la red (cero llamadas reales en `pnpm test`).
- Mutaciones = Server Action con Zod + transacción + `audit_events` + `revalidatePath` + resultado discriminado.
- UI: primitivos existentes (`Button`, `Modal`, `DataTable`, `Badge`, `StatesBlock`); Tailwind con tokens del tema; verificar dark y light.
- UI en español; valores de enum/BD en inglés con mapas de etiquetas.
- Al usuario se le llama **Commander** en la comunicación, no en la UI.
- Definition of Done del CLAUDE.md aplica al cierre: typecheck, lint, test, build, migración generada, dark/light, smoke con BD vacía.

---

### Task 1: Columnas `tradingview_symbol` + `logo_url` y su cableado Zod/acciones

**Files:**
- Modify: `src/db/schema/assets.ts`
- Modify: `src/lib/domain.ts:28`
- Modify: `src/actions/createAsset.schema.ts`
- Modify: `src/actions/updateAsset.schema.ts`
- Modify: `src/actions/createAsset.ts` (bloque `.values({...})`)
- Modify: `src/actions/updateAsset.ts:40-47` (bloque de patch)
- Modify: `src/components/features/assets/EditAssetModal.tsx` (dos `Field` nuevos)
- Create: `drizzle/0029_*.sql` (generada, no a mano)
- Test: `src/actions/__tests__/asset-schemas.test.ts` (nuevo; si ya existe un test de schemas de asset, añadir allí)

**Interfaces:**
- Consumes: nada previo.
- Produces: `assets.tradingviewSymbol: string | null`, `assets.logoUrl: string | null` (en `Asset` = `typeof assets.$inferSelect`); `PRICE_SOURCES = ["yahoo","coingecko","ft","tradingview"]`; `createAssetSchema`/`updateAssetSchema` aceptan `tradingviewSymbol`, `logoUrl` y (update) `priceSource`.

- [ ] **Step 1: Test que falla — schemas aceptan los campos nuevos**

```ts
// src/actions/__tests__/asset-schemas.test.ts
import { describe, expect, it } from "vitest";
import { createAssetSchema } from "../createAsset.schema";
import { updateAssetSchema } from "../updateAsset.schema";

describe("asset schemas: tradingview + logo", () => {
  it("createAssetSchema acepta priceSource tradingview y los campos nuevos", () => {
    const parsed = createAssetSchema.safeParse({
      name: "Vanguard FTSE All-World",
      symbol: "VWCE",
      assetType: "etf",
      currency: "EUR",
      priceSource: "tradingview",
      tradingviewSymbol: "XETR:VWCE",
      logoUrl: "https://s3-symbol-logo.tradingview.com/vanguard.svg",
    });
    expect(parsed.success).toBe(true);
  });

  it("updateAssetSchema acepta patch de tradingviewSymbol/logoUrl/priceSource", () => {
    const parsed = updateAssetSchema.safeParse({
      id: "ast_1",
      tradingviewSymbol: "BME:AMP",
      logoUrl: null,
      priceSource: "tradingview",
    });
    expect(parsed.success).toBe(true);
  });

  it("logoUrl inválida se rechaza", () => {
    const parsed = updateAssetSchema.safeParse({ id: "ast_1", logoUrl: "no-es-url" });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test -- asset-schemas`
Expected: FAIL (campos desconocidos / enum sin "tradingview").

- [ ] **Step 3: Implementación**

En `src/db/schema/assets.ts`, tras `priceSource` (línea 21):

```ts
    /** Símbolo en la simbología de TradingView (`EXCHANGE:TICKER`, p. ej.
     *  "BME:AMP", "XETR:VWCE"), distinta de la de Yahoo. Lo rellena
     *  `pnpm backfill:tv`; lo usa el fallback del sync cuando Yahoo falla. */
    tradingviewSymbol: text("tradingview_symbol"),
    /** URL absoluta del logo (CDN de TradingView o thumb de CoinGecko). El
     *  navegador la carga directamente; null ⇒ la UI cae a iniciales. */
    logoUrl: text("logo_url"),
```

En `src/lib/domain.ts:28`:

```ts
export const PRICE_SOURCES = ["yahoo", "coingecko", "ft", "tradingview"] as const;
```

En `src/actions/createAsset.schema.ts`, tras `providerSymbol` (línea 29):

```ts
  tradingviewSymbol: z.string().trim().max(64).nullable().optional(),
  logoUrl: z.string().trim().url("URL de logo inválida").max(300).nullable().optional(),
```

En `src/actions/updateAsset.schema.ts`, tras `providerSymbol` (línea 23) — añadir también el import `PRICE_SOURCES` desde `../lib/domain`:

```ts
  tradingviewSymbol: z.string().trim().max(64).nullable().optional(),
  logoUrl: z.string().trim().url("URL de logo inválida").max(300).nullable().optional(),
  priceSource: z.enum(PRICE_SOURCES).nullable().optional(),
```

En `src/actions/createAsset.ts` dentro del `.values({...})` (junto a `providerSymbol`, línea ~49):

```ts
          tradingviewSymbol: data.tradingviewSymbol ?? null,
          logoUrl: data.logoUrl ?? null,
```

En `src/actions/updateAsset.ts` en el bloque de patch (tras la línea 45 de `providerSymbol`):

```ts
      if (patch.tradingviewSymbol !== undefined) next.tradingviewSymbol = patch.tradingviewSymbol;
      if (patch.logoUrl !== undefined) next.logoUrl = patch.logoUrl;
      if (patch.priceSource !== undefined) next.priceSource = patch.priceSource;
```

En `src/components/features/assets/EditAssetModal.tsx`: añadir al estado del formulario `tradingviewSymbol: a.tradingviewSymbol ?? ""` y `logoUrl: a.logoUrl ?? ""`, al submit `tradingviewSymbol: form.tradingviewSymbol.trim() ? form.tradingviewSymbol.trim() : null` (ídem `logoUrl`), y dos `Field` nuevos junto al de «Símbolo proveedor», siguiendo exactamente el patrón de input existente:

```tsx
        <Field label="Símbolo TradingView" errors={fieldErrors.tradingviewSymbol}>
          <input
            value={form.tradingviewSymbol}
            onChange={(e) => setForm({ ...form, tradingviewSymbol: e.target.value })}
            placeholder="BME:AMP"
            className={inputClass}
          />
        </Field>
        <Field label="URL del logo" errors={fieldErrors.logoUrl}>
          <input
            value={form.logoUrl}
            onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
            placeholder="https://s3-symbol-logo.tradingview.com/…"
            className={inputClass}
          />
        </Field>
```

- [ ] **Step 4: Generar la migración**

Run: `pnpm db:generate`
Expected: nueva `drizzle/0029_*.sql` con dos `ALTER TABLE assets ADD COLUMN`. Revisarla; no editarla.

- [ ] **Step 5: Migrar la BD de dev y correr tests**

Run: `pnpm db:backup && pnpm db:migrate && pnpm test -- asset-schemas && pnpm typecheck`
Expected: PASS, cero errores de tipos.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(assets): columnas tradingviewSymbol y logoUrl + cableado Zod/acciones"
```

---

### Task 2: Cliente TradingView bajo `src/lib/pricing/`

**Files:**
- Create: `src/lib/pricing/tradingview.ts`
- Modify: `src/lib/pricing/index.ts`
- Test: `src/lib/pricing/tradingview.test.ts`

**Interfaces:**
- Consumes: `withTimeout` de `./_net`, tipos `Quote`/`HistoricalBar` de `./types`.
- Produces:
  - `fetchQuotes(symbols: string[]): Promise<Quote[]>` — un POST batch al scanner; símbolos desconocidos se omiten.
  - `fetchQuote(symbol: string): Promise<Quote>` — lanza si el scanner no lo devuelve.
  - `fetchHistory(symbol, from, to)` — rechaza siempre (`tradingview: history unsupported`).
  - `searchSymbols(query: string): Promise<TvSearchHit[]>` con `TvSearchHit = { symbol: string; exchange: string; currency: string | null; type: string; logoid: string | null }`.
  - En `index.ts`: `PricingProviderName` gana `"tradingview"`, export `tradingviewProvider: PricingProvider`, y `providerForAsset` lo devuelve para `priceSource === "tradingview"`.

- [ ] **Step 1: Test que falla**

```ts
// src/lib/pricing/tradingview.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQuote, fetchQuotes, fetchHistory, searchSymbols } from "./tradingview";

function stubFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("tradingview.fetchQuotes", () => {
  it("parsea el batch del scanner y omite filas sin precio/divisa", async () => {
    stubFetch({
      totalCount: 3,
      data: [
        { s: "BME:AMP", d: [0.2075, "EUR"] },
        { s: "NYSE:UNH", d: [425.255, "USD"] },
        { s: "XETR:MUERTO", d: [null, "EUR"] },
      ],
    });
    const quotes = await fetchQuotes(["BME:AMP", "NYSE:UNH", "XETR:MUERTO"]);
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({ symbol: "BME:AMP", price: 0.2075, currency: "EUR" });
    expect(quotes[1]).toMatchObject({ symbol: "NYSE:UNH", price: 425.255, currency: "USD" });
    expect(quotes[0].asOf).toBeInstanceOf(Date);
  });

  it("deduplica y devuelve [] con entrada vacía sin tocar la red", async () => {
    const fn = stubFetch({ data: [] });
    expect(await fetchQuotes([])).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("HTTP no-ok lanza", async () => {
    stubFetch({}, false, 429);
    await expect(fetchQuotes(["BME:AMP"])).rejects.toThrow(/429/);
  });
});

describe("tradingview.fetchQuote", () => {
  it("lanza si el scanner no conoce el símbolo", async () => {
    stubFetch({ data: [] });
    await expect(fetchQuote("BME:NOEXISTE")).rejects.toThrow(/no quote/);
  });
});

describe("tradingview.fetchHistory", () => {
  it("rechaza siempre — TV no da histórico", async () => {
    await expect(fetchHistory("BME:AMP", new Date(), new Date())).rejects.toThrow(
      /history unsupported/,
    );
  });
});

describe("tradingview.searchSymbols", () => {
  it("parsea candidatos y limpia el <em> del highlight", async () => {
    stubFetch({
      symbols: [
        { symbol: "<em>VWCE</em>", exchange: "XETR", currency_code: "EUR", type: "fund", logoid: "vanguard" },
        { symbol: "VWRA", exchange: "LSE", currency_code: "USD", type: "fund" },
      ],
    });
    const hits = await searchSymbols("IE00BK5BQT80");
    expect(hits[0]).toEqual({
      symbol: "VWCE", exchange: "XETR", currency: "EUR", type: "fund", logoid: "vanguard",
    });
    expect(hits[1].logoid).toBeNull();
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test -- pricing/tradingview`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementación**

```ts
// src/lib/pricing/tradingview.ts
// TradingView client — batch snapshot quotes via the public scanner endpoint
// plus symbol-search (used by the backfill script to resolve `EXCHANGE:TICKER`
// listings and logo ids). Fallback lane only: the daily sync and the watchlist
// call this ONLY after Yahoo failed for an equity/ETF, so a healthy day makes
// zero requests here. No history endpoint exists — backfills stay on Yahoo/FT.
//
// Same isolation discipline as the other pricing clients: no action/component
// calls TradingView directly, and tests stub `fetch` — no real network.

import { withTimeout } from "./_net";
import type { HistoricalBar, Quote } from "./types";

const SCAN_URL = "https://scanner.tradingview.com/global/scan";
const SEARCH_URL = "https://symbol-search.tradingview.com/symbol_search/v3/";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type ScanRow = { s?: string; d?: [number | null, string | null] };

/** Batched snapshot: one scanner request for many `EXCHANGE:TICKER` symbols
 *  across markets. Symbols the scanner doesn't serve are simply absent from
 *  the response — the batch never fails because of one dead listing. */
export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const unique = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const run = fetch(SCAN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": BROWSER_UA },
    body: JSON.stringify({ symbols: { tickers: unique }, columns: ["close", "currency"] }),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`tradingview scan HTTP ${res.status}`);
    return (await res.json()) as { data?: ScanRow[] };
  });
  const raw = await withTimeout(run, undefined, `tradingview scan ${unique.length}`);
  // The scanner returns last-trade snapshots without a timestamp column we
  // trust across markets; the fetch moment is the honest asOf for a fallback.
  const asOf = new Date();
  const out: Quote[] = [];
  for (const row of raw.data ?? []) {
    const close = row.d?.[0];
    const currency = row.d?.[1];
    if (!row.s || close == null || !Number.isFinite(close) || close <= 0) continue;
    if (!currency || !/^[A-Za-z]{3}$/.test(currency)) continue;
    out.push({ symbol: row.s, price: close, currency: currency.toUpperCase(), asOf });
  }
  return out;
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  const wanted = symbol.trim().toUpperCase();
  const hit = (await fetchQuotes([symbol])).find((q) => q.symbol.toUpperCase() === wanted);
  if (!hit) throw new Error(`tradingview: no quote for ${symbol}`);
  return hit;
}

/** TV expone snapshot, no series. Mantiene la firma de PricingProvider. */
export async function fetchHistory(
  symbol: string,
  _from: Date,
  _to: Date,
): Promise<HistoricalBar[]> {
  throw new Error(`tradingview: history unsupported (${symbol})`);
}

export type TvSearchHit = {
  symbol: string;
  exchange: string;
  currency: string | null;
  type: string;
  logoid: string | null;
};

type SearchRow = {
  symbol?: string;
  exchange?: string;
  currency_code?: string;
  type?: string;
  logoid?: string;
};

/** Symbol search por ISIN o ticker. Devuelve candidatos crudos en el orden de
 *  TV; el llamador (backfill) reordena y valida contra el scanner. */
export async function searchSymbols(query: string): Promise<TvSearchHit[]> {
  const url = `${SEARCH_URL}?text=${encodeURIComponent(query)}&hl=0&lang=en&search_type=undefined&domain=production`;
  const run = fetch(url, {
    headers: {
      "user-agent": BROWSER_UA,
      origin: "https://www.tradingview.com",
      referer: "https://www.tradingview.com/",
    },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`tradingview search HTTP ${res.status}`);
    return (await res.json()) as { symbols?: SearchRow[] };
  });
  const raw = await withTimeout(run, undefined, `tradingview search ${query}`);
  return (raw.symbols ?? [])
    .filter((r): r is SearchRow & { symbol: string; exchange: string } => !!r.symbol && !!r.exchange)
    .map((r) => ({
      symbol: r.symbol.replace(/<\/?em>/g, ""),
      exchange: r.exchange,
      currency: r.currency_code ?? null,
      type: r.type ?? "",
      logoid: r.logoid ?? null,
    }));
}
```

En `src/lib/pricing/index.ts`:

```ts
import * as tradingview from "./tradingview";           // junto a los demás imports

export type PricingProviderName = "yahoo" | "coingecko" | "ft" | "tradingview";

export const tradingviewProvider: PricingProvider = {   // junto a los demás providers
  name: "tradingview",
  fetchQuote: tradingview.fetchQuote,
  fetchQuotes: tradingview.fetchQuotes,
  fetchHistory: tradingview.fetchHistory,
};
```

Y en `providerForAsset`, antes del default:

```ts
  if (asset.priceSource === "tradingview") return tradingviewProvider;
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm test -- pricing/tradingview && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/ && git commit -m "feat(pricing): cliente TradingView (scanner batch + symbol-search, sin histórico)"
```

---

### Task 3: Fallback TV en el sync diario de precios

**Files:**
- Modify: `src/lib/price-sync.ts`
- Modify: `src/app/api/cron/sync-prices/route.ts`
- Test: `src/lib/__tests__/price-sync.test.ts` (añadir describe)

**Interfaces:**
- Consumes: `assets.tradingviewSymbol` (Task 1), `tradingviewProvider` (Task 2).
- Produces: `PriceClients.tradingview?: PriceClient & { fetchQuotes: (symbols: string[]) => Promise<Quote[]> }`; `resolveSymbol`/`priceSymbolForAsset` aceptan provider `"tradingview"` (devuelven `asset.tradingviewSymbol`); `providerFor` acepta el override `"tradingview"`; rescate batch tras fallos Yahoo con `source="tradingview"` bajo el símbolo canónico.

- [ ] **Step 1: Tests que fallan**

Añadir al final de `src/lib/__tests__/price-sync.test.ts` (usar el harness `makeDb`/seed que ya usa ese archivo; adaptar los nombres de helpers a los existentes):

```ts
describe("fallback TradingView", () => {
  it("rescata un stock cuyo fetch Yahoo falla, bajo el símbolo canónico y source tradingview", async () => {
    const db = makeDb();
    // seed: activo stock con providerSymbol AMP.MC y tradingviewSymbol BME:AMP
    db.insert(schema.assets).values({
      id: "ast_amp", name: "AMPER", assetType: "stock", currency: "EUR",
      symbol: "AMP", providerSymbol: "AMP.MC", tradingviewSymbol: "BME:AMP", isActive: true,
    }).run();
    const summary = await syncPrices(db, {
      yahoo: { fetchQuote: async () => { throw new Error("429"); } },
      coingecko: { fetchQuote: async () => { throw new Error("unused"); } },
      ft: { fetchQuote: async () => { throw new Error("unused"); } },
      tradingview: {
        fetchQuote: async () => { throw new Error("unused"); },
        fetchQuotes: async (symbols) => symbols.map((s) => ({
          symbol: s, price: 0.21, currency: "EUR", asOf: new Date("2026-07-08T16:00:00Z"),
        })),
      },
    }, "2026-07-08");
    expect(summary.fetched).toBe(1);
    expect(summary.errors).toHaveLength(0);
    const row = db.select().from(schema.priceHistory).all()[0];
    expect(row.symbol).toBe("AMP.MC");          // serie continua bajo el símbolo Yahoo
    expect(row.source).toBe("tradingview");
  });

  it("sin cliente tradingview el fallo Yahoo queda como error (comportamiento actual)", async () => {
    const db = makeDb();
    db.insert(schema.assets).values({
      id: "ast_amp", name: "AMPER", assetType: "stock", currency: "EUR",
      symbol: "AMP", providerSymbol: "AMP.MC", tradingviewSymbol: "BME:AMP", isActive: true,
    }).run();
    const summary = await syncPrices(db, {
      yahoo: { fetchQuote: async () => { throw new Error("429"); } },
      coingecko: { fetchQuote: async () => { throw new Error("unused"); } },
      ft: { fetchQuote: async () => { throw new Error("unused"); } },
    }, "2026-07-08");
    expect(summary.errors).toHaveLength(1);
  });

  it("override manual priceSource=tradingview usa el cliente TV como primario", async () => {
    const db = makeDb();
    db.insert(schema.assets).values({
      id: "ast_amp", name: "AMPER", assetType: "stock", currency: "EUR",
      symbol: "AMP", priceSource: "tradingview", tradingviewSymbol: "BME:AMP", isActive: true,
    }).run();
    const summary = await syncPrices(db, {
      yahoo: { fetchQuote: async () => { throw new Error("unused"); } },
      coingecko: { fetchQuote: async () => { throw new Error("unused"); } },
      ft: { fetchQuote: async () => { throw new Error("unused"); } },
      tradingview: {
        fetchQuote: async (s) => ({ symbol: s, price: 0.21, currency: "EUR", asOf: new Date() }),
        fetchQuotes: async () => [],
      },
    }, "2026-07-08");
    expect(summary.fetched).toBe(1);
    const row = db.select().from(schema.priceHistory).all()[0];
    expect(row.symbol).toBe("BME:AMP");          // override ⇒ serie bajo el símbolo TV
  });
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm test -- price-sync`
Expected: FAIL en los tres nuevos (tipos y lógica inexistentes). Los preexistentes siguen en verde.

- [ ] **Step 3: Implementación en `price-sync.ts`**

1. Tipos:

```ts
export type PriceClients = {
  yahoo: PriceClient;
  coingecko: PriceClient;
  ft: PriceClient;
  /** Fallback dormido: solo se invoca cuando Yahoo falló para un stock/etf, o
   *  como primario si el activo tiene priceSource='tradingview'. Opcional para
   *  no romper llamadores que no lo inyectan. */
  tradingview?: PriceClient & { fetchQuotes: (symbols: string[]) => Promise<Quote[]> };
};
```

2. `providerFor`: añadir `asset.priceSource === "tradingview" ||` a la condición del override.

3. `resolveSymbol`: añadir `tradingviewSymbol?: string | null` al tipo del parámetro y, antes del return genérico:

```ts
  if (provider === "tradingview") return asset.tradingviewSymbol?.trim() || null;
```

   `priceSymbolForAsset`: añadir `"tradingviewSymbol"` al `Pick`.

4. En el bucle de precios (paso 1 de `syncPrices`):
   - El check de existencia del día pasa a ser **agnóstico de source** (evita el choque con el índice único `(symbol, pricedDateUtc)` cuando ayer rescató TV y hoy vuelve Yahoo): quitar `eq(priceHistory.source, provider)` de la primera query `existing`.
   - Guard para clientes opcionales: sustituir `clients[provider].fetchQuote(symbol)` por

```ts
      const client = clients[provider];
      if (!client) {
        summary.errors.push({ assetId: asset.id, symbol, message: `no client for provider ${provider}` });
        continue;
      }
      const quote = await client.fetchQuote(symbol);
```

   - En el `catch`, en lugar de empujar el error directamente, acumular candidatos a rescate:

```ts
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const tvSymbol = asset.tradingviewSymbol?.trim();
      const rescuable =
        provider === "yahoo" &&
        (asset.assetType === "stock" || asset.assetType === "etf") &&
        !!tvSymbol &&
        !!clients.tradingview;
      if (rescuable) {
        tvRescue.push({ asset, symbol, tvSymbol: tvSymbol as string, message });
      } else {
        summary.errors.push({ assetId: asset.id, symbol, message });
      }
    }
```

   con `const tvRescue: { asset: Asset; symbol: string; tvSymbol: string; message: string }[] = [];` declarado antes del bucle.

   - Tras el bucle, el batch de rescate (un solo request):

```ts
  // Fallback dormido: un único batch TV para todos los fallos Yahoo de
  // stocks/ETFs. La fila rescatada se escribe bajo el símbolo CANÓNICO (el de
  // Yahoo) para que la serie de price_history siga siendo una sola.
  if (tvRescue.length > 0 && clients.tradingview) {
    let tvQuotes: Quote[] = [];
    try {
      tvQuotes = await clients.tradingview.fetchQuotes(tvRescue.map((r) => r.tvSymbol));
    } catch {
      // TV también caído: los errores Yahoo originales se reportan abajo.
    }
    const byTv = new Map(tvQuotes.map((q) => [q.symbol.toUpperCase(), q]));
    for (const r of tvRescue) {
      const quote = byTv.get(r.tvSymbol.toUpperCase());
      if (!quote) {
        summary.errors.push({ assetId: r.asset.id, symbol: r.symbol, message: r.message });
        continue;
      }
      quoteCurrencyByAsset.set(r.asset.id, quote.currency.toUpperCase());
      await db
        .insert(priceHistory)
        .values({
          id: ulid(),
          symbol: r.symbol,
          price: quote.price,
          pricedAt: quote.asOf.getTime(),
          pricedDateUtc: today,
          source: "tradingview",
          createdAt: Date.now(),
        })
        .run();
      summary.fetched++;
    }
  }
```

5. En el paso 3 (valoraciones), la query `priceRow` también pasa a ser agnóstica de source: quitar `eq(priceHistory.source, provider)` — así la fila rescatada por TV valora igual, y `priceRow.source` fluye a `assetValuations.priceSource` sin más cambios.

- [ ] **Step 4: Cron route**

En `src/app/api/cron/sync-prices/route.ts`, añadir `tradingviewProvider` al import de `../../../../lib/pricing` y al objeto de clients:

```ts
      tradingview: {
        fetchQuote: (s) => withRetry(() => tradingviewProvider.fetchQuote(s)),
        fetchQuotes: (s) => withRetry(() => tradingviewProvider.fetchQuotes(s)),
      },
```

- [ ] **Step 5: Verificar**

Run: `pnpm test -- price-sync && pnpm typecheck`
Expected: PASS completo (los tests preexistentes de price-sync no deben romperse; si alguno asertaba el filtro por source en el skip, actualizar su expectativa con un comentario del porqué).

- [ ] **Step 6: Commit**

```bash
git add src/lib/price-sync.ts src/lib/__tests__/price-sync.test.ts src/app/api/cron/sync-prices/route.ts
git commit -m "feat(sync): fallback dormido a TradingView cuando Yahoo falla en stocks/ETFs"
```

---

### Task 4: Fallback TV en la watchlist + badge de fuente

**Files:**
- Modify: `src/lib/watchlist-sync.ts`
- Modify: `src/app/api/cron/sync-watchlist/route.ts`
- Modify: `src/components/features/assets/AssetsTable.tsx:27-34` (mapa `KNOWN`)
- Modify: `src/db/schema/watchlist_quotes.ts:27` (comentario de `source`)
- Test: `src/lib/__tests__/watchlist-sync.test.ts` (añadir caso)

**Interfaces:**
- Consumes: `assets.tradingviewSymbol`, `tradingviewProvider`.
- Produces: `WatchlistClients.tradingview?: { fetchQuotes: (symbols: string[]) => Promise<Quote[]> }`; quotes rescatadas entran en `watchlist_quotes` con `source="tradingview"`.

- [ ] **Step 1: Test que falla**

Añadir a `src/lib/__tests__/watchlist-sync.test.ts` (reutilizar su harness/seed existente):

```ts
it("rescata por TradingView los watchlisted que Yahoo no devolvió", async () => {
  const db = makeDb();
  db.insert(schema.assets).values({
    id: "ast_unh", name: "UnitedHealth", assetType: "stock", currency: "USD",
    symbol: "UNH", providerSymbol: "UNH", tradingviewSymbol: "NYSE:UNH",
    isActive: true, isWatchlisted: true,
  }).run();
  const summary = await syncWatchlistQuotes(db, {
    yahoo: { fetchQuotes: async () => [] },        // Yahoo no devuelve nada
    coingecko: { fetchQuotes: async () => [] },
    tradingview: {
      fetchQuotes: async (symbols) => symbols.map((s) => ({
        symbol: s, price: 425.25, currency: "USD", asOf: new Date(),
      })),
    },
  });
  expect(summary.quoted).toBe(1);
  const q = db.select().from(schema.watchlistQuotes).all()[0];
  expect(q.source).toBe("tradingview");
  expect(q.price).toBe(425.25);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test -- watchlist-sync`
Expected: FAIL (tipo sin `tradingview`, `quoted` 0).

- [ ] **Step 3: Implementación**

En `watchlist-sync.ts`, añadir al tipo `WatchlistClients`:

```ts
  /** Fallback dormido para stocks/ETFs que el batch Yahoo no devolvió. */
  tradingview?: { fetchQuotes: (symbols: string[]) => Promise<Quote[]> };
```

Tras construir `quoteBySymbol` (después de la línea 153) y antes de leer alertas:

```ts
  // Fallback dormido: los no-cripto que Yahoo no devolvió y tienen símbolo TV
  // se piden en UN batch al scanner y se reinyectan bajo su símbolo Yahoo, así
  // el bucle de upsert no cambia.
  const tvMisses = watched.filter((a) => {
    if (a.assetType === "crypto" || !a.tradingviewSymbol?.trim()) return false;
    const symbol = symbolByAsset.get(a.id);
    return !!symbol && !quoteBySymbol.has(symbol.toUpperCase());
  });
  if (tvMisses.length > 0 && clients.tradingview) {
    let tvQuotes: Quote[] = [];
    try {
      tvQuotes = await clients.tradingview.fetchQuotes(
        tvMisses.map((a) => a.tradingviewSymbol!.trim()),
      );
    } catch {
      // TV caído: la watchlist simplemente no refresca esos activos este tick.
    }
    const byTv = new Map(tvQuotes.map((q) => [q.symbol.toUpperCase(), q]));
    for (const a of tvMisses) {
      const quote = byTv.get(a.tradingviewSymbol!.trim().toUpperCase());
      const symbol = symbolByAsset.get(a.id);
      if (quote && symbol) {
        quoteBySymbol.set(symbol.toUpperCase(), { quote, source: "tradingview" });
      }
    }
  }
```

En `src/app/api/cron/sync-watchlist/route.ts`: añadir el client análogo al de sync-prices (import de `tradingviewProvider` + `tradingview: { fetchQuotes: (s) => withRetry(() => tradingviewProvider.fetchQuotes(s)) }` — adaptar al estilo de wrapping que ya use ese route).

En `AssetsTable.tsx`, dentro de `KNOWN` (línea 27):

```ts
    tradingview: { label: "TradingView", variant: "success" },
```

En `watchlist_quotes.ts:27`, actualizar el comentario: `source: text("source").notNull(), // "yahoo" | "coingecko" | "tradingview"`.

- [ ] **Step 4: Verificar**

Run: `pnpm test -- watchlist-sync && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/watchlist-sync.ts src/lib/__tests__/watchlist-sync.test.ts src/app/api/cron/sync-watchlist/route.ts src/components/features/assets/AssetsTable.tsx src/db/schema/watchlist_quotes.ts
git commit -m "feat(watchlist): fallback TradingView en el refresh intradía + badge de fuente"
```

---

### Task 5: Backfill `pnpm backfill:tv` (símbolos TV + logos)

**Files:**
- Create: `src/lib/tradingview-backfill.ts`
- Create: `scripts/backfill-tradingview.ts`
- Modify: `package.json` (script `backfill:tv`)
- Test: `src/lib/__tests__/tradingview-backfill.test.ts`

**Interfaces:**
- Consumes: `searchSymbols`/`TvSearchHit`/`fetchQuotes` (Task 2), `searchCoins` de `./pricing` (existente; devuelve `CoinCandidate` con `thumb`), columnas de Task 1.
- Produces:

```ts
export type TvResolveDeps = {
  searchSymbols: (query: string) => Promise<TvSearchHit[]>;
  fetchQuotes: (symbols: string[]) => Promise<Quote[]>;
};
export type TvResolution = { tradingviewSymbol: string | null; logoUrl: string | null };
export async function resolveTvListing(
  asset: Pick<Asset, "isin" | "providerSymbol" | "symbol" | "ticker" | "currency">,
  deps: TvResolveDeps,
): Promise<TvResolution>;
export function tvLogoUrl(logoid: string): string; // https://s3-symbol-logo.tradingview.com/{logoid}.svg
```

- [ ] **Step 1: Test que falla**

```ts
// src/lib/__tests__/tradingview-backfill.test.ts
import { describe, expect, it } from "vitest";
import { resolveTvListing, tvLogoUrl } from "../tradingview-backfill";
import type { TvSearchHit } from "../pricing/tradingview";

const HITS: TvSearchHit[] = [
  { symbol: "3BRL", exchange: "LSE", currency: "USD", type: "fund", logoid: "wisdomtree" },
  { symbol: "NGXA", exchange: "GETTEX", currency: "EUR", type: "fund", logoid: "wisdomtree" },
];

describe("resolveTvListing", () => {
  it("prefiere la divisa del activo pero valida contra el scanner (GETTEX no cotiza → cae a LSE)", async () => {
    const res = await resolveTvListing(
      { isin: "IE00BMTM6D55", providerSymbol: null, symbol: "NGXA", ticker: null, currency: "EUR" },
      {
        searchSymbols: async () => HITS,
        // el scanner solo sirve el listing de LSE
        fetchQuotes: async (symbols) =>
          symbols
            .filter((s) => s === "LSE:3BRL")
            .map((s) => ({ symbol: s, price: 40.1, currency: "USD", asOf: new Date() })),
      },
    );
    expect(res.tradingviewSymbol).toBe("LSE:3BRL");
    expect(res.logoUrl).toBe("https://s3-symbol-logo.tradingview.com/wisdomtree.svg");
  });

  it("candidato en divisa del activo gana cuando el scanner lo sirve", async () => {
    const res = await resolveTvListing(
      { isin: "IE00BMTM6D55", providerSymbol: null, symbol: "NGXA", ticker: null, currency: "EUR" },
      {
        searchSymbols: async () => HITS,
        fetchQuotes: async (symbols) =>
          symbols.map((s) => ({ symbol: s, price: 40, currency: "EUR", asOf: new Date() })),
      },
    );
    expect(res.tradingviewSymbol).toBe("GETTEX:NGXA");
  });

  it("sin hits (fondos) devuelve nulls y toma el logoid aunque no cotice nada", async () => {
    const sinNada = await resolveTvListing(
      { isin: "ES0119199018", providerSymbol: null, symbol: "COBAS-D", ticker: null, currency: "EUR" },
      { searchSymbols: async () => [], fetchQuotes: async () => [] },
    );
    expect(sinNada).toEqual({ tradingviewSymbol: null, logoUrl: null });

    const soloLogo = await resolveTvListing(
      { isin: "IE00BMTM6D55", providerSymbol: null, symbol: "NGXA", ticker: null, currency: "EUR" },
      { searchSymbols: async () => HITS, fetchQuotes: async () => [] },
    );
    expect(soloLogo.tradingviewSymbol).toBeNull();
    expect(soloLogo.logoUrl).toBe("https://s3-symbol-logo.tradingview.com/wisdomtree.svg");
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test -- tradingview-backfill`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementación**

```ts
// src/lib/tradingview-backfill.ts
// Resolución de listing TradingView por activo: symbol-search (por ISIN, si no
// por ticker) → ordenar candidatos (divisa del activo primero, EUR después) →
// validar contra el scanner en UN batch y quedarse con el primero que cotiza.
// La validación es necesaria: symbol-search lista venues (p. ej. GETTEX) que el
// scanner global no sirve. Puro + deps inyectadas para testear sin red.

import type { Asset } from "../db/schema";
import type { Quote } from "./pricing";
import type { TvSearchHit } from "./pricing/tradingview";

export type TvResolveDeps = {
  searchSymbols: (query: string) => Promise<TvSearchHit[]>;
  fetchQuotes: (symbols: string[]) => Promise<Quote[]>;
};

export type TvResolution = { tradingviewSymbol: string | null; logoUrl: string | null };

export function tvLogoUrl(logoid: string): string {
  return `https://s3-symbol-logo.tradingview.com/${logoid}.svg`;
}

// Tipos de instrumento que nos valen (equities, ADRs, ETFs/ETPs). Deja fuera
// spot cripto, bonos e índices que symbol-search también devuelve.
const USABLE_TYPES = new Set(["stock", "dr", "fund", "structured", "etf"]);

const MAX_PROBE = 5;

export async function resolveTvListing(
  asset: Pick<Asset, "isin" | "providerSymbol" | "symbol" | "ticker" | "currency">,
  deps: TvResolveDeps,
): Promise<TvResolution> {
  const query =
    asset.isin?.trim() || asset.providerSymbol?.trim() || asset.symbol?.trim() || asset.ticker?.trim();
  if (!query) return { tradingviewSymbol: null, logoUrl: null };

  const hits = (await deps.searchSymbols(query)).filter((h) => USABLE_TYPES.has(h.type));
  if (hits.length === 0) return { tradingviewSymbol: null, logoUrl: null };

  // El logoid es el mismo en todos los listings del instrumento; vale cualquiera.
  const logoid = hits.find((h) => h.logoid)?.logoid ?? null;

  const ccy = (asset.currency ?? "EUR").toUpperCase();
  const rank = (h: TvSearchHit): number =>
    h.currency?.toUpperCase() === ccy ? 0 : h.currency?.toUpperCase() === "EUR" ? 1 : 2;
  const ordered = [...hits].sort((a, b) => rank(a) - rank(b));
  const candidates = ordered.slice(0, MAX_PROBE).map((h) => `${h.exchange}:${h.symbol}`);

  let quoted: Quote[] = [];
  try {
    quoted = await deps.fetchQuotes(candidates);
  } catch {
    // Scanner caído: persistimos el logo igualmente; el símbolo puede
    // regenerarse en otra pasada.
  }
  const alive = new Set(quoted.map((q) => q.symbol.toUpperCase()));
  const chosen = candidates.find((c) => alive.has(c.toUpperCase())) ?? null;

  return { tradingviewSymbol: chosen, logoUrl: logoid ? tvLogoUrl(logoid) : null };
}
```

```ts
// scripts/backfill-tradingview.ts
// Rellena assets.tradingviewSymbol + assets.logoUrl una única vez (idempotente:
// no machaca valores ya presentes salvo --force). Equities/ETFs vía TradingView;
// cripto toma el logo del thumb de CoinGecko. Uso:
//   pnpm backfill:tv [--force]
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { assets } from "../src/db/schema";
import { searchCoins } from "../src/lib/pricing";
import * as tradingview from "../src/lib/pricing/tradingview";
import { resolveTvListing } from "../src/lib/tradingview-backfill";

const force = process.argv.includes("--force");

async function main() {
  const rows = await db.select().from(assets).all();
  for (const asset of rows) {
    const done = asset.tradingviewSymbol != null && asset.logoUrl != null;
    if (done && !force) {
      console.log(`= ${asset.name}: ya resuelto`);
      continue;
    }
    let tradingviewSymbol = asset.tradingviewSymbol;
    let logoUrl = asset.logoUrl;
    if (asset.assetType === "crypto") {
      // CoinGecko: providerSymbol es el coin id ("ethereum"); el thumb sirve de logo.
      const idOrName = asset.providerSymbol ?? asset.symbol ?? asset.name;
      const coins = await searchCoins(idOrName);
      const coin = coins.find((c) => c.id === asset.providerSymbol) ?? coins[0];
      if ((force || logoUrl == null) && coin?.thumb) logoUrl = coin.thumb;
    } else {
      const res = await resolveTvListing(asset, {
        searchSymbols: tradingview.searchSymbols,
        fetchQuotes: tradingview.fetchQuotes,
      });
      if (force || tradingviewSymbol == null) tradingviewSymbol = res.tradingviewSymbol;
      if (force || logoUrl == null) logoUrl = res.logoUrl;
    }
    await db
      .update(assets)
      .set({ tradingviewSymbol, logoUrl, updatedAt: Date.now() })
      .where(eq(assets.id, asset.id))
      .run();
    console.log(`✓ ${asset.name}: tv=${tradingviewSymbol ?? "—"} logo=${logoUrl ? "sí" : "—"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

En `package.json`, junto a los demás backfills:

```json
    "backfill:tv": "tsx scripts/backfill-tradingview.ts",
```

- [ ] **Step 4: Verificar**

Run: `pnpm test -- tradingview-backfill && pnpm typecheck && pnpm lint`
Expected: PASS (el script no se ejecuta aún contra la BD real — eso es Task 10).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tradingview-backfill.ts src/lib/__tests__/tradingview-backfill.test.ts scripts/backfill-tradingview.ts package.json
git commit -m "feat(backfill): pnpm backfill:tv — resuelve símbolo TradingView y logo por activo"
```

---

### Task 6: Primitivo `AssetLogo` + superficies

**Files:**
- Create: `src/components/ui/AssetLogo.tsx`
- Modify: `src/components/features/assets/AssetsTable.tsx` (columna Nombre)
- Modify: `src/components/features/overview/TopPositionsTable.tsx:38-59` (celda Activo)
- Modify: `src/components/features/watchlist/WatchlistCard.tsx:101` (título)
- Modify: `src/app/transactions/page.tsx:33,100-101` (celda Activo)

**Interfaces:**
- Consumes: `Asset.logoUrl` (Task 1).
- Produces: `AssetLogo({ name, logoUrl, size?, className? })` — client component, fallback a iniciales.

- [ ] **Step 1: Crear el primitivo**

```tsx
// src/components/ui/AssetLogo.tsx
"use client";

import * as React from "react";
import { cn } from "@/src/lib/cn";

/** Logo circular de un activo con fallback a iniciales (logoUrl null o carga
 *  fallida). El CDN se hotlinkea desde el navegador — el server no toca red. */
export function AssetLogo({
  name,
  logoUrl,
  size = 20,
  className,
}: {
  name: string;
  logoUrl: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  if (!logoUrl || failed) {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42) }}
        className={cn(
          "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-muted font-semibold uppercase text-muted-foreground",
          className,
        )}
      >
        {name.trim().slice(0, 2)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN externo sin dominio configurable; next/image no aporta aquí
    <img
      src={logoUrl}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full object-contain", className)}
    />
  );
}
```

- [ ] **Step 2: Insertarlo en las superficies**

`AssetsTable.tsx`, columna `name`:

```tsx
          {
            key: "name",
            header: "Nombre",
            cell: (r) => (
              <span className="flex items-center gap-2">
                <AssetLogo name={r.name} logoUrl={r.logoUrl} size={20} />
                {r.name}
              </span>
            ),
          },
```

`TopPositionsTable.tsx`, celda `asset` — añadir el logo entre el stripe y el bloque de texto:

```tsx
                <div className="flex items-stretch gap-3">
                  <AssetTypeStripe type={a.assetType} />
                  <div className="flex items-center">
                    <AssetLogo name={a.name} logoUrl={a.logoUrl} size={24} />
                  </div>
                  <div className="flex flex-col leading-tight">
```

`WatchlistCard.tsx:101` — anteponer el logo al nombre (dentro del mismo contenedor flex; si el `<span>` no está en un flex, envolver):

```tsx
              <AssetLogo name={asset.name} logoUrl={asset.logoUrl} size={20} />
              <span className="truncate font-semibold">{asset.name}</span>
```

`src/app/transactions/page.tsx` — sustituir el mapa `assetName` (línea 33) por el activo completo y renderizar logo + etiqueta:

```tsx
  const assetById = new Map(assets.map((a) => [a.id, a]));
```

```tsx
              header: "Activo",
              cell: (r) => {
                const a = assetById.get(r.assetId);
                if (!a) return r.assetId;
                return (
                  <span className="flex items-center gap-2">
                    <AssetLogo name={a.name} logoUrl={a.logoUrl} size={18} />
                    {a.symbol ?? a.name}
                  </span>
                );
              },
```

(Revisar otros usos de `assetName` en esa página y migrarlos a `assetById.get(id)?.symbol ?? assetById.get(id)?.name ?? id`.)

- [ ] **Step 3: Verificar**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS. Nota: verificación visual dark/light queda para Task 10.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/AssetLogo.tsx src/components/features/assets/AssetsTable.tsx src/components/features/overview/TopPositionsTable.tsx src/components/features/watchlist/WatchlistCard.tsx src/app/transactions/page.tsx
git commit -m "feat(ui): primitivo AssetLogo con fallback a iniciales en assets/overview/watchlist/transacciones"
```

---

### Task 7: `src/server/returns.ts` — rentabilidades por ventana

**Files:**
- Create: `src/server/returns.ts`
- Test: `src/server/__tests__/returns.test.ts`

**Interfaces:**
- Consumes: `asset_valuations` (unitPriceEur, valuationDate), `toIsoDate` de `../lib/time`.
- Produces:

```ts
export const RETURN_PERIODS = ["1m", "3m", "6m", "ytd", "1y"] as const;
export type ReturnPeriod = (typeof RETURN_PERIODS)[number];
export type PeriodReturns = Record<ReturnPeriod, number | null>;
export function periodStartIso(period: ReturnPeriod, todayIso: string): string;
export async function getPeriodReturns(
  assetIds: string[],
  db?: DB,
  todayIso?: string,
): Promise<Map<string, PeriodReturns>>;
```

- [ ] **Step 1: Tests que fallan**

```ts
// src/server/__tests__/returns.test.ts
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { getPeriodReturns, periodStartIso } from "../returns";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedValuations(db: DB, assetId: string, points: Array<[string, number]>) {
  db.insert(schema.assets)
    .values({ id: assetId, name: assetId, assetType: "etf", currency: "EUR" })
    .run();
  for (const [date, price] of points) {
    db.insert(schema.assetValuations)
      .values({
        id: `${assetId}_${date}`,
        assetId,
        valuationDate: date,
        quantity: 10,
        unitPriceEur: price,
        marketValueEur: price * 10,
        priceSource: "yahoo",
        createdAt: 1,
      })
      .run();
  }
}

describe("periodStartIso", () => {
  it("resta meses en UTC y YTD ancla al 31-dic anterior", () => {
    expect(periodStartIso("1m", "2026-07-08")).toBe("2026-06-08");
    expect(periodStartIso("3m", "2026-07-08")).toBe("2026-04-08");
    expect(periodStartIso("6m", "2026-07-08")).toBe("2026-01-08");
    expect(periodStartIso("1y", "2026-07-08")).toBe("2025-07-08");
    expect(periodStartIso("ytd", "2026-07-08")).toBe("2025-12-31");
    // desbordamiento de día: 31-mar − 1m cae en marzo (Date.UTC normaliza)
    expect(periodStartIso("1m", "2026-03-31")).toBe("2026-03-03");
  });
});

describe("getPeriodReturns", () => {
  it("calcula cada ventana con la última fila ≤ fecha de corte", async () => {
    const db = makeDb();
    seedValuations(db, "ast_1", [
      ["2025-12-31", 100],
      ["2026-06-05", 110], // baseline 1m (≤ 2026-06-08)
      ["2026-07-07", 121],
    ]);
    const map = await getPeriodReturns(["ast_1"], db, "2026-07-08");
    const r = map.get("ast_1")!;
    expect(r["1m"]).toBeCloseTo(0.1, 10);   // 121/110 − 1
    expect(r.ytd).toBeCloseTo(0.21, 10);    // 121/100 − 1
    // La fila 2025-12-31 también es la última ≤ 2026-04-08: 3m comparte baseline
    // con YTD (corregido durante la implementación; el borrador esperaba null).
    expect(r["3m"]).toBeCloseTo(0.21, 10);
    expect(r["1y"]).toBeNull();
  });

  it("activo sin valoraciones → todas null; ids vacíos → mapa vacío", async () => {
    const db = makeDb();
    db.insert(schema.assets)
      .values({ id: "ast_2", name: "n", assetType: "stock", currency: "EUR" })
      .run();
    const map = await getPeriodReturns(["ast_2"], db, "2026-07-08");
    expect(map.get("ast_2")).toEqual({ "1m": null, "3m": null, "6m": null, ytd: null, "1y": null });
    expect((await getPeriodReturns([], db)).size).toBe(0);
  });
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm test -- returns`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementación**

```ts
// src/server/returns.ts
// Rentabilidad de PRECIO por ventana (1m/3m/6m/YTD/1a) sobre la serie EUR
// canónica: asset_valuations.unitPriceEur, que el sync escribe ya convertida.
// No es money-weighted (los flujos intermedios no entran; para eso está el
// XIRR). La serie existe desde que se posee el activo ⇒ ventana sin baseline
// devuelve null y la UI pinta «—». Cálculo on-read: ~15 activos en SQLite
// local, no merece materialización.

import { asc, inArray } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { assetValuations } from "../db/schema";
import { toIsoDate } from "../lib/time";

export const RETURN_PERIODS = ["1m", "3m", "6m", "ytd", "1y"] as const;
export type ReturnPeriod = (typeof RETURN_PERIODS)[number];
export type PeriodReturns = Record<ReturnPeriod, number | null>;

const MONTHS_BACK: Record<Exclude<ReturnPeriod, "ytd">, number> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "1y": 12,
};

/** Fecha de corte de la ventana. Baseline = última fila ≤ esta fecha, así los
 *  fines de semana/festivos caen solos al cierre anterior. */
export function periodStartIso(period: ReturnPeriod, todayIso: string): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  if (period === "ytd") return `${y - 1}-12-31`;
  return toIsoDate(new Date(Date.UTC(y, m - 1 - MONTHS_BACK[period], d)));
}

const EMPTY: PeriodReturns = { "1m": null, "3m": null, "6m": null, ytd: null, "1y": null };

export async function getPeriodReturns(
  assetIds: string[],
  db: DB = defaultDb,
  todayIso: string = toIsoDate(new Date()),
): Promise<Map<string, PeriodReturns>> {
  const out = new Map<string, PeriodReturns>();
  if (assetIds.length === 0) return out;
  for (const id of assetIds) out.set(id, { ...EMPTY });

  const rows = await db
    .select({
      assetId: assetValuations.assetId,
      valuationDate: assetValuations.valuationDate,
      unitPriceEur: assetValuations.unitPriceEur,
    })
    .from(assetValuations)
    .where(inArray(assetValuations.assetId, assetIds))
    .orderBy(asc(assetValuations.valuationDate))
    .all();

  const byAsset = new Map<string, { date: string; price: number }[]>();
  for (const r of rows) {
    if (r.valuationDate > todayIso) continue;
    const list = byAsset.get(r.assetId) ?? [];
    list.push({ date: r.valuationDate, price: r.unitPriceEur });
    byAsset.set(r.assetId, list);
  }

  for (const [assetId, series] of byAsset) {
    if (series.length === 0) continue;
    const latest = series[series.length - 1];
    if (!(latest.price > 0)) continue;
    const returns = out.get(assetId)!;
    for (const period of RETURN_PERIODS) {
      const cutoff = periodStartIso(period, todayIso);
      // Última fila ≤ cutoff (serie ya ordenada asc; ISO ordena cronológico).
      let baseline: { date: string; price: number } | null = null;
      for (const point of series) {
        if (point.date > cutoff) break;
        baseline = point;
      }
      if (!baseline || !(baseline.price > 0) || baseline.date === latest.date) continue;
      returns[period] = latest.price / baseline.price - 1;
    }
  }
  return out;
}
```

- [ ] **Step 4: Verificar**

Run: `pnpm test -- returns && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/returns.ts src/server/__tests__/returns.test.ts
git commit -m "feat(server): getPeriodReturns — rentabilidad EUR por ventana desde asset_valuations"
```

---

### Task 8: Extracto web — sección «Desglose por activo»

**Files:**
- Modify: `src/server/statement.ts` (añadir `logoUrl` a `StatementAssetLine` + `toLine`)
- Create: `src/components/features/statement/AssetBreakdownTable.tsx`
- Modify: `src/app/statement/page.tsx` (fetch de returns + sección nueva)
- Test: `src/server/__tests__/statement.test.ts` (aserción de `logoUrl`)

**Interfaces:**
- Consumes: `StatementGroup`/`StatementAssetLine` (existentes), `getPeriodReturns`/`PeriodReturns`/`RETURN_PERIODS` (Task 7), `AssetLogo` (Task 6), `assetTypeLabel` de `@/src/lib/labels`, `formatEur`/`formatPercent`/`formatQuantity` de `@/src/lib/format` (si `formatQuantity` no existe ahí, usar el formateador que use TopPositionsTable).
- Produces: `AssetBreakdownTable({ groups, returnsByAsset, pricesAsOf })` — server component.

- [ ] **Step 1: Test que falla — `StatementAssetLine.logoUrl`**

En `src/server/__tests__/statement.test.ts`, dentro del seed existente, dar `logoUrl: "https://cdn/x.svg"` al asset y añadir en un test existente del desglose:

```ts
    expect(report.groups[0].lines[0].logoUrl).toBe("https://cdn/x.svg");
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test -- statement`
Expected: FAIL (propiedad inexistente).

- [ ] **Step 3: `statement.ts`** — en el type `StatementAssetLine` añadir `logoUrl: string | null;` (tras `isin`), y en `toLine` añadir `logoUrl: input.asset.logoUrl,` (tras `isin: input.asset.isin,`).

Run: `pnpm test -- statement` → PASS.

- [ ] **Step 4: Componente de tabla**

```tsx
// src/components/features/statement/AssetBreakdownTable.tsx
import { AssetLogo } from "@/src/components/ui/AssetLogo";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatPercent, formatQuantity } from "@/src/lib/format";
import { assetTypeLabel } from "@/src/lib/labels";
import type { StatementAssetLine, StatementGroup } from "@/src/server/statement";
import { RETURN_PERIODS, type PeriodReturns, type ReturnPeriod } from "@/src/server/returns";

const PERIOD_LABEL: Record<ReturnPeriod, string> = {
  "1m": "1m",
  "3m": "3m",
  "6m": "6m",
  ytd: "YTD",
  "1y": "1a",
};

function ReturnCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  const color = value > 0 ? "text-success" : value < 0 ? "text-destructive" : "";
  return (
    <span className={`tabular-nums text-xs ${color}`}>
      {value >= 0 ? "+" : ""}
      {formatPercent(value)}
    </span>
  );
}

export function AssetBreakdownTable({
  groups,
  returnsByAsset,
  pricesAsOf,
}: {
  groups: StatementGroup[];
  returnsByAsset: Record<string, PeriodReturns>;
  pricesAsOf: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.assetType} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {assetTypeLabel(group.assetType)}
          </h3>
          <DataTable<StatementAssetLine>
            rows={group.lines}
            getRowKey={(l) => l.assetId}
            columns={[
              {
                key: "asset",
                header: "Activo",
                cell: (l) => (
                  <span className="flex items-center gap-2">
                    <AssetLogo name={l.name} logoUrl={l.logoUrl} size={20} />
                    <span className="flex flex-col leading-tight">
                      <span className="font-medium">{l.name}</span>
                      {l.symbol && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {l.symbol}
                        </span>
                      )}
                    </span>
                    {l.valuationDate && pricesAsOf && l.valuationDate < pricesAsOf && (
                      <span
                        title={`Último precio: ${l.valuationDate}`}
                        className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                      />
                    )}
                  </span>
                ),
              },
              {
                key: "quantity",
                header: "Cant.",
                align: "right",
                cell: (l) => (
                  <span className="tabular-nums text-xs">
                    {formatQuantity(l.quantity, { maximumFractionDigits: 8 })}
                  </span>
                ),
              },
              {
                key: "price",
                header: "Precio",
                align: "right",
                cell: (l) =>
                  l.unitPriceEur != null ? (
                    <SensitiveValue className="tabular-nums text-xs">
                      {formatEur(l.unitPriceEur)}
                    </SensitiveValue>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  ),
              },
              {
                key: "value",
                header: "Valor",
                align: "right",
                cell: (l) => (
                  <SensitiveValue className="tabular-nums">
                    {formatEur(l.marketValueEur ?? l.costEur)}
                  </SensitiveValue>
                ),
              },
              {
                key: "pnl",
                header: "Plusvalía",
                align: "right",
                cell: (l) => {
                  if (l.valuedAtCost || l.pnlEur == null) {
                    return <span className="text-muted-foreground">—</span>;
                  }
                  const color =
                    l.pnlEur > 0 ? "text-success" : l.pnlEur < 0 ? "text-destructive" : "";
                  return (
                    <div className={`flex flex-col items-end leading-tight ${color}`}>
                      <SensitiveValue className="tabular-nums">
                        {formatEur(l.pnlEur)}
                      </SensitiveValue>
                      {l.pnlPct != null && (
                        <span className="text-xs tabular-nums opacity-80">
                          {l.pnlPct >= 0 ? "+" : ""}
                          {formatPercent(l.pnlPct)}
                        </span>
                      )}
                    </div>
                  );
                },
              },
              {
                key: "weight",
                header: "Peso",
                align: "right",
                cell: (l) =>
                  l.weight != null ? (
                    <span className="tabular-nums text-xs">{formatPercent(l.weight)}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  ),
              },
              ...RETURN_PERIODS.map((period) => ({
                key: `ret_${period}`,
                header: PERIOD_LABEL[period],
                align: "right" as const,
                cell: (l: StatementAssetLine) => (
                  <ReturnCell value={returnsByAsset[l.assetId]?.[period] ?? null} />
                ),
              })),
            ]}
          />
        </div>
      ))}
    </div>
  );
}
```

Nota: si el token `bg-warning` no existe en el tema, usar la clase que use el `Badge` variant warning (comprobar `src/components/ui/Badge.tsx`) — no inventar colores fuera del tema.

- [ ] **Step 5: Sección en la página**

En `src/app/statement/page.tsx`: tras obtener `report`, calcular

```tsx
  const returnsMap = await getPeriodReturns(
    report.groups.flatMap((g) => g.lines.map((l) => l.assetId)),
  );
  const returnsByAsset = Object.fromEntries(returnsMap);
```

y añadir la sección (tras las tablas/cards existentes de cuentas, antes de los donuts o donde el flujo visual de la página lo pida — mantener el orden Card/section del archivo):

```tsx
      {hasPositions && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Desglose por activo</h2>
          <AssetBreakdownTable
            groups={report.groups}
            returnsByAsset={returnsByAsset}
            pricesAsOf={report.pricesAsOf}
          />
        </section>
      )}
```

Imports nuevos: `AssetBreakdownTable`, `getPeriodReturns`.

- [ ] **Step 6: Verificar**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/statement.ts src/server/__tests__/statement.test.ts src/components/features/statement/AssetBreakdownTable.tsx src/app/statement/page.tsx
git commit -m "feat(statement): desglose por activo en el Extracto web con rentabilidades por ventana"
```

---

### Task 9: Badge de frescura en la cabecera del Extracto

**Files:**
- Modify: `src/server/statement.ts` (campo `pricesAsOfAt`)
- Modify: `src/app/statement/page.tsx:284-295` (header)
- Test: `src/server/__tests__/statement.test.ts`

**Interfaces:**
- Consumes: `priceHistory.pricedAt`, `priceSymbolForAsset` de `../lib/price-sync`.
- Produces: `StatementReport.pricesAsOfAt: number | null` — epoch ms del precio más reciente entre los activos en cartera; `null` en extractos as-of.

- [ ] **Step 1: Test que falla**

En `statement.test.ts` (el seed ya inserta filas de `priceHistory`? si no, insertar una con `pricedAt` conocido para el símbolo del asset sembrado):

```ts
  it("pricesAsOfAt refleja el pricedAt más reciente de los símbolos en cartera", async () => {
    const db = makeDb();
    seedPortfolio(db); // asegurarse de que el seed inserta una fila priceHistory con pricedAt: 1751980800000
    const report = await getStatementReport(db);
    expect(report.pricesAsOfAt).toBe(1751980800000);
  });

  it("extracto as-of no lleva pricesAsOfAt", async () => {
    const db = makeDb();
    seedPortfolio(db);
    const report = await getStatementReport(db, { asOf: "2026-07-01" });
    expect(report.pricesAsOfAt).toBeNull();
  });
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test -- statement`
Expected: FAIL.

- [ ] **Step 3: Implementación en `statement.ts`**

- Type: en `StatementReport`, tras `pricesAsOf`: `/** Epoch ms del precio más reciente en cartera (badge de frescura). Null en as-of. */ pricesAsOfAt: number | null;`
- En `assembleReport`, devolver `pricesAsOfAt: null` (default).
- Imports: añadir `priceHistory` al import de schema y `priceSymbolForAsset` desde `../lib/price-sync`.
- Helper privado:

```ts
async function latestPricedAt(assetRows: Asset[], db: DB): Promise<number | null> {
  const symbols = [
    ...new Set(
      assetRows.map((a) => priceSymbolForAsset(a)).filter((s): s is string => !!s),
    ),
  ];
  if (symbols.length === 0) return null;
  const row = await db
    .select({ latest: max(priceHistory.pricedAt) })
    .from(priceHistory)
    .where(inArray(priceHistory.symbol, symbols))
    .get();
  return row?.latest ?? null;
}
```

- En `getStatementReport` (rama actual, no as-of):

```ts
  const pricesAsOfAt = await latestPricedAt(open.map((r) => r.asset), db);
  return { ...assembleReport({ /* igual que ahora */ }), pricesAsOfAt };
```

- [ ] **Step 4: Badge en el header de `page.tsx`**

Sustituir el fragmento `{report.pricesAsOf ? \` · precios a cierre del ${report.pricesAsOf}\` : ""}` del párrafo por texto plano sin precios, y añadir el badge junto al `StatementExportMenu` (import `Badge` de `@/src/components/ui/Badge`):

```tsx
        <div className="flex items-center gap-3">
          {report.pricesAsOfAt != null && (
            <Badge
              variant={
                Date.now() - report.pricesAsOfAt > 36 * 60 * 60 * 1000 ? "warning" : "success"
              }
            >
              Precios a {formatDateTime(report.pricesAsOfAt)}
            </Badge>
          )}
          <StatementExportMenu />
        </div>
```

(Comprobar los variants reales de `Badge`; `FreshnessCell` ya usa `success`/`neutral`/`warning`.)

- [ ] **Step 5: Verificar**

Run: `pnpm test -- statement && pnpm typecheck && pnpm build`
Expected: PASS. Nota: si el XLSX/PDF export consume `StatementReport`, el campo nuevo es aditivo y no debe romper nada — confirmar con `pnpm test` completo.

- [ ] **Step 6: Commit**

```bash
git add src/server/statement.ts src/server/__tests__/statement.test.ts src/app/statement/page.tsx
git commit -m "feat(statement): badge de frescura de precios (max pricedAt, warning >36h)"
```

---

### Task 10: Backfill real, verificación visual y cierre DoD

**Files:**
- Ninguno nuevo (ejecución + verificación).

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Suite completa**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: todo PASS, cero errores.

- [ ] **Step 2: Backfill contra la BD real**

Run: `pnpm db:backup && pnpm backfill:tv`
Expected: los 6 ETFs y 6 acciones salen con `tv=EXCHANGE:TICKER` y `logo=sí`; los 3 fondos `tv=— logo=—`; cripto `logo=sí`. Verificar en BD: `sqlite3 data/finances.db "SELECT name, tradingview_symbol, logo_url FROM assets;"`.

- [ ] **Step 3: Smoke con BD vacía**

Crear una BD temporal vacía (apuntar `DATABASE_PATH`/equivalente del `.env` a un archivo nuevo en scratch o usar el mecanismo del proyecto), `pnpm db:migrate`, arrancar `pnpm dev` en el puerto 3210 y comprobar que `/statement`, `/assets`, `/transactions`, `/watchlist` y la home muestran estados vacíos sin errores (sin badge de frescura, sin desglose). Restaurar el `.env` después.

- [ ] **Step 4: Verificación visual dark/light**

Con la BD real y dev en 3210, capturar con Playwright (patrón de la memoria «Verificación visual») en dark y light:
- `/statement`: badge «Precios a …», sección «Desglose por activo» con logos, ventanas con «—» donde falte profundidad, dot ámbar en líneas rezagadas (Groupama/fondos), todo importe oculto al activar modo sensible.
- `/assets`: columna Nombre con logos, badge de fuente (incl. «TradingView» si ya hubo rescate).
- `/` (overview): tabla Posiciones con logos.
- `/watchlist` y `/transactions`: logos presentes, iniciales en los 3 fondos.

- [ ] **Step 5: Sync de humo (opcional pero recomendado)**

Run: `pnpm sync:prices`
Expected: `ok: true`; día sano ⇒ `errors: []` y cero menciones a tradingview en el summary (fallback dormido).

- [ ] **Step 6: Commit final si hubo retoques + debrief**

```bash
git add -A && git commit -m "chore: cierre DoD mejoras financial-hub"
```

Recordatorio de deploy (launchd no auto-migra): `pnpm db:backup && pnpm db:migrate && pnpm build && launchctl kickstart -k gui/$(id -u)/com.finances.app`.
