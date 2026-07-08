# Mejoras financial-hub: TV fallback, logos, rentabilidades por ventana, frescura

**Fecha:** 2026-07-08 · **Estado:** aprobado

Cuatro mejoras inspiradas en el análisis de financial-hub.es, integradas sobre la
arquitectura existente (proveedores bajo `src/lib/pricing/`, lecturas en
`src/server/`, sync diario idempotente). Contexto que motiva la primera: Yahoo
está endureciendo el acceso (429 verificados en `quoteSummary`) y hoy es el único
proveedor de 12 de los 15 activos activos, sin plan B.

Cobertura verificada del universo actual contra TradingView (symbol-search por
ISIN + scanner): **las 6 acciones y los 6 ETFs resuelven**; los 3 fondos
(Cobas D, Groupama IC, Indexa EPSV) no existen en TV y siguen en Yahoo/FT; la
cripto sigue en CoinGecko. Todos los equities/ETFs tienen `logoid` en TV.

---

## 1 · Proveedor TradingView como fallback dormido

**Rol:** Yahoo sigue siendo primario. TV solo se invoca cuando el fetch Yahoo de
un activo stock/etf falla tras sus reintentos (`withRetry`). Día sano = 0
requests a TV; si TV muere, nada se rompe. Además, `priceSource='tradingview'`
queda disponible como override manual por activo (mismo mecanismo que `ft`).

**Cliente** `src/lib/pricing/tradingview.ts`:
- `fetchQuotes(symbols)` → un único POST a `https://scanner.tradingview.com/global/scan`
  con `{symbols:{tickers:[...]}, columns:["close","currency"]}`. Acepta tickers
  de varios mercados en la misma request (verificado: `BME:AMP` + `NASDAQ:JD` +
  `XETR:VWCE` + `NYSE:UNH` en una llamada). Devuelve `Quote[]`; los símbolos que
  el scanner no conoce se omiten del resultado (no rompen el batch).
- `fetchQuote(symbol)` delega en `fetchQuotes([symbol])`.
- `fetchHistory` rechaza con error explícito «tradingview: history unsupported»
  — TV no da histórico; los backfills siguen en Yahoo/FT.
- `asOf` = momento del fetch (snapshot de último cruce).
- Red vía el mismo helper `_net.ts` que el resto de clientes; tests stubbeados.

**Esquema:** columna nueva `assets.tradingview_symbol` (text, nullable) con la
simbología TV (`BME:AMP`, `XETR:VWCE`), independiente de `providerSymbol`
(Yahoo). Migración generada con drizzle-kit (misma migración que `logo_url`,
punto 2).

**Cableado del fallback:**
- `price-sync.ts`: `PriceClients` gana miembro opcional `tradingview`. Los
  activos stock/etf cuyo fetch Yahoo agota reintentos se acumulan y se reintenta
  **un único batch TV** con los que tengan `tradingviewSymbol`. El éxito escribe
  `source='tradingview'` en `price_history` / `asset_valuations`.
- `watchlist-sync.ts`: misma mecánica sobre el batch Yahoo existente; el quote
  rescatado escribe `source='tradingview'` en `watchlist_quotes`.
- `providerForAsset` (index.ts) y `providerFor` (price-sync.ts) reconocen el
  override `'tradingview'`; los Zod de `createAsset`/`updateAsset` lo aceptan.
- `FreshnessCell` (/assets) añade `tradingview → badge «TradingView»` (success).

**Fuera de alcance:** fondos y cripto no llevan fallback TV; sectores/geografía
siguen Yahoo/JustETF.

---

## 2 · Logos de activos

**Esquema:** columna nueva `assets.logo_url` (text, nullable). URL completa (no
solo el slug TV) para admitir CoinGecko en cripto y URLs manuales. Editable en
el formulario de editar activo (campo URL simple).

**Backfill** `pnpm backfill:tv` → `scripts/backfill-tradingview.ts` (tsx, como
el resto). Por cada activo con ISIN o ticker:
1. Consulta symbol-search de TV (`symbol_search/v3/?text=<isin|ticker>`).
2. Ordena candidatos: EUR/mercado del activo primero.
3. **Valida el candidato contra el scanner** (un POST de prueba) y persiste el
   primero que realmente cotiza — verificado necesario: `GETTEX:NGXA` aparece en
   symbol-search pero el scanner global no lo sirve; su listing útil es otro
   (p. ej. `LSE:3BRL`).
4. Persiste `tradingviewSymbol` + `logoUrl`
   (`https://s3-symbol-logo.tradingview.com/{logoid}.svg`).
