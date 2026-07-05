# Vertical de patrimonio inmobiliario — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vertical `/real-estate` autónoma (inmuebles + hipoteca francesa derivada de eventos) cuyo equity suma al patrimonio en overview, extracto, Telegram y asesor — sin tocar caja, cuentas, posiciones ni métricas de rentabilidad.

**Architecture:** 4 tablas nuevas (properties, mortgages, mortgage_events, property_valuations); motor puro de amortización en `src/lib/mortgage.ts` (el cuadro se deriva siempre de hipoteca+eventos, nada derivado se persiste); lecturas en `src/server/realEstate.ts`; mutaciones en `src/actions/realEstate.ts`; UI en `src/app/real-estate/` + `src/components/features/real-estate/`.

**Tech Stack:** Next 16 App Router, Drizzle + better-sqlite3 (síncrono: `.get()/.all()/.run()`), Zod, vitest, Recharts, Tailwind v4, ULID.

**Spec:** `docs/superpowers/specs/2026-07-05-real-estate-vertical-design.md` — léelo antes de empezar.

## Global Constraints

- TypeScript strict; sin `any` sin comentario. `type` sobre `interface`. Tipos de fila con `typeof table.$inferSelect`.
- Todo importe en EUR (sufijo `*Eur`); esta vertical NO usa FX. Redondeo con `roundEur` de `src/lib/money.ts`.
- ids: `import { ulid } from "ulid"` — nunca autoincrement.
- Sin SQL crudo; solo query builder Drizzle. Migraciones con `pnpm db:generate`, nunca editar migraciones pasadas.
- Acciones: `"use server"`, firma `(input: unknown, db: DB = defaultDb): Promise<ActionResult<T>>`, Zod `safeParse` al entrar, `db.transaction((tx) => …)` síncrono, fila `auditEvents` inline en la tx (`contextJson: JSON.stringify({ actor: ACTOR })`), revalidación vía helper de `src/actions/_shared.ts`, retorno discriminado — nunca throw hacia fuera.
- Lecturas: último parámetro `db: DB = defaultDb`, import `{ db as defaultDb, type DB } from "../db/client"`.
- UI en español (valores enum en inglés en DB con mapa de etiquetas); ruta en inglés `/real-estate`. Todo importe dentro de `<SensitiveValue>`. Primitivas obligatorias: `Button`, `Modal`, `ConfirmModal`, `DataTable`, `StatesBlock`, `Card`. Destructivos con `ConfirmModal`. Skeletons, no spinners. Colores de chart vía `hsl(var(--chart-N))`.
- Tests: vitest sin red; `makeDb()` inline (`:memory:` + `migrate` desde `drizzle/`); imports explícitos de vitest. Mock `next/cache` al importar acciones.
- El equity inmobiliario NUNCA entra en P&L latente, `performanceIndex` ni XIRR — solo en totales de patrimonio.
- Antes de cerrar cada tarea: `pnpm typecheck` limpio. Antes de cerrar el plan: typecheck + lint + test + build + smoke DB vacía + verificación visual dark/light.
- Commits frecuentes, mensajes estilo del repo: `feat(real-estate): …` en español.

## Mapa de ficheros

```
src/db/schema/properties.ts            (crear) tabla inmuebles
src/db/schema/mortgages.ts             (crear) tabla hipotecas + RATE_TYPES
src/db/schema/mortgage_events.ts       (crear) eventos + MORTGAGE_EVENT_TYPES/EARLY_REPAYMENT_MODES
src/db/schema/property_valuations.ts   (crear) valoraciones manuales
src/db/schema/index.ts                 (modificar) 4 exports nuevos
drizzle/00XX_*.sql                     (generar) migración
src/lib/mortgage.ts                    (crear) motor puro: cuadro francés + eventos + equity
src/lib/__tests__/mortgage.test.ts     (crear) tests del motor
src/server/realEstate.ts               (crear) lecturas: overview, equity por fecha, líneas extracto
src/server/__tests__/realEstate.test.ts (crear)
src/actions/realEstate.ts              (crear) 7 acciones
src/actions/realEstate.schema.ts       (crear) esquemas Zod
src/actions/_shared.ts                 (modificar) revalidateRealEstate()
src/actions/__tests__/realEstate.test.ts (crear)
src/server/overview.ts                 (modificar) KPI + serie
src/app/page.tsx                       (modificar) desglose KPI
src/components/features/overview/NetWorthChart.tsx (modificar) suma equity al área
src/server/statement.ts                (modificar) sección + total
src/lib/exports/statement-md.ts        (modificar) fila resumen + sección
src/lib/pdf/statement-report.ts        (modificar) statCard sub + sección
scripts/tg-net.ts                      (modificar) línea inmobiliario
src/server/advisor.ts                  (modificar) bloque contexto
src/components/layout/SideNav.tsx      (modificar) entrada «Inmuebles»
src/app/real-estate/page.tsx           (crear)
src/components/features/real-estate/RealEstateDashboard.tsx (crear)
src/components/features/real-estate/CreatePropertyModal.tsx (crear)
src/components/features/real-estate/PropertySection.tsx     (crear)
src/components/features/real-estate/PropertyKpiCells.tsx    (crear)
src/components/features/real-estate/MortgageCard.tsx        (crear)
src/components/features/real-estate/EarlyRepaymentModal.tsx (crear)
src/components/features/real-estate/RateChangeModal.tsx     (crear)
src/components/features/real-estate/ValuationsCard.tsx      (crear)
src/components/features/real-estate/EquityChart.tsx         (crear)
src/components/features/real-estate/AmortizationTable.tsx   (crear)
SPEC.md                                (modificar) ruta + entidades
```

---

### Task 1: Esquema y migración

**Files:**
- Create: `src/db/schema/properties.ts`, `src/db/schema/mortgages.ts`, `src/db/schema/mortgage_events.ts`, `src/db/schema/property_valuations.ts`
- Modify: `src/db/schema/index.ts`
- Generate: `drizzle/00XX_*.sql` (vía `pnpm db:generate`)

**Interfaces:**
- Produces: tablas `properties`, `mortgages`, `mortgageEvents`, `propertyValuations`; tipos `Property`, `Mortgage`, `MortgageEvent`, `PropertyValuation` (+ `New*`); constantes `RATE_TYPES`, `RateType`, `MORTGAGE_EVENT_TYPES`, `MortgageEventType`, `EARLY_REPAYMENT_MODES`, `EarlyRepaymentMode` — todo exportado por barrel `src/db/schema`.

- [ ] **Step 1: Crear los 4 ficheros de esquema**

`src/db/schema/properties.ts`:

```ts
import { real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

/**
 * Inmuebles en propiedad (vivienda habitual, etc.). Vertical autónoma:
 * sin accountId — no toca caja ni posiciones. El coste de adquisición
 * fiscal (precio + costes) se deriva, no se guarda. Ver spec 2026-07-05.
 */
export const properties = sqliteTable("properties", {
  id: idCol(),
  name: text("name").notNull(),
  address: text("address"),
  purchaseDate: text("purchase_date").notNull(), // ISO yyyy-MM-dd
  purchasePriceEur: real("purchase_price_eur").notNull(),
  purchaseCostsEur: real("purchase_costs_eur").notNull().default(0),
  notes: text("notes"),
  createdAt: createdAtCol(),
  updatedAt: updatedAtCol(),
});

export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;
```

`src/db/schema/mortgages.ts`:

```ts
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";
import { properties } from "./properties";

export const RATE_TYPES = ["fixed", "variable", "mixed"] as const;
export type RateType = (typeof RATE_TYPES)[number];

/**
 * 0..1 hipoteca por inmueble (v1). El cuadro de amortización NUNCA se
 * persiste: se deriva de esta fila + mortgage_events (src/lib/mortgage.ts).
 * El tipo es TIN (nominal); la TAE queda fuera a propósito.
 */
export const mortgages = sqliteTable(
  "mortgages",
  {
    id: idCol(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    lender: text("lender"),
    principalEur: real("principal_eur").notNull(),
    rateType: text("rate_type").notNull().$type<RateType>(),
    nominalRatePct: real("nominal_rate_pct").notNull(),
    termMonths: integer("term_months", { mode: "number" }).notNull(),
    firstPaymentDate: text("first_payment_date").notNull(), // ISO yyyy-MM-dd
    spreadPct: real("spread_pct"),
    referenceIndex: text("reference_index"),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    propertyIdx: index("mortgages_property_idx").on(t.propertyId),
  }),
);

export type Mortgage = typeof mortgages.$inferSelect;
export type NewMortgage = typeof mortgages.$inferInsert;
```

`src/db/schema/mortgage_events.ts`:

```ts
import { index, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol } from "./_shared";
import { mortgages } from "./mortgages";

export const MORTGAGE_EVENT_TYPES = ["early_repayment", "rate_change"] as const;
export type MortgageEventType = (typeof MORTGAGE_EVENT_TYPES)[number];

export const EARLY_REPAYMENT_MODES = ["reduce_term", "reduce_installment"] as const;
export type EarlyRepaymentMode = (typeof EARLY_REPAYMENT_MODES)[number];

/**
 * Historial auditable de la hipoteca. Cada evento recalcula el cuadro
 * desde su fecha. early_repayment exige amountEur+mode; rate_change
 * exige newRatePct (revisión Euríbor / novación).
 */
export const mortgageEvents = sqliteTable(
  "mortgage_events",
  {
    id: idCol(),
    mortgageId: text("mortgage_id")
      .notNull()
      .references(() => mortgages.id, { onDelete: "cascade" }),
    eventDate: text("event_date").notNull(), // ISO yyyy-MM-dd
    type: text("type").notNull().$type<MortgageEventType>(),
    amountEur: real("amount_eur"),
    mode: text("mode").$type<EarlyRepaymentMode>(),
    newRatePct: real("new_rate_pct"),
    note: text("note"),
    createdAt: createdAtCol(),
  },
  (t) => ({
    mortgageIdx: index("mortgage_events_mortgage_idx").on(t.mortgageId, t.eventDate),
  }),
);

export type MortgageEvent = typeof mortgageEvents.$inferSelect;
export type NewMortgageEvent = typeof mortgageEvents.$inferInsert;
```

`src/db/schema/property_valuations.ts`:

```ts
import { real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol } from "./_shared";
import { properties } from "./properties";

/**
 * Valoraciones manuales fechadas (tasación, reforma). Valor vigente a
 * fecha F = última valoración ≤ F; sin ninguna ⇒ purchasePriceEur.
 */
export const propertyValuations = sqliteTable(
  "property_valuations",
  {
    id: idCol(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    valuationDate: text("valuation_date").notNull(), // ISO yyyy-MM-dd
    valueEur: real("value_eur").notNull(),
    note: text("note"),
    createdAt: createdAtCol(),
  },
  (t) => ({
    propertyDateIdx: uniqueIndex("property_valuations_property_date_idx").on(
      t.propertyId,
      t.valuationDate,
    ),
  }),
);

export type PropertyValuation = typeof propertyValuations.$inferSelect;
export type NewPropertyValuation = typeof propertyValuations.$inferInsert;
```

- [ ] **Step 2: Exportar en el barrel** — añadir al final de `src/db/schema/index.ts`:

```ts
export * from "./properties";
export * from "./mortgages";
export * from "./mortgage_events";
export * from "./property_valuations";
```

- [ ] **Step 3: Generar la migración**

Run: `pnpm db:generate`
Expected: nuevo fichero `drizzle/00XX_<palabras>.sql` con los 4 `CREATE TABLE` (número siguiente al último existente; a fecha del plan el último es `0026`). No editar el SQL a mano.

- [ ] **Step 4: Verificar que la migración aplica en un DB fresco**

Run: `pnpm test src/server/__tests__/server.test.ts`
Expected: PASS — la suite existente crea `:memory:` + `migrate` sobre `drizzle/`, así que valida la migración nueva de gratis.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: 0 errores.

```bash
git add src/db/schema drizzle
git commit -m "feat(real-estate): esquema de inmuebles, hipotecas, eventos y valoraciones"
```

---

### Task 2: Motor puro — cuadro francés base

**Files:**
- Create: `src/lib/mortgage.ts`
- Test: `src/lib/__tests__/mortgage.test.ts`

**Interfaces:**
- Consumes: `roundEur` de `src/lib/money.ts`.
- Produces: `type MortgageTerms = { principalEur: number; nominalRatePct: number; termMonths: number; firstPaymentDate: string }`; `type ScheduleRow = { index: number; date: string; kind: "payment" | "early_repayment"; paymentEur: number; interestEur: number; principalEur: number; remainingEur: number; ratePct: number }`; `annuityPayment(principalEur, annualRatePct, months): number`; `addMonthsIso(iso, n): string`; `buildSchedule(terms, events?): ScheduleRow[]`; `outstandingAt(terms, rows, dateIso): number`; `summarizeSchedule(terms, rows): ScheduleSummary` con `type ScheduleSummary = { paymentsCount: number; endDate: string | null; totalInterestEur: number; totalPaidEur: number; totalLoanCostEur: number }`.

Regla de redondeo: `remaining` se lleva como libro mayor **ya redondeado** (`roundEur` en cada paso) para que `Σ principalEur === principal` exacto al céntimo; la última cuota absorbe el residuo.

- [ ] **Step 1: Test que falla**

