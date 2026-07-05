# Vertical de patrimonio inmobiliario (`/real-estate`)

**Fecha:** 2026-07-05
**Estado:** aprobado por el Comandante

## Objetivo

Nueva vertical autónoma para registrar inmuebles en propiedad (vivienda habitual con hipoteca como caso motivador) de forma que el patrimonio total de la app incorpore el **equity** del inmueble: `valor vigente − capital pendiente de la hipoteca`. El dinero de la compra es liquidez externa que la app nunca vio — la vertical **no toca caja, cuentas ni posiciones**: todo entra de cero y desde el alta el patrimonio solo puede subir (amortización mensual + revalorizaciones manuales).

Principios acordados:

- **Balance honesto**: activo = valor del inmueble; pasivo = **solo el capital vivo**. Los intereses futuros no son deuda patrimonial — se muestran como dato informativo (coste total del préstamo), jamás computan en patrimonio.
- **Valor del inmueble**: entra al **precio de compra** y es actualizable con valoraciones manuales fechadas (tasación, reforma). Sin revalorización automática.
- **Costes de compra** (ITP/AJD, notaría, registro, gestoría, tasación): se registran como dato — coste de adquisición fiscal = precio + costes, derivado — pero no afectan a ningún cálculo de la app.
- **Account-agnostic**: entidades de primer nivel, sin `accountId`. Preparado para N inmuebles.
- **Todo EUR**, sin FX (columnas `*Eur` simples, sin par nativo).
- **Ejemplo canónico** (números del Comandante): casa 193 000 €, costes 4 000 €, hipoteca 150 000 € ⇒ el día de la compra el patrimonio sube **+43 000 €** (la entrada). Los 4k no restan (gasto externo ya consumido); coste de adquisición fiscal = 197 000 €.

## Modelo de datos (`src/db/schema/`)

Cuatro tablas nuevas, ids ULID, migración generada con drizzle-kit. Valores de enum en inglés en DB con mapa de etiquetas en español en UI.

### `properties`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text | ULID |
| `name` | text NOT NULL | «Vivienda habitual» |
| `address` | text NULL | |
| `purchaseDate` | text NOT NULL | ISO `yyyy-MM-dd` |
| `purchasePriceEur` | real NOT NULL | 193 000 |
| `purchaseCostsEur` | real NOT NULL DEFAULT 0 | total ITP+notaría+… |
| `notes` | text NULL | |
| `createdAt` | | patrón `_shared` |

### `mortgages`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text | ULID |
| `propertyId` | text NOT NULL FK → properties (cascade) | |
| `lender` | text NULL | banco |
| `principalEur` | real NOT NULL | capital solicitado, 150 000 |
| `rateType` | text NOT NULL | `fixed` \| `variable` \| `mixed` |
| `nominalRatePct` | real NOT NULL | **TIN** anual (la TAE queda fuera: mezcla seguros/comisiones que no son el préstamo) |
| `termMonths` | integer NOT NULL | |
| `firstPaymentDate` | text NOT NULL | ISO, primera cuota |
| `spreadPct` | real NULL | solo variable/mixta |
| `referenceIndex` | text NULL | p. ej. `euribor12m`; solo variable/mixta |
| `createdAt` | | |

Cardinalidad v1: 0..1 hipoteca por inmueble (compra al contado = sin fila en `mortgages`).

### `mortgage_events`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text | ULID |
| `mortgageId` | text NOT NULL FK → mortgages (cascade) | |
| `eventDate` | text NOT NULL | ISO |
| `type` | text NOT NULL | `early_repayment` \| `rate_change` |
| `amountEur` | real NULL | obligatorio en `early_repayment` |
| `mode` | text NULL | `reduce_term` \| `reduce_installment` — obligatorio en `early_repayment` |
| `newRatePct` | real NULL | obligatorio en `rate_change` (revisión Euríbor, novación) |
| `note` | text NULL | |
| `createdAt` | | |

### `property_valuations`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text | ULID |
| `propertyId` | text NOT NULL FK → properties (cascade) | |
| `valuationDate` | text NOT NULL | ISO |
| `valueEur` | real NOT NULL | |
| `note` | text NULL | «tasación», «reforma cocina» |
| `createdAt` | | |