5. Cripto: `logoUrl` desde CoinGecko (thumb); sin `tradingviewSymbol`.
6. Idempotente: nunca sobrescribe un valor no nulo (respeta ajustes manuales);
   `--force` para regenerar.

Los 3 fondos quedan sin logo a propósito → fallback de iniciales.

**UI:** primitivo `AssetLogo` en `src/components/ui/AssetLogo.tsx`: imagen
circular (~20 px en tablas) con fallback a iniciales (2 letras del nombre) sobre
fondo neutro cuando `logoUrl` es null o el `<img>` dispara `onError`. El
navegador carga el CDN directamente (hotlink); el servidor no toca la red en
runtime. Superficies (solo web): nueva tabla del Extracto (punto 3), `/assets`,
tarjetas de watchlist, tabla de transacciones y tabla «Posiciones» del Overview.
El PDF del extracto queda fuera: se genera con jsPDF 100 % vectorial («sin
imágenes rasterizadas» por diseño del kit) y no admite hotlinks.

---

## 3 · Desglose por activo en Extracto web con rentabilidades por ventana

**Capa de lectura** `src/server/returns.ts`:
- `getPeriodReturns(assetIds, db)` → por activo: último `unitPriceEur` de
  `asset_valuations` vs el de la fila ≤ `hoy − ventana`. La serie ya está en
  EUR por construcción (el sync convierte con FX al escribirla), así que no
  hay conversión en lectura. (Enmienda sobre el borrador inicial: `price_history`
  guarda el precio nativo sin columna de divisa, lo que hacía ambigua la
  conversión; `asset_valuations` es la serie EUR canónica.) Coherente con la
  filosofía EUR-first: para UNH mide lo que hizo el patrimonio, no el ticker
  en USD. Limitación asumida: la serie existe desde que se posee el activo,
  así que las ventanas anteriores a la compra salen «—».
- Ventanas: `1m / 3m / 6m / YTD / 1y`. `null` cuando no hay profundidad de
  histórico → la UI pinta «—». Sin 3a/5a (no hay datos).
- Rentabilidad de **precio** (los flujos intermedios no entran; para
  money-weighted ya existe el XIRR).
- Cálculo on-read, sin tablas nuevas (15 activos × SQLite local: coste trivial).

**UI (Extracto web):** nueva sección «Desglose por activo» bajo las tablas
actuales — `DataTable` agrupada por tipo de activo reutilizando
`StatementGroup.lines` que `getStatementReport` ya calcula. Columnas: logo +
nombre, cantidad, precio unitario, valor de mercado, P&L € y %, peso, y las 5
ventanas de rentabilidad. Todo importe dentro de `<SensitiveValue>`. Las líneas
`valuedAtCost` muestran sus ventanas como «—».

El PDF/XLSX del extracto **no cambia** en esta misión (ya lleva su propio
desglose; las ventanas quedan como posible mejora posterior).

---

## 4 · Frescura de precios en Extracto

- Badge en la cabecera del Extracto: «Precios a DD MMM · HH:MM», donde el
  instante es `max(pricedAt)` de los últimos precios de los activos en cartera
  (lectura añadida en `src/server/statement.ts` o `returns.ts`). Variante
  warning cuando supera ~36 h (sync caído o mercado cerrado demasiado tiempo).
- En la tabla nueva del punto 3: las líneas cuya fecha de último precio va
  retrasada > 1 día respecto al global (típico FT/fondos) muestran un indicador
  con tooltip con su fecha concreta.
- `/assets` ya tiene frescura por activo (`FreshnessCell`); no se toca salvo el
  mapeo del punto 1.

---

## Transversal

- **Migración única** para `tradingview_symbol` + `logo_url` (drizzle-kit
  generate; nunca editar migraciones pasadas).
- **Tests** (vitest, red stubbeada): `tradingview.test.ts` (batch, símbolos
  desconocidos omitidos, history rechaza), fallback en `price-sync` y
  `watchlist-sync` (Yahoo falla → TV rescata → source correcto), `returns.test.ts`
  (ventanas, conversión FX, YTD, sin profundidad → null), backfill (validación
  scanner, idempotencia).
- **Zod** actualizado para `priceSource='tradingview'` y `logoUrl` en
  create/updateAsset; mutaciones con `audit_events` + `revalidatePath` como
  siempre.
- **UI** verificada en dark y light; skeletons para la tabla nueva.
- **Deploy**: hay migración → backup → `pnpm db:migrate` → build → `launchctl
  kickstart` (launchd no auto-migra).
- **Definition of Done** del CLAUDE.md aplica íntegra.