`src/lib/__tests__/mortgage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addMonthsIso,
  annuityPayment,
  buildSchedule,
  outstandingAt,
  summarizeSchedule,
  type MortgageTerms,
} from "../mortgage";

// Caso canónico del spec: 150k, TIN 2,5 %, 25 años.
const CANON: MortgageTerms = {
  principalEur: 150_000,
  nominalRatePct: 2.5,
  termMonths: 300,
  firstPaymentDate: "2026-09-01",
};

describe("annuityPayment", () => {
  it("caso canónico ≈ 672,93 €", () => {
    expect(annuityPayment(150_000, 2.5, 300)).toBeCloseTo(672.93, 2);
  });
  it("tipo 0 % ⇒ principal / meses", () => {
    expect(annuityPayment(1200, 0, 12)).toBe(100);
  });
});

describe("addMonthsIso", () => {
  it("suma meses conservando el día", () => {
    expect(addMonthsIso("2026-09-01", 1)).toBe("2026-10-01");
    expect(addMonthsIso("2026-09-01", 299)).toBe("2051-08-01");
  });
  it("recorta al último día del mes", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("buildSchedule — sin eventos", () => {
  const rows = buildSchedule(CANON);

  it("300 cuotas y primera cuota exacta", () => {
    expect(rows).toHaveLength(300);
    expect(rows[0]).toMatchObject({
      index: 1,
      date: "2026-09-01",
      kind: "payment",
      paymentEur: 672.93,
      interestEur: 312.5,
      principalEur: 360.43,
      remainingEur: 149_639.57,
    });
  });

  it("el capital amortizado suma el principal al céntimo y acaba en 0", () => {
    const total = rows.reduce((s, r) => s + r.principalEur, 0);
    expect(Math.round(total * 100) / 100).toBe(150_000);
    expect(rows[rows.length - 1].remainingEur).toBe(0);
  });

  it("summarizeSchedule cuadra pagos = principal + intereses", () => {
    const s = summarizeSchedule(CANON, rows);
    expect(s.paymentsCount).toBe(300);
    expect(s.endDate).toBe("2051-08-01");
    expect(s.totalPaidEur).toBeCloseTo(150_000 + s.totalInterestEur, 1);
    expect(s.totalLoanCostEur).toBeCloseTo(150_000 + s.totalInterestEur, 2);
  });
});

describe("outstandingAt", () => {
  const rows = buildSchedule(CANON);
  it("antes de la primera cuota ⇒ principal íntegro", () => {
    expect(outstandingAt(CANON, rows, "2026-08-15")).toBe(150_000);
  });
  it("entre cuotas ⇒ pendiente de la última cuota pagada", () => {
    expect(outstandingAt(CANON, rows, "2026-09-15")).toBe(149_639.57);
  });
  it("después de la última ⇒ 0", () => {
    expect(outstandingAt(CANON, rows, "2060-01-01")).toBe(0);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test src/lib/__tests__/mortgage.test.ts`
Expected: FAIL — `Cannot find module '../mortgage'`.

- [ ] **Step 3: Implementación**

`src/lib/mortgage.ts`:

```ts
// Motor puro de hipoteca francesa. Sin DB, sin red, sin Date.now():
// todo se deriva de los términos + eventos, para cualquier fecha pasada
// o futura. Importable desde cliente (cuota en vivo en formularios).
import { roundEur } from "./money";

export type MortgageTerms = {
  principalEur: number;
  /** TIN anual en %, p. ej. 2.5 */
  nominalRatePct: number;
  termMonths: number;
  /** ISO yyyy-MM-dd de la primera cuota */
  firstPaymentDate: string;
};

export type MortgageScheduleEvent =
  | {
      type: "early_repayment";
      eventDate: string;
      amountEur: number;
      mode: "reduce_term" | "reduce_installment";
    }
  | { type: "rate_change"; eventDate: string; newRatePct: number };

export type ScheduleRow = {
  index: number;
  date: string;
  kind: "payment" | "early_repayment";
  paymentEur: number;
  interestEur: number;
  principalEur: number;
  /** Capital vivo tras esta fila */
  remainingEur: number;
  /** TIN vigente en esta fila */
  ratePct: number;
};

export type ScheduleSummary = {
  paymentsCount: number;
  endDate: string | null;
  totalInterestEur: number;
  totalPaidEur: number;
  totalLoanCostEur: number;
};

export function addMonthsIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export function annuityPayment(
  principalEur: number,
  annualRatePct: number,
  months: number,
): number {
  if (months <= 0) return principalEur;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return roundEur(principalEur / months);
  return roundEur((principalEur * r) / (1 - (1 + r) ** -months));
}

/** Tope duro anti-bucle (100 años de cuotas). */
const MAX_ROWS = 1200;

export function buildSchedule(
  terms: MortgageTerms,
  events: MortgageScheduleEvent[] = [],
): ScheduleRow[] {
  const pending = [...events].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  const rows: ScheduleRow[] = [];
  let remaining = roundEur(terms.principalEur);
  let ratePct = terms.nominalRatePct;
  let monthsLeft = terms.termMonths;
  let paymentEur = annuityPayment(remaining, ratePct, monthsLeft);
  let paymentNo = 0;
  let ev = 0;
  let index = 0;

  while (remaining > 0 && rows.length < MAX_ROWS) {
    const date = addMonthsIso(terms.firstPaymentDate, paymentNo);

    // Eventos estrictamente anteriores a la cuota de este mes. Un evento
    // fechado el mismo día de una cuota aplica DESPUÉS de esa cuota.
    while (ev < pending.length && pending[ev].eventDate < date) {
      const e = pending[ev];
      ev += 1;
      if (e.type === "rate_change") {
        ratePct = e.newRatePct;
        paymentEur = annuityPayment(remaining, ratePct, monthsLeft);
        continue;
      }
      const amount = roundEur(Math.min(e.amountEur, remaining));
      if (amount <= 0) continue;
      remaining = roundEur(remaining - amount);
      rows.push({
        index: ++index,
        date: e.eventDate,
        kind: "early_repayment",
        paymentEur: amount,
        interestEur: 0,
        principalEur: amount,
        remainingEur: remaining,
        ratePct,
      });
      if (remaining === 0) return rows;
      if (e.mode === "reduce_installment") {
        paymentEur = annuityPayment(remaining, ratePct, monthsLeft);
      }
      // reduce_term: misma cuota — el bucle termina antes por sí solo.
    }

    const interestEur = roundEur(remaining * (ratePct / 100 / 12));
    let principalPart = roundEur(paymentEur - interestEur);
    if (monthsLeft <= 1 || principalPart >= remaining) principalPart = remaining;
    if (principalPart <= 0) {
      throw new Error("mortgage: la cuota no cubre los intereses");
    }
    remaining = roundEur(remaining - principalPart);
    rows.push({
      index: ++index,
      date,
      kind: "payment",
      paymentEur: roundEur(interestEur + principalPart),
      interestEur,
      principalEur: principalPart,
      remainingEur: remaining,
      ratePct,
    });
    paymentNo += 1;
    monthsLeft -= 1;
  }
  return rows;
}

export function outstandingAt(
  terms: MortgageTerms,
  rows: ScheduleRow[],
  dateIso: string,
): number {
  let out = roundEur(terms.principalEur);
  for (const row of rows) {
    if (row.date > dateIso) break;
    out = row.remainingEur;
  }
  return out;
}

export function summarizeSchedule(
  terms: MortgageTerms,
  rows: ScheduleRow[],
): ScheduleSummary {
  const totalInterestEur = roundEur(rows.reduce((s, r) => s + r.interestEur, 0));
  const totalPaidEur = roundEur(rows.reduce((s, r) => s + r.paymentEur, 0));
  return {
    paymentsCount: rows.filter((r) => r.kind === "payment").length,
    endDate: rows.length ? rows[rows.length - 1].date : null,
    totalInterestEur,
    totalPaidEur,
    totalLoanCostEur: roundEur(terms.principalEur + totalInterestEur),
  };
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm test src/lib/__tests__/mortgage.test.ts`
Expected: PASS (todos). Si `paymentEur` difiere en ±0,01 revisa que `annuityPayment` redondee con `roundEur` y que el libro mayor `remaining` también.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mortgage.ts src/lib/__tests__/mortgage.test.ts
git commit -m "feat(real-estate): motor puro de amortización francesa (cuadro base)"
```

---

### Task 3: Motor puro — eventos, valoraciones y equity

**Files:**
- Modify: `src/lib/mortgage.ts` (añadir al final)
- Test: `src/lib/__tests__/mortgage.test.ts` (añadir describes)

**Interfaces:**
- Produces: `interestPaidUntil(rows, dateIso): number`; `nextPaymentAfter(rows, dateIso): ScheduleRow | null`; `type ValuationPoint = { valuationDate: string; valueEur: number }`; `currentValueAt(purchasePriceEur, valuations, dateIso): { valueEur: number; asOf: string | null }`; `equityAt(purchasePriceEur, valuations, terms, rows, dateIso): number` (con `terms: MortgageTerms | null`).

- [ ] **Step 1: Tests que fallan** — añadir a `src/lib/__tests__/mortgage.test.ts` (importar además `currentValueAt`, `equityAt`, `interestPaidUntil`, `nextPaymentAfter`, `type MortgageScheduleEvent`):

```ts
describe("buildSchedule — eventos", () => {
  it("early_repayment reduce_term: misma cuota, menos cuotas", () => {
    const ev: MortgageScheduleEvent[] = [
      { type: "early_repayment", eventDate: "2027-01-15", amountEur: 20_000, mode: "reduce_term" },
    ];
    const rows = buildSchedule(CANON, ev);
    const s = summarizeSchedule(CANON, rows);
    const base = summarizeSchedule(CANON, buildSchedule(CANON));
    const eventRow = rows.find((r) => r.kind === "early_repayment");
    expect(eventRow).toMatchObject({ date: "2027-01-15", principalEur: 20_000, interestEur: 0 });
    // Cuota intacta tras el evento…
    const after = rows.find((r) => r.kind === "payment" && r.date === "2027-02-01");
    expect(after?.paymentEur).toBe(672.93);
    // …pero el préstamo acaba antes y con menos intereses.
    expect(s.paymentsCount).toBeLessThan(300);
    expect(s.totalInterestEur).toBeLessThan(base.totalInterestEur);
    // El capital sigue cuadrando al céntimo (cuotas + amortización anticipada).
    const total = rows.reduce((sum, r) => sum + r.principalEur, 0);
    expect(Math.round(total * 100) / 100).toBe(150_000);
  });

  it("early_repayment reduce_installment: cuota menor, mismo vencimiento", () => {
    const ev: MortgageScheduleEvent[] = [
      { type: "early_repayment", eventDate: "2027-01-15", amountEur: 20_000, mode: "reduce_installment" },
    ];
    const rows = buildSchedule(CANON, ev);
    const s = summarizeSchedule(CANON, rows);
    const after = rows.find((r) => r.kind === "payment" && r.date === "2027-02-01");
    expect(after && after.paymentEur < 672.93).toBe(true);
    expect(s.paymentsCount).toBe(300);
    expect(s.endDate).toBe("2051-08-01");
  });

  it("rate_change recalcula la cuota sobre pendiente y meses restantes", () => {
    const ev: MortgageScheduleEvent[] = [
      { type: "rate_change", eventDate: "2028-09-15", newRatePct: 3.5 },
    ];
    const rows = buildSchedule(CANON, ev);
    const before = rows.find((r) => r.date === "2028-09-01");
    const after = rows.find((r) => r.date === "2028-10-01");
    expect(before?.ratePct).toBe(2.5);
    expect(after?.ratePct).toBe(3.5);
    expect(after && after.paymentEur > 672.93).toBe(true);
    expect(summarizeSchedule(CANON, rows).paymentsCount).toBe(300);
  });

  it("amortización total liquida el préstamo", () => {
    const rows = buildSchedule(CANON, [
      { type: "early_repayment", eventDate: "2027-01-15", amountEur: 999_999, mode: "reduce_term" },
    ]);
    expect(rows[rows.length - 1]).toMatchObject({ kind: "early_repayment", remainingEur: 0 });
  });
});