Valor vigente a fecha F = última valoración con `valuationDate ≤ F`; sin ninguna ⇒ `purchasePriceEur`.

## Motor de cálculo — `src/lib/mortgage.ts` (funciones puras, sin DB)

Una sola fuente de verdad: el cuadro se **deriva siempre** de `mortgage` + `mortgage_events` ordenados; nada derivado se persiste.

- `buildSchedule(mortgage, events)` → filas `{ index, date, paymentEur, interestEur, principalEur, remainingEur }` por sistema **francés**: cuota = `P·r / (1 − (1+r)^−n)` con `r = TIN/12`. Cada evento recalcula desde su fecha sobre el capital pendiente en ese punto:
  - `early_repayment` + `reduce_installment`: mismo vencimiento, nueva cuota.
  - `early_repayment` + `reduce_term`: misma cuota, menos meses (última cuota residual).
  - `rate_change`: nuevo TIN sobre pendiente y meses restantes.
- `outstandingAt(schedule, date)` → capital vivo a cualquier fecha (antes de la primera cuota ⇒ principal íntegro; después de la última ⇒ 0).
- `currentValueAt(property, valuations, date)` → valor vigente (forward-fill, fallback precio de compra).
- `equityAt(...)` = `currentValueAt − outstandingAt`.
- Derivados informativos: intereses totales del cuadro vigente (⇒ coste total del préstamo), intereses pagados vs restantes, fecha de fin, desglose de la próxima cuota.

Al ser puro es importable desde cliente: el formulario de alta calcula la **cuota en vivo** mientras se teclea (contrastable con la FEIN antes de guardar).

Consecuencia clave: `equityAt(fecha)` es calculable para **cualquier** día pasado o futuro ⇒ ni snapshots diarios ni cron. Esta vertical no habla con el exterior.

## Capa de datos

- **Lecturas** — `src/server/realEstate.ts`: `getRealEstateSummary()` (por inmueble: valor vigente, capital pendiente, equity, % en propiedad, cuota, próxima cuota desglosada, TIN, fin, intereses pagados/restantes, coste total del préstamo; más el agregado global `totalEquityEur`), `getSchedule(propertyId)`, `getEquitySeries(from, to)` para gráficas.
- **Mutaciones** — `src/actions/realEstate.ts`, disciplina estándar de la casa (Zod al entrar, `db.transaction()`, fila en `audit_events` con `previousJson`/`nextJson`, `revalidatePath` de rutas afectadas — `/real-estate`, overview, `/statement` —, resultado discriminado `{ ok } | { ok: false, error }`):
  - `createProperty` — inmueble + hipoteca opcional en **una transacción**.
  - `updateProperty`, `deleteProperty` (cascade; `ConfirmModal`).
  - `addValuation`, `deleteValuation` (`ConfirmModal`).
  - `addMortgageEvent`, `deleteMortgageEvent` (`ConfirmModal`).
  - Validaciones Zod destacadas: importes > 0, `termMonths ≥ 1`, TIN ≥ 0, `early_repayment.amountEur` < pendiente a la fecha del evento, fechas de evento ≥ `firstPaymentDate` del préstamo, campos condicionales por `type`/`rateType`.

## UI

**Navegación**: entrada «Inmuebles» en la barra lateral → ruta **`/real-estate`** (ruta en inglés, UI íntegra en español). Todo importe dentro de `<SensitiveValue>`; ceros ocultos; skeletons con `StatesBlock`; dark y light verificados.

**Dashboard** (DB vacía ⇒ `StatesBlock` vacío con CTA «Registrar inmueble»). Por inmueble:

1. **Card de KPIs** (patrón de celdas divididas): Valor actual · Capital pendiente · **Equity** (protagonista: es lo que suma al patrimonio) · % en propiedad con barra de progreso.
2. **Card de hipoteca**: cuota mensual, próxima cuota con desglose interés/capital, TIN, plazo restante, fecha de fin, intereses pagados vs restantes, **coste total del préstamo**. Botones «Amortización anticipada» y «Revisión de tipo» → modales con **preview del efecto** (nueva cuota o nueva fecha de fin) antes de confirmar.
3. **Gráfica de evolución** (Recharts, colores por variables CSS del tema): serie de capital pendiente ↓ y equity ↑ desde la compra hasta el fin del cuadro; pasado sólido, **futuro proyectado en discontinua**; valoraciones manuales como escalones del equity.
4. **Cuadro de amortización** (`DataTable`): agrupado por años, expandible a meses (cuota/interés/capital/pendiente), fila del mes actual resaltada, eventos intercalados en su fecha.
5. **Historial de valoraciones**: fecha, valor, nota; botón «Actualizar valor».

