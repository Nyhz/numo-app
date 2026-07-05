# Extracto a fecha concreta + formato Markdown + PDF profesional

**Fecha:** 2026-07-05
**Estado:** aprobado por el Comandante

## Objetivo

Tres entregas sobre la página `/statement` y su subsistema de exportación:

1. **Extracto «a día de»**: generar el extracto reconstruido a una fecha pasada concreta, con valores exactos al céntimo — lo que `/statement` mostraba ese día.
2. **Formato Markdown**: nuevo formato `.md` en el listado de exportaciones.
3. **PDF profesional**: arreglar el solape de la sección 2 («Composición de la cartera» pisa la sección 3), dar más tamaño y aire al documento, y eliminar los subtítulos didácticos. Calidad «para enseñar en un banco».

Alcance acotado: la fecha aplica **solo a las exportaciones** (menú «Generar extracto»). La vista de la página sigue mostrando el estado actual.

## A. Extracto a fecha (`asOf`)

### Núcleo — `src/server/statement.ts`

`getStatementReport(db?, opts?: { asOf?: string })` acepta una fecha ISO `YYYY-MM-DD`. Corte = fin de día **local** (`${asOf}T23:59:59.999`).

- **Cantidades y coste**: replay de `asset_transactions` con `tradedAt ≤ corte`, con la misma media ponderada que `recomputeAssetPosition` (compras suman `bruto + comisiones` al pool de coste; ventas reducen el pool proporcionalmente a la fracción vendida; cantidad ≤ 0 ⇒ posición cerrada, fuera del extracto).
- **Anti-duplicación**: la matemática del fold se extrae a un helper puro compartido `foldLedger(rows)` en `src/server/recompute.ts`, consumido por `recomputeAssetPosition` (escritura) y por el camino as-of (lectura). Una sola fuente de verdad para el coste medio.
- **Precio**: última fila de `asset_valuations` con `valuationDate ≤ asOf` por activo. `marketValueEur = cantidad(asOf) × unitPriceEur`. `valuationDate` de la línea = la fecha de esa valoración (transparencia del forward-fill). Activo sin valoración a esa fecha ⇒ `unitPriceEur`/`marketValueEur`/`pnl*` a `null`, igual que hoy.
- **Efectivo**: por cuenta cash-bearing, `openingBalanceEur + Σ cash_movements.cashImpactEur` con `affectsCashBalance = true` y `occurredAt ≤ corte` (fórmula de `recomputeAccountCashBalance` acotada). Cuentas no cash-bearing: 0.
- **Cuentas incluidas**: una cuenta entra en el extracto as-of si existía a la fecha (`createdAt ≤ corte`) **o** tiene algún movimiento/trade ≤ corte (cubre backfills con `createdAt` posterior).
- **Cuenta principal por activo** (`invertido` por cuenta): mismo criterio actual — cuenta del trade más reciente — pero evaluado sobre los trades ≤ corte.
- **Tipo**: `StatementReport` gana `asOf: string | null`. `generatedAt` sigue siendo `Date.now()`.
- **Sin `asOf`**: comportamiento idéntico al actual (lee `asset_positions` / `accounts` materializados). Cero regresión.

### Ruta — `src/app/api/exports/statement/route.ts`

- Nuevo query param `asOf=YYYY-MM-DD`. Validación: regex + fecha real de calendario + no futura. Inválida ⇒ 400.
- Nombre de fichero: usa `asOf` cuando está presente (`statement-2026-03-31.pdf`), si no la fecha de generación (comportamiento actual).
- La serie del gráfico de evolución del PDF se recorta a `date ≤ asOf`.

### UI — `StatementExportMenu.tsx`

- `<input type="date">` encima de la lista de formatos, por defecto hoy, `max` = hoy.
- Si la fecha elegida ≠ hoy, cada enlace añade `&asOf=YYYY-MM-DD`.
- Etiqueta del menú clara («Extracto a día de…»). Sin dinero renderizado ⇒ no aplica `<SensitiveValue>`.

## B. Formato Markdown

- `src/lib/exports/statement-md.ts` → `buildStatementMd(report: StatementReport): string`.
- Contenido espejo del CSV en Markdown legible: título con la fecha del extracto, bloque de KPIs (patrimonio, efectivo, invertido, coste, plusvalía latente € y %), una tabla por tipo de activo con filas y subtotal, tabla de cuentas, línea final de patrimonio total.
- Números en formato es-ES (coma decimal), importes a 2 decimales, columnas numéricas alineadas a la derecha (`---:`).
- Ruta: `md` entra en `FORMATS`; respuesta `text/markdown; charset=utf-8` con `content-disposition: attachment; filename="statement-<fecha>.md"`.
- Menú: nuevo item «Markdown (.md)».

## C. PDF profesional — `src/lib/pdf/statement-report.ts` (+ `_kit.ts` si hace falta)

1. **Fix del solape (bug)**: la sección 2 avanza `cur.y` con `Math.max(116, 26 + grupos × 16)`, ignorando la altura de la columna derecha «Valor por cuenta» (~18 + nCuentas × 24 + leyenda). Corrección: avanzar por el **máximo real** de ambas columnas.
2. **Aire y tamaño**: filas de tabla 14 → 17 pt y cuerpo ~7.5 → 8.5 pt (cabeceras y subtotales en proporción); más separación vertical entre secciones; donut y gráfico de evolución más grandes; márgenes/composición revisados para que respire.
3. **Tono profesional**: eliminar los subtítulos didácticos de las tarjetas KPI («no tributa hasta vender», «comisiones de compra incluidas»); la tarjeta de plusvalía conserva el porcentaje (dato, no didáctica) y la de patrimonio su desglose efectivo/invertido. El «% de lo invertido» de las cabeceras de grupo se mantiene: es información, no didáctica. Cabecera y pie sobrios.
4. **as-of**: con `asOf`, la cabecera titula «Extracto a <fecha>» y el pie mantiene la fecha de generación.

## Tests

- `src/server/__tests__/statement.test.ts`:
  - Compra posterior al corte no cuenta (cantidad y coste).
  - Venta parcial antes del corte reduce el pool proporcionalmente (paridad con `recomputeAssetPosition` vía `foldLedger`).
  - Selección de valoración: se usa la última ≤ fecha, no una posterior.
  - Efectivo acotado por `occurredAt`.
  - `asOf` = hoy ≡ sin `asOf` (mismos totales).
  - Posición cerrada a la fecha no aparece; posición abierta a la fecha pero cerrada hoy sí aparece.
- `src/lib/exports/__tests__/`: snapshot/estructura de `buildStatementMd` (KPIs, subtotales, formato es-ES).
- Ruta: validación de `asOf` inválida/futura ⇒ 400.

## Verificación (Definition of Done)

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` en verde.
- PDF generado con datos reales y revisado visualmente (sin solape, aire correcto, sin subtítulos didácticos).
- `.md` generado y renderizado correctamente.
- Extracto as-of contrastado contra los totales actuales para `asOf` = hoy.
- Sin migraciones (no hay columnas nuevas), sin env vars nuevas.

## Fuera de alcance

- La vista de `/statement` a fecha pasada (KPIs, donuts, riesgo).
- Historial de composición sectorial/geográfica/objetivos (no existe snapshot diario).
- El export `account-statement` (por cuenta) — no cambia.