describe("valoraciones y equity", () => {
  const rows = buildSchedule(CANON);
  const vals = [
    { valuationDate: "2028-05-01", valueEur: 215_000 },
    { valuationDate: "2027-03-01", valueEur: 200_000 },
  ];

  it("currentValueAt: forward-fill con fallback al precio de compra", () => {
    expect(currentValueAt(193_000, vals, "2026-12-01")).toEqual({ valueEur: 193_000, asOf: null });
    expect(currentValueAt(193_000, vals, "2027-06-01")).toEqual({ valueEur: 200_000, asOf: "2027-03-01" });
    expect(currentValueAt(193_000, vals, "2030-01-01")).toEqual({ valueEur: 215_000, asOf: "2028-05-01" });
  });

  it("equityAt: día de compra = la entrada (caso canónico +43k)", () => {
    expect(equityAt(193_000, [], CANON, rows, "2026-08-20")).toBe(43_000);
  });

  it("equityAt sin hipoteca = valor vigente", () => {
    expect(equityAt(193_000, vals, null, [], "2027-06-01")).toBe(200_000);
  });

  it("interestPaidUntil y nextPaymentAfter", () => {
    expect(interestPaidUntil(rows, "2026-08-31")).toBe(0);
    expect(interestPaidUntil(rows, "2026-09-01")).toBe(312.5);
    expect(nextPaymentAfter(rows, "2026-09-01")?.date).toBe("2026-10-01");
    expect(nextPaymentAfter(rows, "2060-01-01")).toBeNull();
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test src/lib/__tests__/mortgage.test.ts`
Expected: FAIL — `currentValueAt is not a function` (y siguientes).

- [ ] **Step 3: Implementación** — añadir al final de `src/lib/mortgage.ts`:

```ts
export function interestPaidUntil(rows: ScheduleRow[], dateIso: string): number {
  return roundEur(
    rows.filter((r) => r.date <= dateIso).reduce((s, r) => s + r.interestEur, 0),
  );
}

export function nextPaymentAfter(rows: ScheduleRow[], dateIso: string): ScheduleRow | null {
  return rows.find((r) => r.kind === "payment" && r.date > dateIso) ?? null;
}

export type ValuationPoint = { valuationDate: string; valueEur: number };

export function currentValueAt(
  purchasePriceEur: number,
  valuations: ValuationPoint[],
  dateIso: string,
): { valueEur: number; asOf: string | null } {
  let best: ValuationPoint | null = null;
  for (const v of valuations) {
    if (v.valuationDate <= dateIso && (!best || v.valuationDate > best.valuationDate)) {
      best = v;
    }
  }
  return best
    ? { valueEur: best.valueEur, asOf: best.valuationDate }
    : { valueEur: purchasePriceEur, asOf: null };
}

export function equityAt(
  purchasePriceEur: number,
  valuations: ValuationPoint[],
  terms: MortgageTerms | null,
  rows: ScheduleRow[],
  dateIso: string,
): number {
  const { valueEur } = currentValueAt(purchasePriceEur, valuations, dateIso);
  const pendingEur = terms ? outstandingAt(terms, rows, dateIso) : 0;
  return roundEur(valueEur - pendingEur);
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm test src/lib/__tests__/mortgage.test.ts`
Expected: PASS (todos los describes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mortgage.ts src/lib/__tests__/mortgage.test.ts
git commit -m "feat(real-estate): eventos de hipoteca, valoraciones y equity en el motor"
```

---

### Task 4: Lecturas — `src/server/realEstate.ts`

**Files:**
- Create: `src/server/realEstate.ts`
- Test: `src/server/__tests__/realEstate.test.ts`

**Interfaces:**
- Consumes: motor de Task 2/3; tablas de Task 1; `todayIsoLocal` de `src/lib/asof.ts`; `roundEur`.
- Produces (consumido por overview, statement, advisor y la página):

```ts
export type PropertySummary = {
  property: Property;
  mortgage: Mortgage | null;
  events: MortgageEvent[];
  valuations: PropertyValuation[];
  schedule: ScheduleRow[];
  currentValueEur: number;
  currentValueAsOf: string | null; // null = precio de compra
  outstandingEur: number;
  equityEur: number;
  ownedPct: number; // equity / valor vigente, 0..1
  loan: {
    paymentEur: number;
    nextPayment: ScheduleRow | null;
    endDate: string | null;
    totalInterestEur: number;
    totalLoanCostEur: number;
    interestPaidEur: number;
    interestRemainingEur: number;
  } | null;
};
export type RealEstateOverview = {
  totalValueEur: number;
  totalOutstandingEur: number;
  totalEquityEur: number;
  properties: PropertySummary[];
};
export type StatementRealEstateLine = {
  propertyId: string;
  name: string;
  valueEur: number;
  valuationAsOf: string | null;
  outstandingEur: number;
  equityEur: number;
};
export async function getRealEstateOverview(db?: DB, todayIso?: string): Promise<RealEstateOverview>;
export async function getRealEstateEquityAt(dateIso: string, db?: DB): Promise<number>;
export async function getRealEstateEquityByDate(dates: string[], db?: DB): Promise<Map<string, number>>;
export async function getStatementRealEstate(db?: DB, asOf?: string | null): Promise<{ lines: StatementRealEstateLine[]; totalEquityEur: number }>;
```

Regla transversal: un inmueble solo computa desde su `purchaseDate` (`purchaseDate > fecha ⇒ contribución 0`) — así la serie histórica del overview es correcta antes de la compra.

- [ ] **Step 1: Test que falla**

`src/server/__tests__/realEstate.test.ts`:

```ts
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ulid } from "ulid";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import { mortgages, properties, propertyValuations } from "../../db/schema";
import type { DB } from "../../db/client";
import {
  getRealEstateEquityAt,
  getRealEstateEquityByDate,
  getRealEstateOverview,
  getStatementRealEstate,
} from "../realEstate";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

// Fechas en PASADO respecto a cualquier ejecución (el plan se ejecuta en
// 2026-07+): los tests de integración usan el reloj real vía todayIsoLocal(),
// y un inmueble con purchaseDate futura contribuiría equity 0.
function seedCanon(db: DB): { propertyId: string } {
  const propertyId = ulid();
  db.insert(properties)
    .values({
      id: propertyId,
      name: "Vivienda habitual",
      purchaseDate: "2026-01-10",
      purchasePriceEur: 193_000,
      purchaseCostsEur: 4_000,
    })
    .run();
  db.insert(mortgages)
    .values({
      id: ulid(),
      propertyId,
      principalEur: 150_000,
      rateType: "fixed",
      nominalRatePct: 2.5,
      termMonths: 300,
      firstPaymentDate: "2026-02-01",
    })
    .run();
  return { propertyId };
}

describe("realEstate — lecturas", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("DB vacía ⇒ overview a cero", async () => {
    const o = await getRealEstateOverview(db);
    expect(o).toEqual({
      totalValueEur: 0,
      totalOutstandingEur: 0,
      totalEquityEur: 0,
      properties: [],
    });
  });

  it("caso canónico el día de compra: equity +43k", async () => {
    seedCanon(db);
    const o = await getRealEstateOverview(db, "2026-01-10");
    expect(o.totalEquityEur).toBe(43_000);
    const p = o.properties[0];
    expect(p.currentValueEur).toBe(193_000);
    expect(p.currentValueAsOf).toBeNull();
    expect(p.outstandingEur).toBe(150_000);
    expect(p.ownedPct).toBeCloseTo(43_000 / 193_000, 6);
    expect(p.loan?.paymentEur).toBe(672.93);
    expect(p.loan?.endDate).toBe("2051-01-01");
  });

  it("inmueble sin hipoteca: equity = valor vigente", async () => {
    const propertyId = ulid();
    db.insert(properties)
      .values({
        id: propertyId,
        name: "Plaza de garaje",
        purchaseDate: "2026-01-10",
        purchasePriceEur: 18_000,
        purchaseCostsEur: 0,
      })
      .run();
    const o = await getRealEstateOverview(db, "2026-06-01");
    expect(o.totalEquityEur).toBe(18_000);
    expect(o.properties[0].loan).toBeNull();
  });

  it("una valoración posterior mueve el equity desde su fecha", async () => {
    const { propertyId } = seedCanon(db);
    // Día 15: sin cuota (las cuotas caen el 1) — la diferencia es SOLO la valoración.
    db.insert(propertyValuations)
      .values({ id: ulid(), propertyId, valuationDate: "2028-05-15", valueEur: 215_000 })
      .run();
    const before = await getRealEstateEquityAt("2028-05-14", db);
    const after = await getRealEstateEquityAt("2028-05-15", db);
    expect(after - before).toBeCloseTo(22_000, 2);
  });

  it("equity 0 antes de purchaseDate (serie histórica retroactiva)", async () => {
    seedCanon(db);
    const map = await getRealEstateEquityByDate(["2026-01-09", "2026-01-10"], db);
    expect(map.get("2026-01-09")).toBe(0);
    expect(map.get("2026-01-10")).toBe(43_000);
  });

  it("líneas de extracto (asOf)", async () => {
    seedCanon(db);
    const { lines, totalEquityEur } = await getStatementRealEstate(db, "2026-01-10");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      name: "Vivienda habitual",
      valueEur: 193_000,
      valuationAsOf: null,
      outstandingEur: 150_000,
      equityEur: 43_000,
    });
    expect(totalEquityEur).toBe(43_000);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test src/server/__tests__/realEstate.test.ts`
Expected: FAIL — `Cannot find module '../realEstate'`.

- [ ] **Step 3: Implementación**

`src/server/realEstate.ts`:

```ts
import { asc, eq } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  mortgageEvents,
  mortgages,
  properties,
  propertyValuations,
  type Mortgage,
  type MortgageEvent,
  type Property,
  type PropertyValuation,
} from "../db/schema";
import { todayIsoLocal } from "../lib/asof";
import { roundEur } from "../lib/money";
import {
  buildSchedule,
  currentValueAt,
  interestPaidUntil,
  nextPaymentAfter,
  outstandingAt,
  summarizeSchedule,
  type MortgageScheduleEvent,
  type MortgageTerms,
  type ScheduleRow,
} from "../lib/mortgage";

export type PropertySummary = {
  property: Property;
  mortgage: Mortgage | null;
  events: MortgageEvent[];
  valuations: PropertyValuation[];
  schedule: ScheduleRow[];
  currentValueEur: number;
  currentValueAsOf: string | null;
  outstandingEur: number;
  equityEur: number;
  ownedPct: number;
  loan: {
    paymentEur: number;
    nextPayment: ScheduleRow | null;
    endDate: string | null;
    totalInterestEur: number;
    totalLoanCostEur: number;
    interestPaidEur: number;
    interestRemainingEur: number;
  } | null;
};

export type RealEstateOverview = {
  totalValueEur: number;
  totalOutstandingEur: number;
  totalEquityEur: number;
  properties: PropertySummary[];
};

export type StatementRealEstateLine = {
  propertyId: string;
  name: string;
  valueEur: number;
  valuationAsOf: string | null;
  outstandingEur: number;
  equityEur: number;
};

function toTerms(m: Mortgage): MortgageTerms {
  return {
    principalEur: m.principalEur,
    nominalRatePct: m.nominalRatePct,
    termMonths: m.termMonths,
    firstPaymentDate: m.firstPaymentDate,
  };
}

function toScheduleEvents(rows: MortgageEvent[]): MortgageScheduleEvent[] {
  return rows.map((e) =>
    e.type === "early_repayment"
      ? {
          type: "early_repayment" as const,
          eventDate: e.eventDate,
          amountEur: e.amountEur ?? 0,
          mode: e.mode ?? "reduce_installment",
        }
      : {
          type: "rate_change" as const,
          eventDate: e.eventDate,
          newRatePct: e.newRatePct ?? 0,
        },
  );
}

export async function getRealEstateOverview(
  db: DB = defaultDb,
  todayIso: string = todayIsoLocal(),
): Promise<RealEstateOverview> {
  const props = db.select().from(properties).orderBy(asc(properties.purchaseDate)).all();
  const out: PropertySummary[] = [];
  for (const property of props) {
    const mortgage =
      db.select().from(mortgages).where(eq(mortgages.propertyId, property.id)).get() ?? null;
    const events = mortgage
      ? db
          .select()
          .from(mortgageEvents)
          .where(eq(mortgageEvents.mortgageId, mortgage.id))
          .orderBy(asc(mortgageEvents.eventDate))
          .all()
      : [];
    const valuations = db
      .select()
      .from(propertyValuations)
      .where(eq(propertyValuations.propertyId, property.id))
      .orderBy(asc(propertyValuations.valuationDate))
      .all();
    const terms = mortgage ? toTerms(mortgage) : null;
    const schedule = terms ? buildSchedule(terms, toScheduleEvents(events)) : [];
    const { valueEur, asOf } = currentValueAt(property.purchasePriceEur, valuations, todayIso);
    const outstandingEur = terms ? outstandingAt(terms, schedule, todayIso) : 0;
    const equityEur = roundEur(valueEur - outstandingEur);
    let loan: PropertySummary["loan"] = null;
    if (terms) {
      const summary = summarizeSchedule(terms, schedule);
      const interestPaidEur = interestPaidUntil(schedule, todayIso);
      const next = nextPaymentAfter(schedule, todayIso);
      loan = {
        paymentEur: next?.paymentEur ?? 0,
        nextPayment: next,
        endDate: summary.endDate,
        totalInterestEur: summary.totalInterestEur,
        totalLoanCostEur: summary.totalLoanCostEur,
        interestPaidEur,
        interestRemainingEur: roundEur(summary.totalInterestEur - interestPaidEur),
      };
    }
    out.push({
      property,
      mortgage,
      events,
      valuations,
      schedule,
      currentValueEur: valueEur,
      currentValueAsOf: asOf,
      outstandingEur,
      equityEur,
      ownedPct: valueEur > 0 ? equityEur / valueEur : 0,
    loan,
    });
  }
  return {
    totalValueEur: roundEur(out.reduce((s, p) => s + p.currentValueEur, 0)),
    totalOutstandingEur: roundEur(out.reduce((s, p) => s + p.outstandingEur, 0)),
    totalEquityEur: roundEur(out.reduce((s, p) => s + p.equityEur, 0)),
    properties: out,
  };
}

function equityAtDate(p: PropertySummary, dateIso: string): number {
  if (p.property.purchaseDate > dateIso) return 0;
  const { valueEur } = currentValueAt(p.property.purchasePriceEur, p.valuations, dateIso);
  const pendingEur = p.mortgage
    ? outstandingAt(toTerms(p.mortgage), p.schedule, dateIso)
    : 0;
  return valueEur - pendingEur;
}

export async function getRealEstateEquityAt(
  dateIso: string,
  db: DB = defaultDb,
): Promise<number> {
  const overview = await getRealEstateOverview(db, dateIso);
  return roundEur(
    overview.properties.reduce((s, p) => s + equityAtDate(p, dateIso), 0),
  );
}

export async function getRealEstateEquityByDate(
  dates: string[],
  db: DB = defaultDb,
): Promise<Map<string, number>> {
  const overview = await getRealEstateOverview(db);
  const map = new Map<string, number>();
  for (const d of dates) {
    map.set(
      d,
      roundEur(overview.properties.reduce((s, p) => s + equityAtDate(p, d), 0)),
    );
  }
  return map;
}

export async function getStatementRealEstate(
  db: DB = defaultDb,
  asOf?: string | null,
): Promise<{ lines: StatementRealEstateLine[]; totalEquityEur: number }> {
  const dateIso = asOf ?? todayIsoLocal();
  const overview = await getRealEstateOverview(db, dateIso);
  const lines = overview.properties
    .filter((p) => p.property.purchaseDate <= dateIso)
    .map((p) => ({
      propertyId: p.property.id,
      name: p.property.name,
      valueEur: p.currentValueEur,
      valuationAsOf: p.currentValueAsOf,
      outstandingEur: p.outstandingEur,
      equityEur: p.equityEur,
    }));
  return {
    lines,
    totalEquityEur: roundEur(lines.reduce((s, l) => s + l.equityEur, 0)),
  };
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm test src/server/__tests__/realEstate.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/realEstate.ts src/server/__tests__/realEstate.test.ts
git commit -m "feat(real-estate): capa de lectura (overview, equity por fecha, extracto)"
```

---

### Task 5: Acciones — `src/actions/realEstate.ts`

**Files:**
- Create: `src/actions/realEstate.schema.ts`, `src/actions/realEstate.ts`
- Modify: `src/actions/_shared.ts` (añadir `revalidateRealEstate()`)
- Test: `src/actions/__tests__/realEstate.test.ts`

**Interfaces:**
- Consumes: tablas Task 1, motor Task 2/3, `ActionResult`/`ACTOR` de `src/actions/_shared.ts`.
- Produces: `createProperty(input, db?)`, `updateProperty(input, db?)`, `deleteProperty(input, db?)`, `addValuation(input, db?)`, `deleteValuation(input, db?)`, `addMortgageEvent(input, db?)`, `deleteMortgageEvent(input, db?)` — todas `Promise<ActionResult<T>>`. Inputs según los esquemas de abajo (la UI de Tasks 9–11 los consume tal cual).

- [ ] **Step 1: Esquemas Zod** — `src/actions/realEstate.schema.ts`:

```ts
import { z } from "zod";
import { EARLY_REPAYMENT_MODES, RATE_TYPES } from "../db/schema";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (yyyy-MM-dd)");

export const mortgageInputSchema = z.object({
  lender: z.string().trim().max(120).nullish(),
  principalEur: z.number().positive().max(100_000_000),
  rateType: z.enum(RATE_TYPES),
  nominalRatePct: z.number().min(0).max(30),
  termMonths: z.number().int().min(1).max(600),
  firstPaymentDate: isoDate,
  spreadPct: z.number().min(0).max(15).nullish(),
  referenceIndex: z.string().trim().max(40).nullish(),
});

export const createPropertySchema = z.object({
  name: z.string().trim().min(1, "Obligatorio").max(120),
  address: z.string().trim().max(200).nullish(),
  purchaseDate: isoDate,
  purchasePriceEur: z.number().positive().max(100_000_000),
  purchaseCostsEur: z.number().min(0).max(100_000_000).default(0),
  notes: z.string().trim().max(500).nullish(),
  mortgage: mortgageInputSchema.nullish(),
});

export const updatePropertySchema = createPropertySchema
  .omit({ mortgage: true })
  .extend({ id: z.string().min(1) });

export const deleteByIdSchema = z.object({ id: z.string().min(1) });

export const addValuationSchema = z.object({
  propertyId: z.string().min(1),
  valuationDate: isoDate,
  valueEur: z.number().positive().max(100_000_000),
  note: z.string().trim().max(200).nullish(),
});

export const addMortgageEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("early_repayment"),
    mortgageId: z.string().min(1),
    eventDate: isoDate,
    amountEur: z.number().positive().max(100_000_000),
    mode: z.enum(EARLY_REPAYMENT_MODES),
    note: z.string().trim().max(200).nullish(),
  }),
  z.object({
    type: z.literal("rate_change"),
    mortgageId: z.string().min(1),
    eventDate: isoDate,
    newRatePct: z.number().min(0).max(30),
    note: z.string().trim().max(200).nullish(),
  }),
]);
```

- [ ] **Step 2: Helper de revalidación** — en `src/actions/_shared.ts`, junto a los `revalidate*` existentes:

```ts
export function revalidateRealEstate() {
  for (const p of ["/", "/real-estate", "/statement"]) revalidatePath(p);
}
```

- [ ] **Step 3: Tests que fallan** — `src/actions/__tests__/realEstate.test.ts`:

```ts
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import * as schema from "../../db/schema";
import { auditEvents, mortgageEvents, mortgages, properties } from "../../db/schema";
import type { DB } from "../../db/client";
import { addMortgageEvent, addValuation, createProperty, deleteProperty } from "../realEstate";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

const CANON_INPUT = {
  name: "Vivienda habitual",
  purchaseDate: "2026-08-20",
  purchasePriceEur: 193_000,
  purchaseCostsEur: 4_000,
  mortgage: {
    principalEur: 150_000,
    rateType: "fixed" as const,
    nominalRatePct: 2.5,
    termMonths: 300,
    firstPaymentDate: "2026-09-01",
  },
};

describe("acciones real-estate", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("createProperty: inmueble + hipoteca en una transacción, con audit", async () => {
    const res = await createProperty(CANON_INPUT, db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(db.select().from(properties).all()).toHaveLength(1);
    expect(db.select().from(mortgages).all()).toHaveLength(1);
    const audits = db.select().from(auditEvents).all();
    expect(audits.map((a) => a.entityType).sort()).toEqual(["mortgage", "property"]);
  });

  it("createProperty: rechaza input inválido sin tocar la DB", async () => {
    const res = await createProperty({ ...CANON_INPUT, purchasePriceEur: -1 }, db);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("validation");
    expect(db.select().from(properties).all()).toHaveLength(0);
  });

  it("addValuation: fecha duplicada ⇒ error controlado (unique index)", async () => {
    const created = await createProperty(CANON_INPUT, db);
    if (!created.ok) throw new Error("seed");
    const propertyId = created.data.property.id;
    const v = { propertyId, valuationDate: "2028-05-01", valueEur: 215_000 };
    expect((await addValuation(v, db)).ok).toBe(true);
    const dup = await addValuation(v, db);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("db");
  });

  it("addMortgageEvent: amortización mayor que el pendiente ⇒ conflict", async () => {
    const created = await createProperty(CANON_INPUT, db);
    if (!created.ok) throw new Error("seed");
    const mortgageId = created.data.mortgage!.id;
    const res = await addMortgageEvent(
      { type: "early_repayment", mortgageId, eventDate: "2027-01-15", amountEur: 999_999, mode: "reduce_term" },
      db,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("conflict");
  });

  it("addMortgageEvent: evento anterior a la primera cuota ⇒ conflict", async () => {
    const created = await createProperty(CANON_INPUT, db);
    if (!created.ok) throw new Error("seed");
    const mortgageId = created.data.mortgage!.id;
    const res = await addMortgageEvent(
      { type: "rate_change", mortgageId, eventDate: "2026-08-25", newRatePct: 3 },
      db,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("conflict");
  });

  it("deleteProperty: cascade elimina hipoteca y eventos", async () => {
    const created = await createProperty(CANON_INPUT, db);
    if (!created.ok) throw new Error("seed");
    const mortgageId = created.data.mortgage!.id;
    await addMortgageEvent(
      { type: "early_repayment", mortgageId, eventDate: "2027-01-15", amountEur: 10_000, mode: "reduce_term" },
      db,
    );
    const res = await deleteProperty({ id: created.data.property.id }, db);
    expect(res.ok).toBe(true);
    expect(db.select().from(properties).all()).toHaveLength(0);
    expect(db.select().from(mortgages).all()).toHaveLength(0);
    expect(db.select().from(mortgageEvents).where(eq(mortgageEvents.mortgageId, mortgageId)).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Verificar que falla**

Run: `pnpm test src/actions/__tests__/realEstate.test.ts`
Expected: FAIL — `Cannot find module '../realEstate'`.

- [ ] **Step 5: Implementación** — `src/actions/realEstate.ts`:

```ts
"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  auditEvents,
  mortgageEvents,
  mortgages,
  properties,
  propertyValuations,
  type Mortgage,
  type MortgageEvent,
  type Property,
  type PropertyValuation,
} from "../db/schema";
import { buildSchedule, outstandingAt } from "../lib/mortgage";
import { ACTOR, type ActionResult, revalidateRealEstate } from "./_shared";
import {
  addMortgageEventSchema,
  addValuationSchema,
  createPropertySchema,
  deleteByIdSchema,
  updatePropertySchema,
} from "./realEstate.schema";

type Validation<T> = { ok: true; data: T } | { ok: false; error: ActionResult<never> };

function validate<S extends z.ZodTypeAny>(schema: S, input: unknown): Validation<z.infer<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const flat = z.flattenError(parsed.error);
  return {
    ok: false,
    error: {
      ok: false,
      error: {
        code: "validation",
        message: "Datos no válidos",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      },
    },
  };
}

function audit(
  tx: Parameters<Parameters<DB["transaction"]>[0]>[0],
  entityType: string,
  entityId: string,
  action: "create" | "update" | "delete",
  previous: unknown,
  next: unknown,
  now: number,
) {
  tx.insert(auditEvents)
    .values({
      id: ulid(),
      entityType,
      entityId,
      action,
      actorType: "user",
      source: "ui",
      summary: null,
      previousJson: previous == null ? null : JSON.stringify(previous),
      nextJson: next == null ? null : JSON.stringify(next),
      contextJson: JSON.stringify({ actor: ACTOR }),
      createdAt: now,
    })
    .run();
}

function dbError(err: unknown): ActionResult<never> {
  const message = err instanceof Error ? err.message : "Unknown DB error";
  return { ok: false, error: { code: "db", message } };
}

export async function createProperty(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ property: Property; mortgage: Mortgage | null }>> {
  const v = validate(createPropertySchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  try {
    const created = db.transaction((tx) => {
      const propertyId = ulid();
      tx.insert(properties)
        .values({
          id: propertyId,
          name: v.data.name,
          address: v.data.address ?? null,
          purchaseDate: v.data.purchaseDate,
          purchasePriceEur: v.data.purchasePriceEur,
          purchaseCostsEur: v.data.purchaseCostsEur,
          notes: v.data.notes ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const property = tx.select().from(properties).where(eq(properties.id, propertyId)).get();
      if (!property) throw new Error("property insert vanished");
      audit(tx, "property", propertyId, "create", null, property, now);

      let mortgage: Mortgage | null = null;
      if (v.data.mortgage) {
        const mortgageId = ulid();
        tx.insert(mortgages)
          .values({
            id: mortgageId,
            propertyId,
            lender: v.data.mortgage.lender ?? null,
            principalEur: v.data.mortgage.principalEur,
            rateType: v.data.mortgage.rateType,
            nominalRatePct: v.data.mortgage.nominalRatePct,
            termMonths: v.data.mortgage.termMonths,
            firstPaymentDate: v.data.mortgage.firstPaymentDate,
            spreadPct: v.data.mortgage.spreadPct ?? null,
            referenceIndex: v.data.mortgage.referenceIndex ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        mortgage = tx.select().from(mortgages).where(eq(mortgages.id, mortgageId)).get() ?? null;
        if (!mortgage) throw new Error("mortgage insert vanished");
        audit(tx, "mortgage", mortgageId, "create", null, mortgage, now);
      }
      return { property, mortgage };
    });
    revalidateRealEstate();
    return { ok: true, data: created };
  } catch (err) {
    return dbError(err);
  }
}

export async function updateProperty(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Property>> {
  const v = validate(updatePropertySchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const previous = db.select().from(properties).where(eq(properties.id, v.data.id)).get();
  if (!previous) {
    return { ok: false, error: { code: "not_found", message: "inmueble no encontrado" } };
  }
  try {
    const updated = db.transaction((tx) => {
      tx.update(properties)
        .set({
          name: v.data.name,
          address: v.data.address ?? null,
          purchaseDate: v.data.purchaseDate,
          purchasePriceEur: v.data.purchasePriceEur,
          purchaseCostsEur: v.data.purchaseCostsEur,
          notes: v.data.notes ?? null,
          updatedAt: now,
        })
        .where(eq(properties.id, v.data.id))
        .run();
      const row = tx.select().from(properties).where(eq(properties.id, v.data.id)).get();
      if (!row) throw new Error("property update vanished");
      audit(tx, "property", v.data.id, "update", previous, row, now);
      return row;
    });
    revalidateRealEstate();
    return { ok: true, data: updated };
  } catch (err) {
    return dbError(err);
  }
}

export async function deleteProperty(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const v = validate(deleteByIdSchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const previous = db.select().from(properties).where(eq(properties.id, v.data.id)).get();
  if (!previous) {
    return { ok: false, error: { code: "not_found", message: "inmueble no encontrado" } };
  }
  try {
    db.transaction((tx) => {
      tx.delete(properties).where(eq(properties.id, v.data.id)).run();
      audit(tx, "property", v.data.id, "delete", previous, null, now);
    });
    revalidateRealEstate();
    return { ok: true, data: { id: v.data.id } };
  } catch (err) {
    return dbError(err);
  }
}

export async function addValuation(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<PropertyValuation>> {
  const v = validate(addValuationSchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const property = db
    .select()
    .from(properties)
    .where(eq(properties.id, v.data.propertyId))
    .get();
  if (!property) {
    return { ok: false, error: { code: "not_found", message: "inmueble no encontrado" } };
  }
  if (v.data.valuationDate < property.purchaseDate) {
    return {
      ok: false,
      error: { code: "conflict", message: "La valoración no puede ser anterior a la compra" },
    };
  }
  try {
    const created = db.transaction((tx) => {
      const id = ulid();
      tx.insert(propertyValuations)
        .values({
          id,
          propertyId: v.data.propertyId,
          valuationDate: v.data.valuationDate,
          valueEur: v.data.valueEur,
          note: v.data.note ?? null,
          createdAt: now,
        })
        .run();
      const row = tx.select().from(propertyValuations).where(eq(propertyValuations.id, id)).get();
      if (!row) throw new Error("valuation insert vanished");
      audit(tx, "property_valuation", id, "create", null, row, now);
      return row;
    });
    revalidateRealEstate();
    return { ok: true, data: created };
  } catch (err) {
    return dbError(err);
  }
}

export async function deleteValuation(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const v = validate(deleteByIdSchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const previous = db
    .select()
    .from(propertyValuations)
    .where(eq(propertyValuations.id, v.data.id))
    .get();
  if (!previous) {
    return { ok: false, error: { code: "not_found", message: "valoración no encontrada" } };
  }
  try {
    db.transaction((tx) => {
      tx.delete(propertyValuations).where(eq(propertyValuations.id, v.data.id)).run();
      audit(tx, "property_valuation", v.data.id, "delete", previous, null, now);
    });
    revalidateRealEstate();
    return { ok: true, data: { id: v.data.id } };
  } catch (err) {
    return dbError(err);
  }
}

export async function addMortgageEvent(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<MortgageEvent>> {
  const v = validate(addMortgageEventSchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const mortgage = db
    .select()
    .from(mortgages)
    .where(eq(mortgages.id, v.data.mortgageId))
    .get();
  if (!mortgage) {
    return { ok: false, error: { code: "not_found", message: "hipoteca no encontrada" } };
  }
  if (v.data.eventDate < mortgage.firstPaymentDate) {
    return {
      ok: false,
      error: { code: "conflict", message: "El evento no puede ser anterior a la primera cuota" },
    };
  }
  if (v.data.type === "early_repayment") {
    const existing = db
      .select()
      .from(mortgageEvents)
      .where(eq(mortgageEvents.mortgageId, mortgage.id))
      .all();
    const schedule = buildSchedule(
      {
        principalEur: mortgage.principalEur,
        nominalRatePct: mortgage.nominalRatePct,
        termMonths: mortgage.termMonths,
        firstPaymentDate: mortgage.firstPaymentDate,
      },
      existing.map((e) =>
        e.type === "early_repayment"
          ? {
              type: "early_repayment" as const,
              eventDate: e.eventDate,
              amountEur: e.amountEur ?? 0,
              mode: e.mode ?? "reduce_installment",
            }
          : { type: "rate_change" as const, eventDate: e.eventDate, newRatePct: e.newRatePct ?? 0 },
      ),
    );
    const pending = outstandingAt(
      {
        principalEur: mortgage.principalEur,
        nominalRatePct: mortgage.nominalRatePct,
        termMonths: mortgage.termMonths,
        firstPaymentDate: mortgage.firstPaymentDate,
      },
      schedule,
      v.data.eventDate,
    );
    if (v.data.amountEur >= pending) {
      return {
        ok: false,
        error: {
          code: "conflict",
          message: `La amortización (${v.data.amountEur} €) no puede igualar o superar el capital pendiente (${pending} €)`,
        },
      };
    }
  }
  try {
    const created = db.transaction((tx) => {
      const id = ulid();
      tx.insert(mortgageEvents)
        .values({
          id,
          mortgageId: v.data.mortgageId,
          eventDate: v.data.eventDate,
          type: v.data.type,
          amountEur: v.data.type === "early_repayment" ? v.data.amountEur : null,
          mode: v.data.type === "early_repayment" ? v.data.mode : null,
          newRatePct: v.data.type === "rate_change" ? v.data.newRatePct : null,
          note: v.data.note ?? null,
          createdAt: now,
        })
        .run();
      const row = tx.select().from(mortgageEvents).where(eq(mortgageEvents.id, id)).get();
      if (!row) throw new Error("mortgage event insert vanished");
      audit(tx, "mortgage_event", id, "create", null, row, now);
      return row;
    });
    revalidateRealEstate();
    return { ok: true, data: created };
  } catch (err) {
    return dbError(err);
  }
}

export async function deleteMortgageEvent(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const v = validate(deleteByIdSchema, input);
  if (!v.ok) return v.error;
  const now = Date.now();
  const previous = db
    .select()
    .from(mortgageEvents)
    .where(eq(mortgageEvents.id, v.data.id))
    .get();
  if (!previous) {
    return { ok: false, error: { code: "not_found", message: "evento no encontrado" } };
  }
  try {
    db.transaction((tx) => {
      tx.delete(mortgageEvents).where(eq(mortgageEvents.id, v.data.id)).run();
      audit(tx, "mortgage_event", v.data.id, "delete", previous, null, now);
    });
    revalidateRealEstate();
    return { ok: true, data: { id: v.data.id } };
  } catch (err) {
    return dbError(err);
  }
}
```

Nota: si `"use server"` exige solo exports async en el fichero, mueve `validate`/`audit`/`dbError` a un módulo interno no exportado o decláralos sin export (como arriba — funciones locales sin export son válidas).

- [ ] **Step 6: Verificar que pasa**

Run: `pnpm test src/actions/__tests__/realEstate.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Lint + typecheck + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: limpio (el guard de migraciones de `scripts/check-migrations.mjs` debe aceptar las acciones nuevas).

```bash
git add src/actions/realEstate.ts src/actions/realEstate.schema.ts src/actions/_shared.ts src/actions/__tests__/realEstate.test.ts
git commit -m "feat(real-estate): acciones de inmueble, valoraciones y eventos de hipoteca"
```

---

### Task 6: Integración overview — KPI, serie y desglose

**Files:**
- Modify: `src/server/overview.ts`, `src/app/page.tsx` (KpiRow, ~líneas 76–82), `src/components/features/overview/NetWorthChart.tsx`
- Test: ampliar `src/server/__tests__/realEstate.test.ts`

**Interfaces:**
- Consumes: `getRealEstateEquityAt`, `getRealEstateEquityByDate` (Task 4).
- Produces: `OverviewKpis.realEstateEquityEur: number`; `NetWorthPoint.realEstateEquityEur: number`.

Reglas: (1) el equity solo entra cuando NO hay filtro de cuentas (`filteringAccounts ⇒ 0` — un inmueble no pertenece a ninguna cuenta); (2) `performanceIndex`, XIRR y P&L se calculan EXACTAMENTE igual que hoy, sobre `valueEur` sin equity.

- [ ] **Step 1: Test que falla** — añadir a `src/server/__tests__/realEstate.test.ts` (importar `getOverviewKpis`, `getNetWorthSeries` de `../overview`):

```ts
describe("integración overview", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("el equity suma al patrimonio sin tocar P&L", async () => {
    const before = await getOverviewKpis({ range: "ALL" }, db);
    seedCanon(db);
    const after = await getOverviewKpis({ range: "ALL" }, db);
    expect(after.realEstateEquityEur).toBeGreaterThan(0);
    expect(after.totalNetWorthEur).toBeCloseTo(
      after.cashEur + after.investedMarketValueEur + after.realEstateEquityEur,
      2,
    );
    expect(after.unrealizedPnlEur).toBe(before.unrealizedPnlEur);
    expect(after.investedEur).toBe(before.investedEur);
  });

  it("con filtro de cuentas el equity queda fuera", async () => {
    seedCanon(db);
    const k = await getOverviewKpis({ range: "ALL", accountIds: ["acc-x"] }, db);
    expect(k.realEstateEquityEur).toBe(0);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test src/server/__tests__/realEstate.test.ts`
Expected: FAIL — `realEstateEquityEur` no existe en `OverviewKpis`.

- [ ] **Step 3: Implementación en `src/server/overview.ts`**

1. Import: `import { getRealEstateEquityAt, getRealEstateEquityByDate } from "./realEstate";` y `import { todayIsoLocal } from "../lib/asof";` (si no está).
2. `OverviewKpis` (líneas 34–46): añadir `realEstateEquityEur: number;`.
3. En `getOverviewKpis`, antes del `return` final:

```ts
  const realEstateEquityEur = filteringAccounts
    ? 0
    : await getRealEstateEquityAt(todayIsoLocal(), db);
```

y en el `return` (línea ~214):

```ts
  return {
    totalNetWorthEur: cashEur + marketValueEur + realEstateEquityEur,
    realEstateEquityEur,
    cashEur,
    // …resto igual…
  };
```

4. `NetWorthPoint` (líneas 224–234): añadir `realEstateEquityEur: number;` con comentario `/** Equity inmobiliario a esta fecha. NO entra en performanceIndex ni XIRR. */`.
5. En `computeNetWorthSeries`, tras calcular `sortedDates` y antes del bucle final (~línea 530):

```ts
  const equityByDate = filteringAccounts
    ? new Map<string, number>()
    : await getRealEstateEquityByDate(sortedDates, db);
```

y en el `out.push` (~línea 549): `realEstateEquityEur: equityByDate.get(date) ?? 0,`. No tocar `value`, `invested` ni `performanceIndex` (XIRR intacto). Si `computeNetWorthSeries` no recibe `filteringAccounts`, derivarlo igual que el resto del fichero (de `filters.accountIds?.length`).

- [ ] **Step 4: Desglose del KPI en `src/app/page.tsx`** — en `KpiRow`, dentro del `<span className="text-xs text-muted-foreground">` (líneas ~79–82), tras «invertido»:

```tsx
            {kpis.realEstateEquityEur > 0 ? (
              <>
                {" "}· inmuebles{" "}
                <SensitiveValue>{formatEur(kpis.realEstateEquityEur)}</SensitiveValue>
              </>
            ) : null}
```

- [ ] **Step 5: Gráfica** — en `src/components/features/overview/NetWorthChart.tsx` (localizar por el import en `page.tsx` si el nombre difiere): mapear los datos antes de renderizar para que el área pinte patrimonio total y el resto de series queden igual:

```tsx
  const plotted = data.map((p) => ({
    ...p,
    totalEur: p.valueEur + (p.realEstateEquityEur ?? 0),
  }));
```

Usar `plotted` como `data` del chart y cambiar el `dataKey` del área principal de `valueEur` a `totalEur`. El tooltip que muestre `totalEur` como «Patrimonio» y, si `realEstateEquityEur > 0`, una línea secundaria «Inmobiliario» (todo dentro de `SensitiveValue`, formato `formatEur`). La línea `investedEur` no se toca.

- [ ] **Step 6: Verificar**

Run: `pnpm test src/server/__tests__ && pnpm typecheck`
Expected: PASS + 0 errores. La suite existente de overview (`server.test.ts`) debe seguir verde — si algún `toEqual` estricto sobre `OverviewKpis` falla, añadir `realEstateEquityEur: 0` al literal esperado (DB vacía ⇒ 0).

- [ ] **Step 7: Commit**

```bash
git add src/server/overview.ts src/app/page.tsx src/components/features/overview src/server/__tests__/realEstate.test.ts
git commit -m "feat(real-estate): equity inmobiliario en patrimonio total y curva de evolución"
```

---

### Task 7: Integración extracto — servidor, Markdown y PDF

**Files:**
- Modify: `src/server/statement.ts`, `src/lib/exports/statement-md.ts`, `src/lib/pdf/statement-report.ts`
- Test: ampliar `src/server/__tests__/realEstate.test.ts`

**Interfaces:**
- Consumes: `getStatementRealEstate` (Task 4).
- Produces: `StatementTotals.realEstateEquityEur: number`; `StatementReport.realEstate: StatementRealEstateLine[]`.

Alcance: secciones nuevas solo en **md y PDF** (según spec). CSV/XLSX no ganan sección; su total de patrimonio (si imprimen `totals.netWorthEur`) pasa a incluir el equity — correcto y deliberado.

- [ ] **Step 1: Test que falla** — añadir a `src/server/__tests__/realEstate.test.ts` (importar `getStatementReport` de `../statement`):

```ts
describe("integración extracto", () => {
  it("el informe incorpora inmuebles y el total sube exactamente el equity", async () => {
    const db = makeDb();
    const before = await getStatementReport(db);
    seedCanon(db);
    const after = await getStatementReport(db);
    // El camino vivo usa el reloj real: el equity exacto depende del día
    // (cuotas ya amortizadas), así que se asserta coherencia, no una cifra.
    expect(after.realEstate).toHaveLength(1);
    expect(after.totals.realEstateEquityEur).toBeGreaterThanOrEqual(43_000);
    expect(after.totals.netWorthEur).toBeCloseTo(
      before.totals.netWorthEur + after.totals.realEstateEquityEur,
      2,
    );
    expect(after.totals.investedMarketValueEur).toBe(before.totals.investedMarketValueEur);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test src/server/__tests__/realEstate.test.ts`
Expected: FAIL — `realEstate` no existe en `StatementReport`.

- [ ] **Step 3: Implementación en `src/server/statement.ts`**

1. Import `getStatementRealEstate, type StatementRealEstateLine` desde `./realEstate` (re-exportar el tipo desde statement si hace falta para los builders).
2. `StatementTotals` (líneas 55–64): añadir `realEstateEquityEur: number;`. `StatementReport` (66–76): añadir `realEstate: StatementRealEstateLine[];`.
3. `assembleReport` (línea 164): nuevo parámetro `realEstate: { lines: StatementRealEstateLine[]; totalEquityEur: number }`; en totals: `realEstateEquityEur: realEstate.totalEquityEur` y la línea 208 pasa a `netWorthEur: investedMarketValueEur + cashEur + realEstate.totalEquityEur`; en el report: `realEstate: realEstate.lines`.
4. `getStatementReport` (217): `const realEstate = await getStatementRealEstate(db);` y pasarlo a `assembleReport`. `statementReportAsOf` (311): `const realEstate = await getStatementRealEstate(db, asOf);` ídem. Los grupos/`investedMarketValueEur` NO se tocan.

- [ ] **Step 4: Markdown** — en `src/lib/exports/statement-md.ts`:

En la tabla `## Resumen` (tras la fila «Invertido…», ~línea 55), solo si hay equity:

```ts
  if (report.totals.realEstateEquityEur > 0) {
    out.push(`| Patrimonio inmobiliario (equity) | ${fmt(report.totals.realEstateEquityEur)} |`);
  }
```

Tras el bucle de grupos (~línea 82), sección nueva solo si `report.realEstate.length > 0`:

```ts
  if (report.realEstate.length > 0) {
    out.push("");
    out.push("### Inmuebles");
    out.push("");
    out.push("| Inmueble | Valor | Valorado a | Hipoteca pendiente | Equity |");
    out.push("| --- | ---: | :---: | ---: | ---: |");
    for (const l of report.realEstate) {
      out.push(
        `| ${l.name} | ${fmt(l.valueEur)} | ${l.valuationAsOf ?? "compra"} | ${fmt(l.outstandingEur)} | ${fmt(l.equityEur)} |`,
      );
    }
  }
```

(`fmt` = el formateador EUR ya usado en el fichero; reutilizar el existente, no crear otro.)

- [ ] **Step 5: PDF** — en `src/lib/pdf/statement-report.ts`:

1. StatCard «Patrimonio total» (líneas ~84–88): si `t.realEstateEquityEur > 0`, ampliar el `sub` a `efectivo … · invertido … · inmuebles …`.
2. Sección nueva antes de «Cuentas» (~línea 285), solo si `report.realEstate.length > 0`: `sectionTitle(cur, ++sectionNum, "Inmuebles")` + tabla con el patrón exacto de la sección de posiciones (`room(...)`, `tableHead(cur, cols)`, filas `zebra`, `totalRule` con el equity total). Columnas: Inmueble | Valor | Valorado a | Hipoteca pendiente | Equity. La numeración del resto de secciones se desplaza sola (`++sectionNum`).

- [ ] **Step 6: Verificar**

Run: `pnpm test src/server/__tests__/realEstate.test.ts src/lib/exports src/lib/pdf && pnpm typecheck`
Expected: PASS. Si los tests existentes de md/pdf/csv/xlsx construyen un `StatementReport` a mano, añadirles `realEstate: []` y `realEstateEquityEur: 0`.

- [ ] **Step 7: Commit**

```bash
git add src/server/statement.ts src/lib/exports/statement-md.ts src/lib/pdf/statement-report.ts src/server/__tests__/realEstate.test.ts src/lib/exports/__tests__ src/lib/pdf/__tests__
git commit -m "feat(real-estate): sección de inmuebles en extracto (servidor, md y PDF)"
```

---

### Task 8: Telegram `/net` y contexto del asesor

**Files:**
- Modify: `scripts/tg-net.ts` (líneas 22–32), `src/server/advisor.ts` (`getAdvisorContext`, líneas 34–59)

**Interfaces:**
- Consumes: `OverviewKpis.realEstateEquityEur` (Task 6), `getRealEstateOverview` (Task 4).

- [ ] **Step 1: Telegram** — en `scripts/tg-net.ts`, tras la línea `Inversión (mercado): …`:

```ts
    ...(k.realEstateEquityEur > 0
      ? [`Inmobiliario (equity): ${formatEur(k.realEstateEquityEur)}`]
      : []),
```

(dentro del array `lines`, con spread; `Patrimonio neto` ya sube solo vía `totalNetWorthEur`).

- [ ] **Step 2: Asesor** — en `src/server/advisor.ts`:

1. Añadir `getRealEstateOverview(dbc)` al `Promise.all` de `getAdvisorContext` (líneas 35–40), p. ej. como quinta entrada `realEstate`.
2. En la línea «Patrimonio total» (línea ~46), si `realEstate.totalEquityEur > 0` añadir `, inmuebles ${formatEur(realEstate.totalEquityEur)}` dentro del paréntesis.
3. Tras el bloque «Reparto por tipo de activo» (~línea 59):

```ts
  if (realEstate.properties.length > 0) {
    out.push("\n### Inmuebles");
    for (const p of realEstate.properties) {
      const base = `- ${p.property.name}: valor ${formatEur(p.currentValueEur)}, hipoteca pendiente ${formatEur(p.outstandingEur)}, equity ${formatEur(p.equityEur)}`;
      const loan = p.loan && p.mortgage
        ? `; cuota ${formatEur(p.loan.paymentEur)}/mes (TIN ${p.mortgage.nominalRatePct} %), intereses restantes ${formatEur(p.loan.interestRemainingEur)}, fin ${p.loan.endDate ?? "—"}`
        : "";
      out.push(base + loan);
    }
  }
```

- [ ] **Step 3: Verificar y probar en vivo**

Run: `pnpm typecheck && pnpm test src/server`
Expected: limpio. Después: `pnpm tg:net` imprime el snapshot por consola — sin inmuebles registrados NO debe aparecer la línea «Inmobiliario».

- [ ] **Step 4: Commit**

```bash
git add scripts/tg-net.ts src/server/advisor.ts
git commit -m "feat(real-estate): equity inmobiliario en /net de Telegram y contexto del asesor"
```

---

### Task 9: UI — navegación, página y alta de inmueble

**Files:**
- Modify: `src/components/layout/SideNav.tsx`
- Create: `src/app/real-estate/page.tsx`, `src/components/features/real-estate/RealEstateDashboard.tsx`, `src/components/features/real-estate/CreatePropertyModal.tsx`

**Interfaces:**
- Consumes: `getRealEstateOverview` + `type RealEstateOverview, PropertySummary` (Task 4); `createProperty` (Task 5); `annuityPayment` (Task 2); primitivas `Button`, `Modal`, `StatesBlock`.
- Produces: `<PropertySection summary={PropertySummary} />` queda referenciado (se crea en Task 10 — hasta entonces, crear un stub `export function PropertySection({ summary }: { summary: PropertySummary }) { return <div>{summary.property.name}</div>; }` en su fichero definitivo para que compile).

Los tipos de `src/server/realEstate.ts` se importan SOLO con `import type` desde componentes cliente (se borran al compilar; no arrastran el módulo de servidor al bundle).

- [ ] **Step 1: Navegación** — en `src/components/layout/SideNav.tsx`: importar `Building2` de `lucide-react` y añadir a `primaryItems`, tras Objetivos:

```ts
  { href: "/real-estate", label: "Inmuebles", icon: Building2 },
```

- [ ] **Step 2: Página** — `src/app/real-estate/page.tsx`:

```tsx
export const dynamic = "force-dynamic";

import { RealEstateDashboard } from "@/src/components/features/real-estate/RealEstateDashboard";
import { getRealEstateOverview } from "@/src/server/realEstate";

export default async function RealEstatePage() {
  const overview = await getRealEstateOverview();
  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Inmuebles</h1>
        <p className="text-sm text-muted-foreground">
          Patrimonio inmobiliario: valor, hipoteca y equity. Sin vínculo con la caja de tus
          cuentas — todo entra de cero.
        </p>
      </header>
      <RealEstateDashboard overview={overview} />
    </div>
  );
}
```

- [ ] **Step 3: Dashboard** — `src/components/features/real-estate/RealEstateDashboard.tsx`:

```tsx
"use client";

import { Building2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/src/components/ui/Button";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import type { RealEstateOverview } from "@/src/server/realEstate";
import { CreatePropertyModal } from "./CreatePropertyModal";
import { PropertySection } from "./PropertySection";

export function RealEstateDashboard({ overview }: { overview: RealEstateOverview }) {
  const [creating, setCreating] = React.useState(false);
  return (
    <div className="flex flex-col gap-8">
      {overview.properties.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="Sin inmuebles registrados"
          description="Registra la compra de tu vivienda para incorporar su equity al patrimonio."
          icon={<Building2 className="h-6 w-6" />}
          cta={{ label: "Registrar inmueble", onClick: () => setCreating(true) }}
        />
      ) : (
        <>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setCreating(true)}>
              Registrar inmueble
            </Button>
          </div>
          {overview.properties.map((p) => (
            <PropertySection key={p.property.id} summary={p} />
          ))}
        </>
      )}
      <CreatePropertyModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}
```

- [ ] **Step 4: Alta con cuota en vivo** — `src/components/features/real-estate/CreatePropertyModal.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { createProperty } from "@/src/actions/realEstate";
import { Button } from "@/src/components/ui/Button";
import { Modal } from "@/src/components/ui/Modal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { annuityPayment } from "@/src/lib/mortgage";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

type FormState = {
  name: string;
  address: string;
  purchaseDate: string;
  purchasePriceEur: string;
  purchaseCostsEur: string;
  notes: string;
  hasMortgage: boolean;
  lender: string;
  principalEur: string;
  rateType: "fixed" | "variable" | "mixed";
  nominalRatePct: string;
  termYears: string;
  firstPaymentDate: string;
};

const initial: FormState = {
  name: "",
  address: "",
  purchaseDate: "",
  purchasePriceEur: "",
  purchaseCostsEur: "",
  notes: "",
  hasMortgage: true,
  lender: "",
  principalEur: "",
  rateType: "fixed",
  nominalRatePct: "",
  termYears: "",
  firstPaymentDate: "",
};

const RATE_TYPE_LABELS: Record<FormState["rateType"], string> = {
  fixed: "Fija",
  variable: "Variable",
  mixed: "Mixta",
};

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function CreatePropertyModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(initial);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const termMonths = Math.round(num(form.termYears) * 12);
  const livePayment =
    form.hasMortgage && num(form.principalEur) > 0 && termMonths > 0
      ? annuityPayment(num(form.principalEur), num(form.nominalRatePct), termMonths)
      : null;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleOpenChange(next: boolean) {
    if (!next && !pending) {
      setForm(initial);
      setFieldErrors({});
      setBanner(null);
    }
    onOpenChange(next);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await createProperty({
        name: form.name,
        address: form.address || null,
        purchaseDate: form.purchaseDate,
        purchasePriceEur: num(form.purchasePriceEur),
        purchaseCostsEur: num(form.purchaseCostsEur),
        notes: form.notes || null,
        mortgage: form.hasMortgage
          ? {
              lender: form.lender || null,
              principalEur: num(form.principalEur),
              rateType: form.rateType,
              nominalRatePct: num(form.nominalRatePct),
              termMonths,
              firstPaymentDate: form.firstPaymentDate,
            }
          : null,
      });
      if (result.ok) {
        handleOpenChange(false);
        router.refresh();
        return;
      }
      if (result.error.code === "validation" && result.error.fieldErrors) {
        setFieldErrors(result.error.fieldErrors);
      } else {
        setBanner(result.error.message);
      }
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Registrar inmueble"
      description="La compra entra de cero: no toca la caja de ninguna cuenta."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {banner ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {banner}
          </div>
        ) : null}

        <Field label="Nombre" errors={fieldErrors.name}>
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Vivienda habitual"
          />
        </Field>
        <Field label="Dirección (opcional)" errors={fieldErrors.address}>
          <input
            className={inputClass}
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Fecha de compra" errors={fieldErrors.purchaseDate}>
            <input
              type="date"
              className={inputClass}
              value={form.purchaseDate}
              onChange={(e) => set("purchaseDate", e.target.value)}
            />
          </Field>
          <Field label="Precio (€)" errors={fieldErrors.purchasePriceEur}>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              value={form.purchasePriceEur}
              onChange={(e) => set("purchasePriceEur", e.target.value)}
            />
          </Field>
          <Field label="Costes (ITP, notaría…) (€)" errors={fieldErrors.purchaseCostsEur}>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              value={form.purchaseCostsEur}
              onChange={(e) => set("purchaseCostsEur", e.target.value)}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.hasMortgage}
            onChange={(e) => set("hasMortgage", e.target.checked)}
          />
          Con hipoteca
        </label>

        {form.hasMortgage ? (
          <div className="flex flex-col gap-4 rounded-lg border border-border/60 p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Banco (opcional)" errors={fieldErrors["mortgage.lender"]}>
                <input
                  className={inputClass}
                  value={form.lender}
                  onChange={(e) => set("lender", e.target.value)}
                />
              </Field>
              <Field label="Tipo" errors={fieldErrors["mortgage.rateType"]}>
                <select
                  className={inputClass}
                  value={form.rateType}
                  onChange={(e) => set("rateType", e.target.value as FormState["rateType"])}
                >
                  {(Object.keys(RATE_TYPE_LABELS) as FormState["rateType"][]).map((k) => (
                    <option key={k} value={k}>
                      {RATE_TYPE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Capital (€)" errors={fieldErrors["mortgage.principalEur"]}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputClass}
                  value={form.principalEur}
                  onChange={(e) => set("principalEur", e.target.value)}
                />
              </Field>
              <Field label="TIN (%)" errors={fieldErrors["mortgage.nominalRatePct"]}>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  className={inputClass}
                  value={form.nominalRatePct}
                  onChange={(e) => set("nominalRatePct", e.target.value)}
                />
              </Field>
              <Field label="Plazo (años)" errors={fieldErrors["mortgage.termMonths"]}>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className={inputClass}
                  value={form.termYears}
                  onChange={(e) => set("termYears", e.target.value)}
                />
              </Field>
              <Field label="Primera cuota" errors={fieldErrors["mortgage.firstPaymentDate"]}>
                <input
                  type="date"
                  className={inputClass}
                  value={form.firstPaymentDate}
                  onChange={(e) => set("firstPaymentDate", e.target.value)}
                />
              </Field>
            </div>
            {livePayment != null ? (
              <p className="text-sm text-muted-foreground">
                Cuota estimada:{" "}
                <SensitiveValue className="font-medium text-foreground">
                  {formatEur(livePayment)}
                </SensitiveValue>{" "}
                /mes — contrasta con la FEIN del banco antes de guardar.
              </p>
            ) : null}
          </div>
        ) : null}

        <Field label="Notas (opcional)" errors={fieldErrors.notes}>
          <textarea
            className={inputClass}
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={pending || !form.name || !form.purchaseDate}>
            {pending ? "Guardando…" : "Registrar inmueble"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({
  label,
  errors,
  children,
}: {
  label: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {errors && errors.length > 0 ? (
        <span className="text-xs text-destructive">{errors.join(", ")}</span>
      ) : null}
    </label>
  );
}
```

Nota sobre `fieldErrors` anidados: Zod aplana los errores de `mortgage.*` con clave compuesta o los deja en `mortgage`; si al probar no aparecen bajo `mortgage.principalEur`, mostrar el error genérico en el banner — no inventar mapeos.

- [ ] **Step 5: Stub temporal de PropertySection** — `src/components/features/real-estate/PropertySection.tsx`:

```tsx
"use client";

import type { PropertySummary } from "@/src/server/realEstate";

export function PropertySection({ summary }: { summary: PropertySummary }) {
  return <div className="text-sm text-muted-foreground">{summary.property.name}</div>;
}
```

(Se sustituye por la versión real en Task 10.)

- [ ] **Step 6: Verificar en vivo**

Run: `pnpm typecheck && pnpm lint`
Expected: limpio.

Después, contra un DB de dev: arrancar `next dev` en el puerto 3210 (el 3200 lo sirve launchd — no tocarlo) y comprobar en el navegador: (1) entrada «Inmuebles» en la barra; (2) `/real-estate` muestra el estado vacío con CTA; (3) el alta con los números canónicos (193k / 4k / hipoteca 150k, 2,5 %, 25 años, primera cuota futura) muestra cuota en vivo ≈ 672,93 € y al guardar aparece el stub; (4) el KPI del overview sube +43k con desglose «· inmuebles». Verificar dark y light.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/SideNav.tsx src/app/real-estate src/components/features/real-estate
git commit -m "feat(real-estate): ruta /real-estate, navegacion y alta de inmueble con cuota en vivo"
```

---

### Task 10: UI — sección del inmueble: KPIs, hipoteca y valoraciones

**Files:**
- Modify: `src/components/features/real-estate/PropertySection.tsx` (sustituir stub)
- Create: `src/components/features/real-estate/PropertyKpiCells.tsx`, `src/components/features/real-estate/MortgageCard.tsx`, `src/components/features/real-estate/ValuationsCard.tsx`

**Interfaces:**
- Consumes: `PropertySummary` (Task 4); acciones `deleteProperty`, `addValuation`, `deleteValuation`, `deleteMortgageEvent` (Task 5); primitivas `Card`, `Button`, `Modal`, `ConfirmModal`, `SensitiveValue`, `Badge`.
- Produces: `<EarlyRepaymentModal>` y `<RateChangeModal>` quedan referenciados desde `MortgageCard` (stubs en Task 10, reales en Task 11); `<EquityChart>` y `<AmortizationTable>` referenciados desde `PropertySection` (stubs, reales en Task 12). Stub estándar: componente cliente que recibe las mismas props y devuelve `null` (modales) o `<div />` (cards).

- [ ] **Step 1: PropertySection real** — sustituir el stub:

```tsx
"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteProperty } from "@/src/actions/realEstate";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import type { PropertySummary } from "@/src/server/realEstate";
import { AmortizationTable } from "./AmortizationTable";
import { EquityChart } from "./EquityChart";
import { MortgageCard } from "./MortgageCard";
import { PropertyKpiCells } from "./PropertyKpiCells";
import { ValuationsCard } from "./ValuationsCard";

export function PropertySection({ summary }: { summary: PropertySummary }) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold tracking-tight">{summary.property.name}</h2>
          {summary.property.address ? (
            <span className="text-xs text-muted-foreground">{summary.property.address}</span>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
          Eliminar
        </Button>
      </div>
      <PropertyKpiCells summary={summary} />
      <div className="grid gap-6 lg:grid-cols-2">
        <MortgageCard summary={summary} />
        <ValuationsCard summary={summary} />
      </div>
      <EquityChart summary={summary} />
      <AmortizationTable summary={summary} />
      <ConfirmModal
        open={deleting}
        onOpenChange={setDeleting}
        title="Eliminar inmueble"
        description="Se eliminarán también su hipoteca, los eventos y las valoraciones. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={async () => {
          const res = await deleteProperty({ id: summary.property.id });
          if (res.ok) router.refresh();
        }}
      />
    </section>
  );
}
```

- [ ] **Step 2: KPIs con celdas divididas** — `src/components/features/real-estate/PropertyKpiCells.tsx`:

```tsx
"use client";

import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { roundEur } from "@/src/lib/money";
import type { PropertySummary } from "@/src/server/realEstate";

export function PropertyKpiCells({ summary }: { summary: PropertySummary }) {
  const pct = Math.round(summary.ownedPct * 1000) / 10;
  const fiscalCostEur = roundEur(
    summary.property.purchasePriceEur + summary.property.purchaseCostsEur,
  );
  return (
    <Card className="p-0">
      <div className="grid divide-y divide-border/60 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <Cell
          label="Valor actual"
          tooltip="Última valoración manual; sin valoraciones, el precio de compra."
          value={formatEur(summary.currentValueEur)}
        >
          <span>
            {summary.currentValueAsOf
              ? `Valorado a ${summary.currentValueAsOf}`
              : "A precio de compra"}
          </span>
          {summary.property.purchaseCostsEur > 0 ? (
            <span>
              Adquisición fiscal{" "}
              <SensitiveValue>{formatEur(fiscalCostEur)}</SensitiveValue>
            </span>
          ) : null}
        </Cell>
        <Cell
          label="Capital pendiente"
          tooltip="Capital vivo de la hipoteca según el cuadro vigente. Los intereses futuros no son deuda patrimonial."
          value={formatEur(summary.outstandingEur)}
        >
          {summary.outstandingEur === 0 ? <span>Sin deuda.</span> : null}
        </Cell>
        <Cell
          label="Equity"
          tooltip="Valor actual menos capital pendiente: lo que suma a tu patrimonio."
          value={formatEur(summary.equityEur)}
          emphasis
        />
        <div className="flex flex-col gap-1.5 p-5">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Parte del valor del inmueble que ya es tuya."
          >
            En propiedad
          </span>
          <SensitiveValue className="text-3xl font-semibold tracking-tight tabular-nums">
            {pct.toLocaleString("es-ES")} %
          </SensitiveValue>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function Cell({
  label,
  tooltip,
  value,
  emphasis = false,
  children,
}: {
  label: string;
  tooltip: string;
  value: string;
  emphasis?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 p-5">
      <span
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        title={tooltip}
      >
        {label}
      </span>
      <SensitiveValue
        className={`text-3xl font-semibold tracking-tight tabular-nums ${
          emphasis ? "text-success" : ""
        }`}
      >
        {value}
      </SensitiveValue>
      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">{children}</div>
    </div>
  );
}
```

(Si `text-success` no existe como utilidad en este proyecto, usar la clase de tono que emplee `TaxSummary.tsx` — copiar el idioma exacto de ese fichero.)

- [ ] **Step 3: Card de hipoteca** — `src/components/features/real-estate/MortgageCard.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteMortgageEvent } from "@/src/actions/realEstate";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { PropertySummary } from "@/src/server/realEstate";
import { EarlyRepaymentModal } from "./EarlyRepaymentModal";
import { RateChangeModal } from "./RateChangeModal";

const RATE_TYPE_LABELS: Record<string, string> = {
  fixed: "Fija",
  variable: "Variable",
  mixed: "Mixta",
};

export function MortgageCard({ summary }: { summary: PropertySummary }) {
  const router = useRouter();
  const [repaying, setRepaying] = React.useState(false);
  const [changingRate, setChangingRate] = React.useState(false);
  const [deletingEvent, setDeletingEvent] = React.useState<string | null>(null);
  const { mortgage, loan, events } = summary;

  if (!mortgage || !loan) {
    return (
      <Card title="Hipoteca">
        <p className="text-sm text-muted-foreground">Sin hipoteca — compra al contado.</p>
      </Card>
    );
  }

  const settled = summary.outstandingEur === 0;

  return (
    <Card
      title="Hipoteca"
      action={
        settled ? null : (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setRepaying(true)}>
              Amortización anticipada
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setChangingRate(true)}>
              Revisión de tipo
            </Button>
          </div>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Row label="Cuota mensual">
          <SensitiveValue>{settled ? "—" : formatEur(loan.paymentEur)}</SensitiveValue>
        </Row>
        <Row label="Próxima cuota">
          {loan.nextPayment ? (
            <>
              {loan.nextPayment.date} ·{" "}
              <SensitiveValue>{formatEur(loan.nextPayment.interestEur)}</SensitiveValue> interés /{" "}
              <SensitiveValue>{formatEur(loan.nextPayment.principalEur)}</SensitiveValue> capital
            </>
          ) : (
            "—"
          )}
        </Row>
        <Row label="Tipo">
          {RATE_TYPE_LABELS[mortgage.rateType]} · TIN {mortgage.nominalRatePct} %
          {mortgage.lender ? ` · ${mortgage.lender}` : ""}
        </Row>
        <Row label="Fin del préstamo">{loan.endDate ?? "—"}</Row>
        <Row label="Intereses pagados / restantes">
          <SensitiveValue>{formatEur(loan.interestPaidEur)}</SensitiveValue> /{" "}
          <SensitiveValue>{formatEur(loan.interestRemainingEur)}</SensitiveValue>
        </Row>
        <Row label="Coste total del préstamo">
          <SensitiveValue>{formatEur(loan.totalLoanCostEur)}</SensitiveValue>
        </Row>
      </dl>

      {events.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-4">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Eventos
          </span>
          {events.map((e) => (
            <div key={e.id} className="flex items-center justify-between text-sm">
              <span>
                {e.eventDate} —{" "}
                {e.type === "early_repayment" ? (
                  <>
                    Amortización de{" "}
                    <SensitiveValue>{formatEur(e.amountEur ?? 0)}</SensitiveValue>{" "}
                    ({e.mode === "reduce_term" ? "reduce plazo" : "reduce cuota"})
                  </>
                ) : (
                  <>Revisión de tipo al {e.newRatePct} %</>
                )}
                {e.note ? (
                  <span className="text-muted-foreground"> · {e.note}</span>
                ) : null}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setDeletingEvent(e.id)}>
                Eliminar
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <EarlyRepaymentModal summary={summary} open={repaying} onOpenChange={setRepaying} />
      <RateChangeModal summary={summary} open={changingRate} onOpenChange={setChangingRate} />
      <ConfirmModal
        open={deletingEvent !== null}
        onOpenChange={(open) => !open && setDeletingEvent(null)}
        title="Eliminar evento"
        description="El cuadro de amortización se recalculará sin este evento."
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!deletingEvent) return;
          const res = await deleteMortgageEvent({ id: deletingEvent });
          if (res.ok) {
            setDeletingEvent(null);
            router.refresh();
          }
        }}
      />
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </>
  );
}
```

- [ ] **Step 4: Card de valoraciones** — `src/components/features/real-estate/ValuationsCard.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { addValuation, deleteValuation } from "@/src/actions/realEstate";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { Modal } from "@/src/components/ui/Modal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { PropertySummary } from "@/src/server/realEstate";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

export function ValuationsCard({ summary }: { summary: PropertySummary }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [date, setDate] = React.useState("");
  const [value, setValue] = React.useState("");
  const [note, setNote] = React.useState("");
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    startTransition(async () => {
      const res = await addValuation({
        propertyId: summary.property.id,
        valuationDate: date,
        valueEur: Number(value),
        note: note || null,
      });
      if (res.ok) {
        setAdding(false);
        setDate("");
        setValue("");
        setNote("");
        router.refresh();
        return;
      }
      setBanner(res.error.message);
    });
  }

  const rows = [...summary.valuations].sort((a, b) =>
    b.valuationDate.localeCompare(a.valuationDate),
  );

  return (
    <Card
      title="Valoraciones"
      action={
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          Actualizar valor
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin valoraciones — el inmueble computa a precio de compra (
          <SensitiveValue>{formatEur(summary.property.purchasePriceEur)}</SensitiveValue>).
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((v) => (
            <div key={v.id} className="flex items-center justify-between text-sm">
              <span>
                {v.valuationDate} — <SensitiveValue>{formatEur(v.valueEur)}</SensitiveValue>
                {v.note ? <span className="text-muted-foreground"> · {v.note}</span> : null}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(v.id)}>
                Eliminar
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={adding}
        onOpenChange={(open) => !pending && setAdding(open)}
        title="Actualizar valor del inmueble"
        description="Tasación, reforma o estimación — mueve el equity desde su fecha."
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          {banner ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {banner}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Fecha</span>
              <input
                type="date"
                className={inputClass}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Valor (€)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Nota (opcional)</span>
            <input
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tasación, reforma cocina…"
            />
          </label>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAdding(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !date || !value}>
              {pending ? "Guardando…" : "Guardar valoración"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Eliminar valoración"
        description="El valor vigente volverá a la valoración anterior (o al precio de compra)."
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteValuation({ id: deleting });
          if (res.ok) {
            setDeleting(null);
            router.refresh();
          }
        }}
      />
    </Card>
  );
}
```

- [ ] **Step 5: Stubs de Task 11/12** — crear `EarlyRepaymentModal.tsx` y `RateChangeModal.tsx` (devuelven `null`, mismas props que en Task 11) y `EquityChart.tsx` / `AmortizationTable.tsx` (devuelven `null`, prop `summary`), todos `"use client"` con `import type { PropertySummary }`.

- [ ] **Step 6: Verificar**

Run: `pnpm typecheck && pnpm lint`
Expected: limpio. En dev (3210): registrar el caso canónico y comprobar KPIs (43k equity, 22,3 % en propiedad, cuota 672,93 €, fin a 25 años de la primera cuota), añadir y borrar una valoración, y el vaivén del equity en overview. Dark y light.

- [ ] **Step 7: Commit**

```bash
git add src/components/features/real-estate
git commit -m "feat(real-estate): seccion de inmueble con KPIs, hipoteca y valoraciones"
```

---

### Task 11: UI — modales de amortización anticipada y revisión de tipo (con preview)

**Files:**
- Modify (sustituir stubs): `src/components/features/real-estate/EarlyRepaymentModal.tsx`, `src/components/features/real-estate/RateChangeModal.tsx`

**Interfaces:**
- Consumes: `addMortgageEvent` (Task 5); `buildSchedule`, `summarizeSchedule`, `nextPaymentAfter`, tipos del motor (Task 2/3). El preview se calcula EN CLIENTE con el motor puro: cuadro hipotético = términos + eventos existentes + evento candidato.

Helper compartido para ambos modales — créalo como `src/components/features/real-estate/mortgageClient.ts` (funciones, no componente — no viola «un componente por fichero»):

```ts
import type { MortgageScheduleEvent, MortgageTerms } from "@/src/lib/mortgage";
import type { PropertySummary } from "@/src/server/realEstate";

export function termsOf(summary: PropertySummary): MortgageTerms | null {
  const m = summary.mortgage;
  if (!m) return null;
  return {
    principalEur: m.principalEur,
    nominalRatePct: m.nominalRatePct,
    termMonths: m.termMonths,
    firstPaymentDate: m.firstPaymentDate,
  };
}

export function scheduleEventsOf(summary: PropertySummary): MortgageScheduleEvent[] {
  return summary.events.map((e) =>
    e.type === "early_repayment"
      ? {
          type: "early_repayment" as const,
          eventDate: e.eventDate,
          amountEur: e.amountEur ?? 0,
          mode: e.mode ?? "reduce_installment",
        }
      : { type: "rate_change" as const, eventDate: e.eventDate, newRatePct: e.newRatePct ?? 0 },
  );
}
```

- [ ] **Step 1: EarlyRepaymentModal** — sustituir el stub:

```tsx
"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { addMortgageEvent } from "@/src/actions/realEstate";
import { Button } from "@/src/components/ui/Button";
import { Modal } from "@/src/components/ui/Modal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { buildSchedule, nextPaymentAfter, summarizeSchedule } from "@/src/lib/mortgage";
import type { PropertySummary } from "@/src/server/realEstate";
import { scheduleEventsOf, termsOf } from "./mortgageClient";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

export function EarlyRepaymentModal({
  summary,
  open,
  onOpenChange,
}: {
  summary: PropertySummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [date, setDate] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [mode, setMode] = React.useState<"reduce_term" | "reduce_installment">("reduce_term");
  const [note, setNote] = React.useState("");
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const terms = termsOf(summary);
  const amountEur = Number(amount);
  let preview: string | null = null;
  if (terms && date && amountEur > 0 && amountEur < summary.outstandingEur) {
    const hypothetical = buildSchedule(terms, [
      ...scheduleEventsOf(summary),
      { type: "early_repayment", eventDate: date, amountEur, mode },
    ]);
    const s = summarizeSchedule(terms, hypothetical);
    preview =
      mode === "reduce_term"
        ? `Misma cuota; el préstamo terminaría el ${s.endDate ?? "—"} (intereses totales ${formatEur(s.totalInterestEur)}).`
        : `Nueva cuota: ${formatEur(nextPaymentAfter(hypothetical, date)?.paymentEur ?? 0)} /mes; mismo vencimiento (${s.endDate ?? "—"}).`;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!summary.mortgage) return;
    setBanner(null);
    startTransition(async () => {
      const res = await addMortgageEvent({
        type: "early_repayment",
        mortgageId: summary.mortgage!.id,
        eventDate: date,
        amountEur,
        mode,
        note: note || null,
      });
      if (res.ok) {
        onOpenChange(false);
        setDate("");
        setAmount("");
        setNote("");
        router.refresh();
        return;
      }
      setBanner(res.error.message);
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title="Amortización anticipada"
      description="Reduce el capital pendiente. Elige si prefieres acortar el plazo o bajar la cuota."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {banner ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {banner}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Fecha</span>
            <input
              type="date"
              className={inputClass}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Importe (€)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Efecto</span>
          <select
            className={inputClass}
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="reduce_term">Reducir plazo (misma cuota)</option>
            <option value="reduce_installment">Reducir cuota (mismo plazo)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Nota (opcional)</span>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {preview ? (
          <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
            <SensitiveValue>{preview}</SensitiveValue>
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={pending || !date || !(amountEur > 0)}>
            {pending ? "Guardando…" : "Confirmar amortización"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: RateChangeModal** — sustituir el stub (misma estructura; solo difieren campos y preview):

```tsx
"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { addMortgageEvent } from "@/src/actions/realEstate";
import { Button } from "@/src/components/ui/Button";
import { Modal } from "@/src/components/ui/Modal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { buildSchedule, nextPaymentAfter } from "@/src/lib/mortgage";
import type { PropertySummary } from "@/src/server/realEstate";
import { scheduleEventsOf, termsOf } from "./mortgageClient";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

export function RateChangeModal({
  summary,
  open,
  onOpenChange,
}: {
  summary: PropertySummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [date, setDate] = React.useState("");
  const [rate, setRate] = React.useState("");
  const [note, setNote] = React.useState("");
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const terms = termsOf(summary);
  const newRatePct = Number(rate);
  let preview: string | null = null;
  if (terms && date && newRatePct >= 0 && rate !== "") {
    const hypothetical = buildSchedule(terms, [
      ...scheduleEventsOf(summary),
      { type: "rate_change", eventDate: date, newRatePct },
    ]);
    const next = nextPaymentAfter(hypothetical, date);
    if (next) preview = `Nueva cuota desde ${next.date}: ${formatEur(next.paymentEur)} /mes.`;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!summary.mortgage) return;
    setBanner(null);
    startTransition(async () => {
      const res = await addMortgageEvent({
        type: "rate_change",
        mortgageId: summary.mortgage!.id,
        eventDate: date,
        newRatePct,
        note: note || null,
      });
      if (res.ok) {
        onOpenChange(false);
        setDate("");
        setRate("");
        setNote("");
        router.refresh();
        return;
      }
      setBanner(res.error.message);
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title="Revisión de tipo"
      description="Revisión de Euríbor o novación: nuevo TIN desde la fecha indicada."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {banner ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {banner}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Fecha</span>
            <input
              type="date"
              className={inputClass}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Nuevo TIN (%)</span>
            <input
              type="number"
              min="0"
              step="0.001"
              className={inputClass}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Nota (opcional)</span>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {preview ? (
          <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
            <SensitiveValue>{preview}</SensitiveValue>
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={pending || !date || rate === ""}>
            {pending ? "Guardando…" : "Confirmar revisión"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 3: Verificar**

Run: `pnpm typecheck && pnpm lint`
Expected: limpio. En dev (3210): sobre el caso canónico, abrir «Amortización anticipada» con 20.000 € — el preview en modo plazo debe adelantar el fin varios años; en modo cuota debe bajar de 672,93 €. Confirmar y ver el evento listado, el equity actualizado y el cuadro recalculado. Probar también el rechazo (importe ≥ pendiente ⇒ banner de conflicto). Dark y light.

- [ ] **Step 4: Commit**

```bash
git add src/components/features/real-estate
git commit -m "feat(real-estate): amortizacion anticipada y revision de tipo con preview"
```

---

### Task 12: UI — gráfica de evolución y cuadro de amortización

**Files:**
- Modify (sustituir stubs): `src/components/features/real-estate/EquityChart.tsx`, `src/components/features/real-estate/AmortizationTable.tsx`

**Interfaces:**
- Consumes: `PropertySummary.schedule` (Task 4); `currentValueAt` (Task 3); `DataTable`, `Badge`, `Card`; `formatEur`/`formatEurCompact`.

- [ ] **Step 1: EquityChart** — pasado sólido, futuro discontinuo, capital pendiente descendente:

```tsx
"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatEurCompact } from "@/src/lib/format";
import { currentValueAt } from "@/src/lib/mortgage";
import type { PropertySummary } from "@/src/server/realEstate";

type Point = {
  date: string;
  pendienteEur: number;
  equityPastEur: number | null;
  equityFutureEur: number | null;
};

export function EquityChart({ summary }: { summary: PropertySummary }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const valuations = summary.valuations.map((v) => ({
    valuationDate: v.valuationDate,
    valueEur: v.valueEur,
  }));

  const points: Point[] = React.useMemo(() => {
    const base: { date: string; pendienteEur: number }[] = [
      {
        date: summary.property.purchaseDate,
        pendienteEur: summary.mortgage?.principalEur ?? 0,
      },
      ...summary.schedule.map((r) => ({ date: r.date, pendienteEur: r.remainingEur })),
    ];
    return base.map(({ date, pendienteEur }) => {
      const { valueEur } = currentValueAt(summary.property.purchasePriceEur, valuations, date);
      const equity = valueEur - pendienteEur;
      return {
        date,
        pendienteEur,
        equityPastEur: date <= todayIso ? equity : null,
        // Solapa un punto para que las dos series enlacen sin hueco.
        equityFutureEur: date >= todayIso || date === base.at(-1)?.date ? equity : null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  if (summary.schedule.length === 0) return null;

  return (
    <Card title="Evolución — equity y capital pendiente">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              strokeOpacity={0.45}
              vertical={false}
            />
            <XAxis
              dataKey="date"
              stroke="hsl(var(--muted-foreground))"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
              tickFormatter={(d: string) => d.slice(0, 4)}
              minTickGap={48}
            />
            <YAxis
              className="sensitive"
              stroke="hsl(var(--muted-foreground))"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
              tickFormatter={formatEurCompact}
              width={64}
              domain={[0, "auto"]}
            />
            <Tooltip content={renderTooltip as never} />
            <Line
              type="monotone"
              dataKey="pendienteEur"
              stroke="hsl(var(--chart-2))"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="equityPastEur"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="equityFutureEur"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Equity en sólido (pasado) y discontinuo (proyección); capital pendiente en la serie fina.
        Las valoraciones manuales aparecen como escalones.
      </p>
    </Card>
  );
}

type TooltipPayload = { payload?: Point };

function renderTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const equity = p.equityPastEur ?? p.equityFutureEur;
  return (
    <div className="rounded-md border border-border/70 bg-card/95 px-3 py-2 text-xs shadow-sm">
      <div className="font-medium">{p.date}</div>
      {equity != null ? (
        <div>
          Equity: <SensitiveValue>{formatEur(equity)}</SensitiveValue>
        </div>
      ) : null}
      <div>
        Pendiente: <SensitiveValue>{formatEur(p.pendienteEur)}</SensitiveValue>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: AmortizationTable** — agrupado por años, expandible, mes actual resaltado:

```tsx
"use client";

import * as React from "react";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import { roundEur } from "@/src/lib/money";
import { nextPaymentAfter, type ScheduleRow } from "@/src/lib/mortgage";
import type { PropertySummary } from "@/src/server/realEstate";

export function AmortizationTable({ summary }: { summary: PropertySummary }) {
  const [openYears, setOpenYears] = React.useState<Set<string>>(new Set());
  if (summary.schedule.length === 0) return null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const current = nextPaymentAfter(summary.schedule, todayIso);

  const byYear = new Map<string, ScheduleRow[]>();
  for (const row of summary.schedule) {
    const year = row.date.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), row]);
  }

  const columns: DataTableColumn<ScheduleRow>[] = [
    {
      key: "date",
      header: "Fecha",
      cell: (r) => (
        <span className="flex items-center gap-2">
          {r.date}
          {r.kind === "early_repayment" ? <Badge variant="warning">amortización</Badge> : null}
          {current && r.date === current.date && r.kind === "payment" ? (
            <Badge>actual</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "payment",
      header: "Cuota",
      align: "right",
      cell: (r) => <SensitiveValue>{formatEur(r.paymentEur)}</SensitiveValue>,
    },
    {
      key: "interest",
      header: "Interés",
      align: "right",
      cell: (r) => <SensitiveValue>{formatEur(r.interestEur)}</SensitiveValue>,
    },
    {
      key: "principal",
      header: "Capital",
      align: "right",
      cell: (r) => <SensitiveValue>{formatEur(r.principalEur)}</SensitiveValue>,
    },
    {
      key: "remaining",
      header: "Pendiente",
      align: "right",
      cell: (r) => <SensitiveValue>{formatEur(r.remainingEur)}</SensitiveValue>,
    },
  ];

  function toggle(year: string) {
    setOpenYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  return (
    <Card title="Cuadro de amortización">
      <div className="flex flex-col gap-1">
        {[...byYear.entries()].map(([year, rows]) => {
          const interest = roundEur(rows.reduce((s, r) => s + r.interestEur, 0));
          const principal = roundEur(rows.reduce((s, r) => s + r.principalEur, 0));
          const isOpen = openYears.has(year);
          const isCurrentYear = current?.date.slice(0, 4) === year;
          return (
            <div key={year} className="rounded-lg border border-border/60">
              <button
                type="button"
                onClick={() => toggle(year)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/40"
              >
                <span className="flex items-center gap-2 font-medium">
                  {isOpen ? "▾" : "▸"} {year}
                  {isCurrentYear ? <Badge>en curso</Badge> : null}
                </span>
                <span className="flex gap-6 text-xs text-muted-foreground tabular-nums">
                  <span>
                    Interés <SensitiveValue>{formatEur(interest)}</SensitiveValue>
                  </span>
                  <span>
                    Capital <SensitiveValue>{formatEur(principal)}</SensitiveValue>
                  </span>
                  <span>
                    Pendiente{" "}
                    <SensitiveValue>{formatEur(rows[rows.length - 1].remainingEur)}</SensitiveValue>
                  </span>
                </span>
              </button>
              {isOpen ? (
                <DataTable columns={columns} rows={rows} getRowKey={(r) => `${r.index}`} />
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
```

(Es la única excepción razonable al mandato de primitivas: el header del año es un `<button>` de acordeón, no una acción — si existe `CollapsibleCard` con API compatible, usarlo en su lugar y eliminar el botón crudo.)

- [ ] **Step 3: Verificar**

Run: `pnpm typecheck && pnpm lint`
Expected: limpio. En dev (3210): la gráfica muestra pendiente bajando y equity subiendo hasta 2051, con corte sólido/discontinuo en hoy; añadir una valoración crea el escalón. El cuadro agrupa por años, expande meses, marca «actual» y muestra la fila de amortización anticipada intercalada con su badge. Dark y light.

- [ ] **Step 4: Commit**

```bash
git add src/components/features/real-estate
git commit -m "feat(real-estate): grafica de evolucion y cuadro de amortizacion expandible"
```

---

### Task 13: Documentación, smoke final y Definition of Done

**Files:**
- Modify: `SPEC.md`

- [ ] **Step 1: SPEC.md** — actualizar las secciones que tocan (CLAUDE.md manda: la verdad del producto vive en SPEC):
  - Tabla de rutas: fila `/real-estate` — «Patrimonio inmobiliario: inmuebles, hipoteca francesa derivada de eventos, equity que suma al patrimonio total. UI en español, vertical sin vínculo con cuentas/caja».
  - Entidades: `properties`, `mortgages` (0..1 por inmueble), `mortgage_events`, `property_valuations`, con la regla «el cuadro se deriva, nunca se persiste» y «pasivo = capital vivo; los intereses futuros no computan».
  - §7 (data layer): mencionar `src/server/realEstate.ts`, `src/actions/realEstate.ts`, `src/lib/mortgage.ts`.
  - Nota en el extracto (sección correspondiente): sección «Inmuebles» en md/PDF y `totals.realEstateEquityEur`.
  - Simulador FIRE: dejar constancia explícita de que el equity inmobiliario queda EXCLUIDO del prerrelleno (decisión de diseño, no omisión).

- [ ] **Step 2: Suite completa**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: todo verde, build sin errores.

- [ ] **Step 3: Smoke DB vacía** — arrancar dev (3210) contra un DB fresco (`DATABASE_URL=data/smoke-test.db pnpm dev`, borrar el fichero después): `/real-estate` muestra estado vacío sin errores; overview, extracto y sus exportaciones funcionan sin inmuebles (sin línea/sección inmobiliaria); `pnpm tg:net` sin línea «Inmobiliario». Después, registrar el caso canónico y verificar los criterios de aceptación del spec (§Criterios): +43.000 € exactos en overview, P&L intacto, cuadro coincidente con un simulador bancario, extracto md/PDF con sección, FIRE inalterado.

- [ ] **Step 4: Verificación visual dark/light** — recorrer `/real-estate`, overview y el PDF del extracto en ambos temas (dev 3210 + Playwright global, según la práctica de verificación visual del proyecto).

- [ ] **Step 5: Checklist Definition of Done (CLAUDE.md)** — repasar una a una: migración generada, sin env vars nuevas (no aplica), audit + revalidate en todas las mutaciones, `<SensitiveValue>` en todo render monetario nuevo (KPIs, cards, tooltips de chart, tabla, previews de modales, PDF), smoke DB vacía OK.

- [ ] **Step 6: Commit final**

```bash
git add SPEC.md
git commit -m "docs(spec): vertical de patrimonio inmobiliario /real-estate"
```

---

## Notas de ejecución

- **Puerto 3200 intocable**: lo sirve launchd (`com.finances.app`). Dev siempre en 3210. No matar ni build sobre el proceso servido; para desplegar al final: `pnpm build` y `launchctl kickstart -k gui/$(id -u)/com.finances.app`.
- **No commitear** `data/` ni el SQLite.
- Si `pnpm lint` (guard `scripts/check-migrations.mjs`) protesta por las mutaciones nuevas, leer el guard y cumplir su contrato (existe para exigir la disciplina de acciones — no silenciarlo).
- El día del test canónico importa: `seedCanon` usa fechas de agosto/septiembre 2026. Los tests del motor son independientes del reloj; los de lecturas fijan `todayIso` explícito — mantener esa disciplina en cualquier test nuevo (nunca depender de `Date.now()` implícito).