**Alta** (Modal): bloque inmueble (nombre, dirección, fecha, precio, costes, notas) + bloque hipoteca con toggle (al contado posible): banco, capital, tipo, TIN, plazo, primera cuota; cuota calculada en vivo.

## Integraciones

- **Overview**: patrimonio total = líquido + invertido + **inmobiliario** (equity agregado), con la tercera componente en el desglose del KPI. La curva de evolución incorpora `equityAt(fecha)` por punto de la serie — retroactivo, sin snapshots. **Las métricas de rentabilidad (P&L latente, retornos) siguen calculándose exclusivamente sobre líquido/invertido**: la casa suma patrimonio pero no contamina el rendimiento inversor.
- **Extracto** (`/statement`, PDF y md): sección nueva «Inmuebles» — inmueble, valor vigente **con la fecha de su valoración** (transparencia estilo `pricesAsOf`), capital pendiente, equity. Suma al patrimonio total del extracto. Compatible con el extracto `asOf` (todo es derivable a fecha).
- **Telegram `/net`**: línea `🏠 Inmobiliario: <equity>` y total ajustado (el daemon lee los mismos helpers de `src/server/`).
- **Asesor IA**: el contexto incorpora el resumen inmobiliario (capital pendiente, TIN, cuota, intereses restantes, equity) para responder con números reales a «¿amortizo o invierto?».
- **Simulador FIRE**: **excluido a propósito**. La vivienda habitual no es capital invertible; la regla del 4 % solo tiene sentido sobre líquido/invertido. No tocar el prerrelleno.

## Tests (vitest, sin red)

- `src/lib/__tests__/mortgage.test.ts` — el grueso: cuadro francés contra valores conocidos (150k, TIN 2,5 %, 25 años ⇒ cuota ≈ 672,93 €; desglose primera cuota ≈ 312,50 € interés / 360,43 € capital; suma de capital del cuadro = principal al céntimo), amortización anticipada en ambos modos, `rate_change` a mitad de vida, eventos encadenados, `outstandingAt` en fronteras (antes de primera cuota, después de la última), `equityAt` con y sin valoraciones (fallback precio de compra), redondeos estables a 2 decimales.
- `src/server/__tests__/realEstate.test.ts` — lecturas contra DB de test siguiendo el patrón existente; agregado con 0, 1 y N inmuebles; inmueble sin hipoteca (equity = valor vigente).
- Acciones: validación Zod (rechazos), transaccionalidad del alta inmueble+hipoteca, audit event escrito.
- Overview/statement: el equity suma al total y **no** altera P&L ni retornos.

## Fuera de alcance v1 (anotado, no construir)

- Venta del inmueble (dará para su propio diseño: baja, resultado, fiscalidad).
- Alquileres / rentas.
- Recálculo automático de Euríbor para hipotecas variables (la estructura de eventos lo soporta; la automatización no se construye).
- Impuestos recurrentes (IBI, comunidad) y seguros: gastos externos, fuera de la app.

## Criterios de aceptación

1. Alta del ejemplo canónico ⇒ overview sube exactamente +43 000 € de patrimonio; P&L y retornos idénticos a antes del alta.
2. El cuadro de amortización coincide con un simulador bancario estándar para los mismos parámetros.
3. Una amortización anticipada con preview muestra el efecto correcto en cuota o plazo y, confirmada, el equity refleja el nuevo pendiente.
4. Una valoración manual posterior mueve el valor vigente y el equity desde su fecha (escalón en la gráfica), sin tocar el cuadro.
5. Extracto (PDF y md) y Telegram `/net` muestran la sección/línea inmobiliaria; simulador FIRE inalterado.
6. DB vacía ⇒ `/real-estate` muestra estado vacío limpio; el resto de la app no cambia.
