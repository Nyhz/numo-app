# Extracto a fecha + formato Markdown + PDF profesional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exportar el extracto de `/statement` reconstruido a una fecha pasada exacta (`?asOf=YYYY-MM-DD`), añadir el formato Markdown al listado de exportaciones, y profesionalizar el PDF (fix del solape de la sección 2, más aire, sin subtítulos didácticos).

**Architecture:** El coste medio ponderado se extrae a un helper puro `foldLedger` compartido entre el recompute de escritura y una nueva ruta de lectura as-of en `src/server/statement.ts` que reproduce `asset_transactions` hasta el corte, toma la última `asset_valuations ≤ fecha` como precio y calcula el efectivo con `openingBalance + Σ movimientos ≤ corte`. Un `assembleReport` común garantiza paridad al céntimo entre el camino actual y el as-of. La ruta de export valida `asOf`, gana el formato `md`, y el menú cliente gana un date picker.

**Tech Stack:** Next 16 (App Router, Server Components), Drizzle + better-sqlite3, Vitest, jsPDF.

**Spec:** `docs/superpowers/specs/2026-07-05-statement-asof-md-pdf-design.md`

## Global Constraints

- TypeScript strict; sin `any` sin comentario justificativo.
- Sin SQL crudo en código de app: query builder de Drizzle (el helper `` sql`...` `` de Drizzle está permitido; ya se usa en `recompute.ts` y `overview.ts`).
- UI íntegramente en español; valores de enum/DB en inglés con mapas de etiquetas.
- Los tests no tocan red; DB en memoria con las migraciones de `drizzle/`.
- Sin migraciones nuevas (no hay columnas nuevas), sin env vars nuevas.
- Los handlers de ruta usan exports con nombre (`GET`), nunca default.
- Dinero siempre EUR en las columnas EUR; formato es-ES en documentos de salida.
- Commits frecuentes, mensajes estilo `feat(statement): …` / `fix(pdf): …` como en el historial.

---

### Task 1: `foldLedger` — extraer el replay de coste medio a un helper puro compartido

**Files:**
- Modify: `src/server/recompute.ts`
- Test: `src/server/__tests__/recompute-fold.test.ts` (create)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `export type LedgerTrade`, `export type LedgerFold`, `export function foldLedger(rows: LedgerTrade[]): LedgerFold` en `src/server/recompute.ts`. Task 2 los importa.

- [ ] **Step 1: Write the failing test**

Crear `src/server/__tests__/recompute-fold.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { foldLedger, type LedgerTrade } from "../recompute";

function buy(quantity: number, grossEur: number, feesEur = 0, fx = 1): LedgerTrade {
  return {
    transactionType: "buy",
    quantity,
    tradeGrossAmount: grossEur / fx,
    tradeGrossAmountEur: grossEur,
    feesAmount: feesEur / fx,
    feesAmountEur: feesEur,
    fxRateToEur: fx,
  };
}

function sell(quantity: number): LedgerTrade {
  return {
    transactionType: "sell",
    quantity,
    tradeGrossAmount: 0,
    tradeGrossAmountEur: 0,
    feesAmount: 0,
    feesAmountEur: 0,
    fxRateToEur: 1,
  };
}

describe("foldLedger", () => {
  it("acumula compras con comisiones en el pool de coste", () => {
    const fold = foldLedger([buy(10, 1000, 5)]);
    expect(fold.qty).toBe(10);
    expect(fold.totalCostEur).toBeCloseTo(1005);
    expect(fold.totalCostNative).toBeCloseTo(1005);
  });

  it("deriva la comisión nativa del snapshot EUR cuando hay FX", () => {
    // 100 USD brutos a fx 0.9 (=90 €), comisión 2 € → nativo = 100 + 2/0.9
    const fold = foldLedger([buy(1, 90, 2, 0.9)]);
    expect(fold.totalCostEur).toBeCloseTo(92);
    expect(fold.totalCostNative).toBeCloseTo(100 + 2 / 0.9);
  });

  it("una venta parcial reduce el pool proporcionalmente", () => {
    const fold = foldLedger([buy(10, 1000), sell(4)]);
    expect(fold.qty).toBe(6);
    expect(fold.totalCostEur).toBeCloseTo(600);
  });

  it("vender sin posición es defensivo: no toca el coste", () => {
    const fold = foldLedger([sell(3)]);
    expect(fold.qty).toBeLessThanOrEqual(0);
    expect(fold.totalCostEur).toBe(0);
  });

  it("dividendos y fees no alteran cantidad ni coste", () => {
    const dividend: LedgerTrade = { ...sell(0), transactionType: "dividend", quantity: 1 };
    const fold = foldLedger([buy(5, 500), dividend]);
    expect(fold.qty).toBe(5);
    expect(fold.totalCostEur).toBeCloseTo(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/__tests__/recompute-fold.test.ts`
Expected: FAIL — `foldLedger` no está exportado.

- [ ] **Step 3: Implement `foldLedger` and rewire `recomputeAssetPosition`**

En `src/server/recompute.ts`, añadir sobre `recomputeAssetPosition`:

```ts
export type LedgerTrade = {
  transactionType: string;
  quantity: number;
  tradeGrossAmount: number;
  tradeGrossAmountEur: number;
  feesAmount: number;
  feesAmountEur: number;
  fxRateToEur: number;
};

export type LedgerFold = {
  /** Cantidad tras el replay, redondeada a 10dp. ≤ 0 ⇒ posición cerrada. */
  qty: number;
  totalCostNative: number;
  totalCostEur: number;
};

/**
 * Replay de coste medio ponderado sobre filas de asset_transactions en orden
 * cronológico. Única fuente de verdad de la matemática de coste: la consumen
 * el recompute de escritura y la lectura as-of del extracto.
 */
export function foldLedger(rows: LedgerTrade[]): LedgerFold {
  let qty = 0;
  let totalCostNative = 0;
  let totalCostEur = 0;

  for (const row of rows) {
    if (row.transactionType === "buy") {
      qty += row.quantity;
      // feesAmount may be denominated in EUR (degiro import, manual entry) —
      // derive the native-unit fee from the EUR snapshot instead of trusting
      // it, so the native cost pool never mixes currencies.
      totalCostNative +=
        row.tradeGrossAmount +
        (row.fxRateToEur > 0 ? row.feesAmountEur / row.fxRateToEur : row.feesAmount);
      totalCostEur += row.tradeGrossAmountEur + row.feesAmountEur;
    } else if (row.transactionType === "sell") {
      if (qty <= 0) {
        // Defensive: selling with no position; treat as no-op for cost basis.
        qty -= row.quantity;
        continue;
      }
      const fraction = Math.min(1, row.quantity / qty);
      totalCostNative -= totalCostNative * fraction;
      totalCostEur -= totalCostEur * fraction;
      qty -= row.quantity;
    }
    // dividend / fee: do not affect position quantity or cost basis here;
    // cash impact is captured on the paired cash_movement.
  }

  return { qty: round(qty, 10), totalCostNative, totalCostEur };
}
```

Y en `recomputeAssetPosition`, sustituir el bucle inline (desde `let qty = 0;` hasta `qty = round(qty, 10);` inclusive) por:

```ts
  const { qty, totalCostNative, totalCostEur } = foldLedger(rows);
```

El resto de la función queda igual (el `if (qty <= 0)`, los `round(totalCostNative / qty)`, el upsert).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/server/__tests__/recompute-fold.test.ts src/server/__tests__`
Expected: PASS (el fold nuevo y toda la suite de server, que ejercita `recomputeAssetPosition` vía acciones).

- [ ] **Step 5: Commit**

```bash
git add src/server/recompute.ts src/server/__tests__/recompute-fold.test.ts
git commit -m "refactor(recompute): extrae foldLedger como helper puro compartido"
```

---

### Task 2: Extracto as-of en `getStatementReport`

**Files:**
- Modify: `src/server/statement.ts`
- Modify: `src/lib/exports/__tests__/statement.test.ts` (el sample gana `asOf: null`)
- Test: `src/server/__tests__/statement.test.ts`

**Interfaces:**
- Consumes: `foldLedger`, `LedgerTrade` de `src/server/recompute.ts` (Task 1); `isCashBearingAccount` de `src/lib/domain.ts`; `round`, `roundEur` de `src/lib/money.ts`.
- Produces: `getStatementReport(db?: DB, opts?: { asOf?: string }): Promise<StatementReport>`; `StatementReport` gana el campo `asOf: string | null`. Tasks 3–7 dependen de ambos.

- [ ] **Step 1: Write the failing tests**

En `src/server/__tests__/statement.test.ts`, generalizar dos helpers y añadir un bloque nuevo. Primero sustituir `seedValuation` y `seedBuy` por versiones parametrizables (mismos call-sites existentes siguen funcionando):

```ts
function seedValuation(
  db: DB,
  assetId: string,
  quantity: number,
  unitPriceEur: number,
  valuationDate = "2026-06-08",
): void {
  db.insert(schema.assetValuations)
    .values({
      id: ulid(),
      assetId,
      valuationDate,
      quantity,
      unitPriceEur,
      marketValueEur: quantity * unitPriceEur,
      priceSource: "rebuilt",
    })
    .run();
}

function seedBuy(
  db: DB,
  accountId: string,
  assetId: string,
  grossEur: number,
  opts: { tradedAt?: number; quantity?: number } = {},
): void {
  db.insert(schema.assetTransactions)
    .values({
      id: ulid(),
      accountId,
      assetId,
      transactionType: "buy",
      tradedAt: opts.tradedAt ?? Date.UTC(2026, 0, 5, 12),
      quantity: opts.quantity ?? 1,
      unitPrice: grossEur / (opts.quantity ?? 1),
      tradeCurrency: "EUR",
      fxRateToEur: 1,
      tradeGrossAmount: grossEur,
      tradeGrossAmountEur: grossEur,
      cashImpactEur: -grossEur,
      feesAmount: 0,
      feesAmountEur: 0,
      netAmountEur: -grossEur,
      rowFingerprint: ulid(),
    })
    .run();
}

function seedSell(
  db: DB,
  accountId: string,
  assetId: string,
  quantity: number,
  grossEur: number,
  tradedAt: number,
): void {
  db.insert(schema.assetTransactions)
    .values({
      id: ulid(),
      accountId,
      assetId,
      transactionType: "sell",
      tradedAt,
      quantity,
      unitPrice: grossEur / quantity,
      tradeCurrency: "EUR",
      fxRateToEur: 1,
      tradeGrossAmount: grossEur,
      tradeGrossAmountEur: grossEur,
      cashImpactEur: grossEur,
      feesAmount: 0,
      feesAmountEur: 0,
      netAmountEur: grossEur,
      rowFingerprint: ulid(),
    })
    .run();
}

function seedCashMovement(
  db: DB,
  accountId: string,
  amountEur: number,
  occurredAt: number,
): void {
  db.insert(schema.accountCashMovements)
    .values({
      id: ulid(),
      accountId,
      movementType: amountEur >= 0 ? "deposit" : "withdrawal",
      occurredAt,
      amount: amountEur,
      currency: "EUR",
      fxRateToEur: 1,
      amountEur,
      cashImpactEur: amountEur,
      affectsCashBalance: true,
      rowFingerprint: ulid(),
    })
    .run();
}
```

> Nota: comprobar los nombres exactos de columnas de `account_cash_movements` en `src/db/schema/cash_movements.ts` al implementar (`amount`/`amountEur` pueden llamarse distinto); ajustar el helper a las columnas reales `occurredAt`, `cashImpactEur`, `affectsCashBalance`, que son las que importan.

Después añadir el describe nuevo al final del fichero:

```ts
describe("getStatementReport as-of", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  const JAN10 = Date.UTC(2026, 0, 10, 12);
  const MAR01 = Date.UTC(2026, 2, 1, 12);
  const MAY01 = Date.UTC(2026, 4, 1, 12);

  it("una compra posterior al corte no cuenta (cantidad ni coste)", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    const etf = seedAsset(db, "MSCI World", "etf");
    seedBuy(db, broker, etf, 1000, { tradedAt: JAN10, quantity: 10 });
    seedBuy(db, broker, etf, 500, { tradedAt: MAY01, quantity: 5 });
    seedValuation(db, etf, 10, 110, "2026-02-27");

    const report = await getStatementReport(db, { asOf: "2026-03-31" });
    expect(report.asOf).toBe("2026-03-31");
    const line = report.groups[0].lines[0];
    expect(line.quantity).toBe(10);
    expect(line.costEur).toBeCloseTo(1000);
    expect(line.marketValueEur).toBeCloseTo(10 * 110);
  });

  it("usa la última valoración ≤ fecha, nunca una posterior", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    const etf = seedAsset(db, "MSCI World", "etf");
    seedBuy(db, broker, etf, 1000, { tradedAt: JAN10, quantity: 10 });
    seedValuation(db, etf, 10, 105, "2026-03-20");
    seedValuation(db, etf, 10, 130, "2026-04-15");

    const report = await getStatementReport(db, { asOf: "2026-03-31" });
    const line = report.groups[0].lines[0];
    expect(line.unitPriceEur).toBeCloseTo(105);
    expect(line.valuationDate).toBe("2026-03-20");
    expect(report.totals.investedMarketValueEur).toBeCloseTo(1050);
  });

  it("una venta parcial antes del corte reduce cantidad y coste proporcionalmente", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    const etf = seedAsset(db, "MSCI World", "etf");
    seedBuy(db, broker, etf, 1000, { tradedAt: JAN10, quantity: 10 });
    seedSell(db, broker, etf, 4, 480, MAR01);
    seedValuation(db, etf, 6, 120, "2026-03-30");

    const report = await getStatementReport(db, { asOf: "2026-03-31" });
    const line = report.groups[0].lines[0];
    expect(line.quantity).toBe(6);
    expect(line.costEur).toBeCloseTo(600);
  });

  it("posición cerrada a la fecha no aparece; abierta a la fecha y cerrada hoy sí", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    const etf = seedAsset(db, "MSCI World", "etf");
    seedBuy(db, broker, etf, 1000, { tradedAt: JAN10, quantity: 10 });
    seedSell(db, broker, etf, 10, 1200, MAY01); // cerrada en mayo
    seedValuation(db, etf, 10, 110, "2026-03-30");

    const march = await getStatementReport(db, { asOf: "2026-03-31" });
    expect(march.totals.positionsCount).toBe(1);

    const june = await getStatementReport(db, { asOf: "2026-06-30" });
    expect(june.totals.positionsCount).toBe(0);
  });

  it("el efectivo se acota por occurredAt", async () => {
    const savings = seedAccount(db, "MyInvestor", "savings");
    seedCashMovement(db, savings, 1000, JAN10);
    seedCashMovement(db, savings, 500, MAY01);

    const report = await getStatementReport(db, { asOf: "2026-03-31" });
    const account = report.accounts.find((a) => a.name === "MyInvestor");
    expect(account?.cashEur).toBeCloseTo(1000);
    expect(report.totals.cashEur).toBeCloseTo(1000);
  });

  it("asOf = hoy coincide con el informe sin asOf", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    const savings = seedAccount(db, "MyInvestor", "savings");
    const etf = seedAsset(db, "MSCI World", "etf");
    seedBuy(db, broker, etf, 1000, { tradedAt: JAN10, quantity: 10 });
    seedPosition(db, etf, 10, 1000); // camino actual lee asset_positions
    seedValuation(db, etf, 10, 120, "2026-06-08");
    seedCashMovement(db, savings, 500, JAN10);
    // El camino actual lee accounts.currentCashBalanceEur materializado.
    db.update(schema.accounts)
      .set({ currentCashBalanceEur: 500 })
      .where(eq(schema.accounts.id, savings))
      .run();

    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const live = await getStatementReport(db);
    const asOf = await getStatementReport(db, { asOf: todayIso });

    expect(asOf.totals).toEqual({ ...live.totals });
    expect(asOf.accounts.map((a) => [a.name, a.cashEur, a.investedEur])).toEqual(
      live.accounts.map((a) => [a.name, a.cashEur, a.investedEur]),
    );
    expect(live.asOf).toBeNull();
  });
});
```

Añadir `import { eq } from "drizzle-orm";` a la cabecera del fichero de test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/server/__tests__/statement.test.ts`
Expected: FAIL — `getStatementReport` no acepta `opts` y `report.asOf` no existe (error de compilación de vitest/TS).

- [ ] **Step 3: Implement the as-of path in `src/server/statement.ts`**

Reescribir `src/server/statement.ts` con esta estructura (los tipos `StatementAssetLine`, `StatementGroup`, `StatementAccountLine`, `StatementTotals` y `groupAssetLines` quedan exactamente como están):

1. Cabecera de imports:

```ts
import { and, asc, eq, inArray, lte, max, or, sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  assets,
  assetTransactions,
  assetValuations,
  type Asset,
  type AssetValuation,
} from "../db/schema";
import { isCashBearingAccount } from "../lib/domain";
import { round, roundEur } from "../lib/money";
import { foldLedger } from "./recompute";
import { listAccounts } from "./accounts";
import { listPositions } from "./positions";
```

2. `StatementReport` gana el campo:

```ts
export type StatementReport = {
  generatedAt: number;
  /** Fecha de corte ISO cuando el extracto es reconstruido; null = actual. */
  asOf: string | null;
  totals: StatementTotals;
  groups: StatementGroup[];
  accounts: StatementAccountLine[];
};
```

3. `toLine` pasa a operar sobre un input neutral (misma matemática):

```ts
type LineInput = {
  asset: Asset;
  quantity: number;
  costEur: number;
  unitPriceEur: number | null;
  valuationDate: string | null;
};

function toLine(input: LineInput, totalMarketValueEur: number): StatementAssetLine {
  const marketValueEur =
    input.unitPriceEur != null ? input.quantity * input.unitPriceEur : null;
  const costEur = input.costEur;
  const pnlEur = marketValueEur != null ? marketValueEur - costEur : null;
  return {
    assetId: input.asset.id,
    name: input.asset.name,
    assetType: input.asset.assetType,
    symbol: input.asset.ticker ?? input.asset.symbol,
    isin: input.asset.isin,
    currency: input.asset.currency,
    quantity: input.quantity,
    unitPriceEur: input.unitPriceEur,
    marketValueEur,
    costEur,
    pnlEur,
    pnlPct: pnlEur != null && costEur > 0 ? pnlEur / costEur : null,
    weight:
      marketValueEur != null && totalMarketValueEur > 0
        ? marketValueEur / totalMarketValueEur
        : null,
    valuationDate: input.valuationDate,
  };
}
```

4. Núcleo compartido — el tramo final actual de `getStatementReport` se convierte en:

```ts
type AssemblyInput = {
  asOf: string | null;
  lines: LineInput[]; // solo posiciones abiertas (quantity > 0)
  accounts: Array<Omit<StatementAccountLine, "investedEur" | "totalEur">>;
  investedByAccount: Map<string, number>;
};

function assembleReport(input: AssemblyInput): StatementReport {
  const investedMarketValueEur = input.lines.reduce(
    (acc, l) => acc + (l.unitPriceEur != null ? l.quantity * l.unitPriceEur : 0),
    0,
  );
  const lines = input.lines.map((l) => toLine(l, investedMarketValueEur));
  const groups = groupAssetLines(lines, investedMarketValueEur);

  const accounts: StatementAccountLine[] = input.accounts
    .map((account) => {
      const investedEur = input.investedByAccount.get(account.accountId) ?? 0;
      return { ...account, investedEur, totalEur: account.cashEur + investedEur };
    })
    .sort((a, b) => b.totalEur - a.totalEur);

  // P&L pct only over the cost of lines that actually have a valuation —
  // mixing unvalued cost into the denominator would understate the return.
  const valuedCostEur = lines.reduce(
    (acc, l) => acc + (l.marketValueEur != null ? l.costEur : 0),
    0,
  );
  const investedCostEur = lines.reduce((acc, l) => acc + l.costEur, 0);
  const unrealizedPnlEur = investedMarketValueEur - valuedCostEur;
  const cashEur = accounts.reduce((acc, a) => acc + a.cashEur, 0);

  return {
    generatedAt: Date.now(),
    asOf: input.asOf,
    totals: {
      investedMarketValueEur,
      investedCostEur,
      unrealizedPnlEur,
      unrealizedPnlPct: valuedCostEur > 0 ? unrealizedPnlEur / valuedCostEur : null,
      cashEur,
      netWorthEur: investedMarketValueEur + cashEur,
      positionsCount: lines.length,
      accountsCount: accounts.length,
    },
    groups,
    accounts,
  };
}
```

5. El camino actual queda así (`primaryAccountByAsset` no cambia):

```ts
export async function getStatementReport(
  db: DB = defaultDb,
  opts: { asOf?: string } = {},
): Promise<StatementReport> {
  if (opts.asOf) return statementReportAsOf(opts.asOf, db);

  const [positions, accountsList] = await Promise.all([
    listPositions(db),
    listAccounts(db),
  ]);
  const assetAccount = primaryAccountByAsset(db);

  const open = positions.filter((row) => row.position.quantity > 0);
  const lineInputs: LineInput[] = open.map((row) => ({
    asset: row.asset,
    quantity: row.position.quantity,
    costEur: row.position.totalCostEur,
    unitPriceEur: row.valuation?.unitPriceEur ?? null,
    valuationDate: row.valuation?.valuationDate ?? null,
  }));

  const investedByAccount = new Map<string, number>();
  for (const row of open) {
    const accountId = assetAccount.get(row.position.assetId);
    if (!accountId || row.valuationEur == null) continue;
    investedByAccount.set(
      accountId,
      (investedByAccount.get(accountId) ?? 0) + row.valuationEur,
    );
  }

  return assembleReport({
    asOf: null,
    lines: lineInputs,
    accounts: accountsList.map((a) => ({
      accountId: a.id,
      name: a.name,
      accountType: a.accountType,
      currency: a.currency,
      cashEur: a.totalBalanceEur,
    })),
    investedByAccount,
  });
}
```

6. El camino as-of:

```ts
/** Última valoración ≤ asOf por activo, mismo patrón de dos queries que
 *  latestValuationsFor en positions.ts pero acotado en fecha. */
async function valuationsAsOf(
  assetIds: string[],
  asOf: string,
  db: DB,
): Promise<Map<string, AssetValuation>> {
  if (assetIds.length === 0) return new Map();
  const latest = await db
    .select({
      assetId: assetValuations.assetId,
      latestDate: max(assetValuations.valuationDate),
    })
    .from(assetValuations)
    .where(
      and(
        inArray(assetValuations.assetId, assetIds),
        lte(assetValuations.valuationDate, asOf),
      ),
    )
    .groupBy(assetValuations.assetId)
    .all();
  const pairs = latest.filter(
    (r): r is { assetId: string; latestDate: string } => r.latestDate != null,
  );
  if (pairs.length === 0) return new Map();
  const rows = await db
    .select()
    .from(assetValuations)
    .where(
      or(
        ...pairs.map((pair) =>
          and(
            eq(assetValuations.assetId, pair.assetId),
            eq(assetValuations.valuationDate, pair.latestDate),
          ),
        ),
      ),
    )
    .all();
  return new Map(rows.map((v) => [v.assetId, v]));
}

/**
 * Extracto reconstruido a fin de día LOCAL de `asOf`: replay del ledger para
 * cantidades y coste (misma media ponderada que recomputeAssetPosition, vía
 * foldLedger), última valoración ≤ asOf como precio, y efectivo =
 * openingBalance + Σ movimientos ≤ corte (recomputeAccountCashBalance acotado).
 */
async function statementReportAsOf(asOf: string, db: DB): Promise<StatementReport> {
  const cutoffMs = new Date(`${asOf}T23:59:59.999`).getTime();

  const trades = await db
    .select()
    .from(assetTransactions)
    .where(lte(assetTransactions.tradedAt, cutoffMs))
    .orderBy(asc(assetTransactions.tradedAt), asc(assetTransactions.id))
    .all();

  const tradesByAsset = new Map<string, typeof trades>();
  const lastAccountByAsset = new Map<string, string>();
  const tradedAccountIds = new Set<string>();
  for (const t of trades) {
    const bucket = tradesByAsset.get(t.assetId) ?? [];
    bucket.push(t);
    tradesByAsset.set(t.assetId, bucket);
    lastAccountByAsset.set(t.assetId, t.accountId); // cronológico → gana el último
    tradedAccountIds.add(t.accountId);
  }

  const held: Array<{ assetId: string; quantity: number; costEur: number }> = [];
  for (const [assetId, rows] of tradesByAsset) {
    const fold = foldLedger(rows);
    if (fold.qty <= 0) continue;
    // Mismo redondeo que persiste recomputeAssetPosition → paridad al céntimo.
    held.push({ assetId, quantity: fold.qty, costEur: round(fold.totalCostEur) });
  }

  const heldIds = held.map((h) => h.assetId);
  const [assetRows, valuationByAsset] = await Promise.all([
    heldIds.length > 0
      ? db.select().from(assets).where(inArray(assets.id, heldIds)).all()
      : Promise.resolve([] as Asset[]),
    valuationsAsOf(heldIds, asOf, db),
  ]);
  const assetById = new Map(assetRows.map((a) => [a.id, a]));

  const lineInputs: LineInput[] = [];
  const investedByAccount = new Map<string, number>();
  for (const h of held) {
    const asset = assetById.get(h.assetId);
    if (!asset) continue;
    const valuation = valuationByAsset.get(h.assetId) ?? null;
    lineInputs.push({
      asset,
      quantity: h.quantity,
      costEur: h.costEur,
      unitPriceEur: valuation?.unitPriceEur ?? null,
      valuationDate: valuation?.valuationDate ?? null,
    });
    const accountId = lastAccountByAsset.get(h.assetId);
    if (!accountId || valuation == null) continue;
    investedByAccount.set(
      accountId,
      (investedByAccount.get(accountId) ?? 0) + h.quantity * valuation.unitPriceEur,
    );
  }

  const movementSums = await db
    .select({
      accountId: accountCashMovements.accountId,
      total: sql<number>`coalesce(sum(case when ${accountCashMovements.affectsCashBalance} = 1 then ${accountCashMovements.cashImpactEur} else 0 end), 0)`,
    })
    .from(accountCashMovements)
    .where(lte(accountCashMovements.occurredAt, cutoffMs))
    .groupBy(accountCashMovements.accountId)
    .all();
  const sumByAccount = new Map(movementSums.map((r) => [r.accountId, r.total]));

  const accountRows = await db.select().from(accounts).orderBy(asc(accounts.name)).all();
  const accountLines = accountRows
    // Existía a la fecha, o tiene actividad ≤ corte (cubre backfills con
    // createdAt posterior a los hechos).
    .filter(
      (a) => a.createdAt <= cutoffMs || sumByAccount.has(a.id) || tradedAccountIds.has(a.id),
    )
    .map((a) => ({
      accountId: a.id,
      name: a.name,
      accountType: a.accountType,
      currency: a.currency,
      cashEur: isCashBearingAccount(a.accountType)
        ? roundEur(a.openingBalanceEur + (sumByAccount.get(a.id) ?? 0))
        : 0,
    }));

  return assembleReport({
    asOf,
    lines: lineInputs,
    accounts: accountLines,
    investedByAccount,
  });
}
```

> Al implementar, verificar en `src/lib/money.ts` las firmas exactas de `round(n, dp?)` y `roundEur(n)` (ya las usa `recompute.ts` con `round(x)` a 2dp por defecto).

7. En `src/lib/exports/__tests__/statement.test.ts`, el `sample()` necesita el campo nuevo: añadir `asOf: null,` justo después de `generatedAt: …`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/server/__tests__/statement.test.ts src/lib/exports/__tests__/statement.test.ts && pnpm typecheck`
Expected: PASS ambos ficheros; typecheck sin errores (page.tsx y route.ts llaman `getStatementReport()` sin opts — sigue compilando).

- [ ] **Step 5: Commit**

```bash
git add src/server/statement.ts src/server/__tests__/statement.test.ts src/lib/exports/__tests__/statement.test.ts
git commit -m "feat(statement): extracto reconstruido a fecha (asOf) con paridad al céntimo"
```

---

### Task 3: Builder Markdown (`buildStatementMd`)

**Files:**
- Modify: `src/lib/labels.ts` (gana `ASSET_TYPE_LABELS` + `assetTypeLabel`)
- Modify: `src/lib/pdf/_kit.ts` (delega sus etiquetas en labels.ts)
- Create: `src/lib/exports/statement-md.ts`
- Test: `src/lib/exports/__tests__/statement-md.test.ts` (create)

**Interfaces:**
- Consumes: `StatementReport` (con `asOf`, Task 2).
- Produces: `export function buildStatementMd(report: StatementReport): string`; `export function assetTypeLabel(type: string): string` en `src/lib/labels.ts`. Task 4 importa `buildStatementMd`.

- [ ] **Step 1: Write the failing test**

Crear `src/lib/exports/__tests__/statement-md.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { StatementReport } from "../../../server/statement";
import { buildStatementMd } from "../statement-md";

const sample = (asOf: string | null = null): StatementReport => ({
  generatedAt: Date.UTC(2026, 5, 9, 10, 30),
  asOf,
  totals: {
    investedMarketValueEur: 1700,
    investedCostEur: 1600,
    unrealizedPnlEur: 100,
    unrealizedPnlPct: 100 / 1600,
    cashEur: 500,
    netWorthEur: 2200,
    positionsCount: 2,
    accountsCount: 2,
  },
  groups: [
    {
      assetType: "etf",
      marketValueEur: 1200,
      costEur: 1000,
      pnlEur: 200,
      weight: 1200 / 1700,
      lines: [
        {
          assetId: "a1",
          name: "MSCI | World",
          assetType: "etf",
          symbol: "IWDA",
          isin: "IE00B4L5Y983",
          currency: "EUR",
          quantity: 10,
          unitPriceEur: 120,
          marketValueEur: 1200,
          costEur: 1000,
          pnlEur: 200,
          pnlPct: 0.2,
          weight: 1200 / 1700,
          valuationDate: "2026-06-08",
        },
      ],
    },
  ],
  accounts: [
    {
      accountId: "acc1",
      name: "Degiro",
      accountType: "broker",
      currency: "EUR",
      cashEur: 0,
      investedEur: 1200,
      totalEur: 1200,
    },
    {
      accountId: "acc2",
      name: "MyInvestor",
      accountType: "savings",
      currency: "EUR",
      cashEur: 500,
      investedEur: 0,
      totalEur: 500,
    },
  ],
});

describe("buildStatementMd", () => {
  it("titula con la fecha de generación y estructura el documento", () => {
    const md = buildStatementMd(sample());
    expect(md).toContain("# Extracto de cartera — 2026-06-09");
    expect(md).toContain("## Resumen");
    expect(md).toContain("| Patrimonio total | 2.200,00 € |");
    expect(md).toContain("| Plusvalía latente | 100,00 € (+6,25 %) |");
    expect(md).toContain("### ETF — 70,6 % de lo invertido");
    expect(md).toContain("## Cuentas");
    expect(md).toContain("**Patrimonio total: 2.200,00 €**");
  });

  it("titula con asOf cuando el extracto es a fecha", () => {
    const md = buildStatementMd(sample("2026-03-31"));
    expect(md).toContain("# Extracto de cartera — 2026-03-31");
    expect(md).toContain("Generado el 2026-06-09");
  });

  it("escapa pipes en nombres y formatea es-ES", () => {
    const md = buildStatementMd(sample());
    expect(md).toContain("MSCI \\| World");
    expect(md).toContain("1.200,00 €");
    expect(md).toContain("+20,00 %");
  });

  it("una línea sin valorar muestra guiones, no ceros", () => {
    const report = sample();
    const line = report.groups[0].lines[0];
    line.unitPriceEur = null;
    line.marketValueEur = null;
    line.pnlEur = null;
    line.pnlPct = null;
    line.weight = null;
    line.valuationDate = null;
    const md = buildStatementMd(report);
    expect(md).toMatch(/MSCI \\\| World.*—/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/exports/__tests__/statement-md.test.ts`
Expected: FAIL — módulo `../statement-md` no existe.

- [ ] **Step 3: Implement labels + builder**

En `src/lib/labels.ts` añadir al final:

```ts
export const ASSET_TYPE_LABELS: Record<string, string> = {
  crypto: "Cripto",
  etf: "ETF",
  stock: "Acciones",
  bond: "Bonos",
  fund: "Fondos",
  "cash-equivalent": "Efectivo",
  other: "Otros",
};

export function assetTypeLabel(type: string): string {
  return ASSET_TYPE_LABELS[type] ?? type;
}
```

En `src/lib/pdf/_kit.ts`, borrar el bloque local `export const ASSET_TYPE_LABELS … export function assetTypeLabelPdf …` (líneas finales) y sustituirlo por:

```ts
import { ASSET_TYPE_LABELS } from "../labels";

export { ASSET_TYPE_LABELS };

export function assetTypeLabelPdf(type: string): string {
  return ASSET_TYPE_LABELS[type] ?? type;
}
```

(El `import` va arriba del fichero con los demás imports; el re-export mantiene compatibilidad con cualquier consumidor actual.)

Crear `src/lib/exports/statement-md.ts`:

```ts
import type { StatementReport } from "../../server/statement";
import { accountTypeLabel, assetTypeLabel } from "../labels";

function eur(value: number | null): string {
  if (value == null) return "—";
  return `${value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function pct(ratio: number | null): string {
  if (ratio == null) return "—";
  const value = ratio * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2).replace(".", ",")} %`;
}

function weightPct(ratio: number | null): string {
  return ratio == null ? "—" : `${(ratio * 100).toFixed(1).replace(".", ",")} %`;
}

function qty(value: number): string {
  return value.toLocaleString("es-ES", { maximumFractionDigits: 8 });
}

/** Los pipes rompen las tablas Markdown; los nombres de activo pueden traerlos. */
function esc(value: string | null): string {
  return value == null ? "—" : value.replace(/\|/g, "\\|");
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function buildStatementMd(report: StatementReport): string {
  const t = report.totals;
  const stamp = report.asOf ?? isoDate(report.generatedAt);
  const out: string[] = [];

  out.push(`# Extracto de cartera — ${stamp}`);
  out.push("");
  out.push(
    `Generado el ${isoDate(report.generatedAt)} · ${t.positionsCount} posiciones abiertas en ${t.accountsCount} cuenta${t.accountsCount === 1 ? "" : "s"} · valoración en EUR`,
  );
  out.push("");

  out.push("## Resumen");
  out.push("");
  out.push("| Concepto | Valor |");
  out.push("| --- | ---: |");
  out.push(`| Patrimonio total | ${eur(t.netWorthEur)} |`);
  out.push(`| Efectivo | ${eur(t.cashEur)} |`);
  out.push(`| Invertido (valor de mercado) | ${eur(t.investedMarketValueEur)} |`);
  out.push(`| Coste de lo invertido | ${eur(t.investedCostEur)} |`);
  out.push(
    `| Plusvalía latente | ${eur(t.unrealizedPnlEur)}${t.unrealizedPnlPct != null ? ` (${pct(t.unrealizedPnlPct)})` : ""} |`,
  );
  out.push("");

  if (report.groups.length > 0) {
    out.push("## Posiciones");
    out.push("");
    for (const group of report.groups) {
      out.push(`### ${assetTypeLabel(group.assetType)} — ${weightPct(group.weight)} de lo invertido`);
      out.push("");
      out.push("| Activo | Símbolo | Cantidad | Precio | Valor | Coste | P/G |");
      out.push("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
      for (const line of group.lines) {
        out.push(
          `| ${esc(line.name)} | ${esc(line.symbol)} | ${qty(line.quantity)} | ${eur(line.unitPriceEur)} | ${eur(line.marketValueEur)} | ${eur(line.costEur)} | ${pct(line.pnlPct)} |`,
        );
      }
      out.push(
        `| **Subtotal ${esc(assetTypeLabel(group.assetType))}** | | | | **${eur(group.marketValueEur)}** | **${eur(group.costEur)}** | **${eur(group.pnlEur)}** |`,
      );
      out.push("");
    }
  }

  out.push("## Cuentas");
  out.push("");
  out.push("| Cuenta | Tipo | Efectivo | Invertido | Total |");
  out.push("| --- | --- | ---: | ---: | ---: |");
  for (const account of report.accounts) {
    out.push(
      `| ${esc(account.name)} | ${accountTypeLabel(account.accountType)} | ${eur(account.cashEur)} | ${eur(account.investedEur)} | ${eur(account.totalEur)} |`,
    );
  }
  out.push("");
  out.push(`**Patrimonio total: ${eur(t.netWorthEur)}**`);
  out.push("");

  return out.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/exports/__tests__/statement-md.test.ts src/lib/exports/__tests__/statement.test.ts && pnpm typecheck`
Expected: PASS (el test de _kit no existe, pero el fichero de exports ejercita el PDF que consume `assetTypeLabelPdf`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/labels.ts src/lib/pdf/_kit.ts src/lib/exports/statement-md.ts src/lib/exports/__tests__/statement-md.test.ts
git commit -m "feat(exports): formato Markdown para el extracto"
```

---

### Task 4: Ruta de export — formato `md` + parámetro `asOf`

**Files:**
- Create: `src/lib/asof.ts`
- Modify: `src/app/api/exports/statement/route.ts`
- Test: `src/lib/__tests__/asof.test.ts` (create; crear el directorio si no existe)

**Interfaces:**
- Consumes: `buildStatementMd` (Task 3), `getStatementReport(db, { asOf })` y `report.asOf` (Task 2).
- Produces: `export function parseAsOfParam(raw: string | null): { ok: true; asOf: string | null } | { ok: false; error: string }` y `export function todayIsoLocal(): string` en `src/lib/asof.ts`. Task 5 usa `todayIsoLocal` conceptualmente (el menú calcula hoy en cliente).

- [ ] **Step 1: Write the failing test**

Crear `src/lib/__tests__/asof.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseAsOfParam, todayIsoLocal } from "../asof";

describe("parseAsOfParam", () => {
  it("null o vacío significa extracto actual", () => {
    expect(parseAsOfParam(null)).toEqual({ ok: true, asOf: null });
    expect(parseAsOfParam("")).toEqual({ ok: true, asOf: null });
  });

  it("acepta una fecha pasada válida", () => {
    expect(parseAsOfParam("2026-03-31")).toEqual({ ok: true, asOf: "2026-03-31" });
  });

  it("acepta hoy", () => {
    const today = todayIsoLocal();
    expect(parseAsOfParam(today)).toEqual({ ok: true, asOf: today });
  });

  it("rechaza formatos que no son YYYY-MM-DD", () => {
    for (const bad of ["31-03-2026", "2026/03/31", "2026-3-31", "ayer"]) {
      expect(parseAsOfParam(bad).ok).toBe(false);
    }
  });

  it("rechaza fechas de calendario inexistentes", () => {
    expect(parseAsOfParam("2026-02-30").ok).toBe(false);
    expect(parseAsOfParam("2026-13-01").ok).toBe(false);
  });

  it("rechaza fechas futuras", () => {
    expect(parseAsOfParam("2999-01-01").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/asof.test.ts`
Expected: FAIL — módulo `../asof` no existe.

- [ ] **Step 3: Implement `src/lib/asof.ts`**

```ts
/** Fecha de hoy en ISO yyyy-MM-dd en horario LOCAL (no UTC): el corte del
 *  extracto es "fin de día del usuario", igual que el cutoff de statement.ts. */
export function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type AsOfParse =
  | { ok: true; asOf: string | null }
  | { ok: false; error: string };

/** Valida el query param asOf de las rutas de export. null/"" = sin corte. */
export function parseAsOfParam(raw: string | null): AsOfParse {
  if (raw == null || raw === "") return { ok: true, asOf: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false, error: "asOf debe tener formato YYYY-MM-DD" };
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    return { ok: false, error: "asOf no es una fecha de calendario válida" };
  }
  if (raw > todayIsoLocal()) {
    return { ok: false, error: "asOf no puede ser una fecha futura" };
  }
  return { ok: true, asOf: raw };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/asof.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire the route**

Sustituir `src/app/api/exports/statement/route.ts` por:

```ts
import { NextResponse } from "next/server";
import { getStatementReport } from "@/src/server/statement";
import { getNetWorthSeries } from "@/src/server/overview";
import { parseAsOfParam } from "@/src/lib/asof";
import { buildStatementCsv } from "@/src/lib/exports/statement-csv";
import { buildStatementMd } from "@/src/lib/exports/statement-md";
import { buildStatementXlsx } from "@/src/lib/exports/statement-xlsx";
import { buildStatementReportPdf } from "@/src/lib/pdf/statement-report";

const FORMATS = new Set(["pdf", "xlsx", "csv", "md"]);

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const format = params.get("format") ?? "pdf";
  if (!FORMATS.has(format)) {
    return new NextResponse("format must be pdf, xlsx, csv or md", { status: 400 });
  }
  const asOfParse = parseAsOfParam(params.get("asOf"));
  if (!asOfParse.ok) {
    return new NextResponse(asOfParse.error, { status: 400 });
  }

  const report = await getStatementReport(undefined, {
    asOf: asOfParse.asOf ?? undefined,
  });
  const stamp = report.asOf ?? new Date(report.generatedAt).toISOString().slice(0, 10);

  if (format === "csv") {
    return new NextResponse(buildStatementCsv(report), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="statement-${stamp}.csv"`,
      },
    });
  }

  if (format === "md") {
    return new NextResponse(buildStatementMd(report), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="statement-${stamp}.md"`,
      },
    });
  }

  if (format === "xlsx") {
    const bytes = await buildStatementXlsx(report);
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="statement-${stamp}.xlsx"`,
      },
    });
  }

  // Serie de evolución para el gráfico de área de la primera página; con
  // asOf se recorta al corte para no dibujar futuro respecto al extracto.
  const seriesAll = await getNetWorthSeries({ range: "ALL", accountIds: [] });
  const series = report.asOf
    ? seriesAll.filter((p) => p.date <= report.asOf!)
    : seriesAll;
  const pdf = buildStatementReportPdf(report, {
    series: series.map((p) => ({ date: p.date, valueEur: p.valueEur })),
  });
  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="statement-${stamp}.pdf"`,
    },
  });
}
```

> Nota: `getStatementReport(undefined, …)` mantiene el `db = defaultDb` por defecto. El CSV/XLSX no cambian de contenido; con `asOf` su `generated_at` sigue siendo el timestamp de generación y el nombre de fichero lleva la fecha del corte.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm vitest run src/lib`
Expected: sin errores TS; tests de lib en verde.

- [ ] **Step 7: Commit**

```bash
git add src/lib/asof.ts src/lib/__tests__/asof.test.ts src/app/api/exports/statement/route.ts
git commit -m "feat(exports): parametro asOf validado y formato md en la ruta del extracto"
```

---

### Task 5: Menú de exportación con selector de fecha + item Markdown

**Files:**
- Modify: `src/components/features/statement/StatementExportMenu.tsx`

**Interfaces:**
- Consumes: la ruta con `?format=…&asOf=…` (Task 4).
- Produces: nada aguas abajo.

- [ ] **Step 1: Implement the menu**

Sustituir `src/components/features/statement/StatementExportMenu.tsx` por:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/src/components/ui/Button";

const formats: { label: string; format: string }[] = [
  { label: "Informe PDF", format: "pdf" },
  { label: "Libro Excel (.xlsx)", format: "xlsx" },
  { label: "CSV", format: "csv" },
  { label: "Markdown (.md)", format: "md" },
];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function StatementExportMenu() {
  const [open, setOpen] = useState(false);
  const [asOf, setAsOf] = useState(todayIso());
  const today = todayIso();
  // Fecha = hoy ⇒ extracto actual (sin asOf); pasada ⇒ reconstrucción a fecha.
  const suffix = asOf && asOf !== today ? `&asOf=${asOf}` : "";
  return (
    <div className="relative">
      <Button onClick={() => setOpen((s) => !s)}>Generar extracto ▾</Button>
      {open ? (
        <div className="absolute right-0 mt-1 w-64 rounded-md border border-border bg-popover p-1 shadow-lg z-10">
          <label className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              A día de
            </span>
            <input
              type="date"
              value={asOf}
              max={today}
              onChange={(e) => setAsOf(e.target.value)}
              className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground [color-scheme:light] dark:[color-scheme:dark]"
            />
          </label>
          <div className="my-1 h-px bg-border" />
          {formats.map((it) => (
            <a
              key={it.format}
              href={`/api/exports/statement?format=${it.format}${suffix}`}
              className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
              onClick={() => setOpen(false)}
            >
              {it.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

Notas de disciplina UI: no hay primitivo de date-input en `src/components/ui/` (solo Button/Modal/DataTable/etc.), así que el `<input type="date">` estilizado con tokens del tema es correcto; `[color-scheme]` hace que el picker nativo siga el tema. No se renderiza dinero ⇒ no aplica `<SensitiveValue>`.

- [ ] **Step 2: Verify both themes**

Run: `pnpm dev` y abrir `http://localhost:3200/statement`. Con el conmutador de tema, verificar el menú en claro y oscuro: input legible, icono del calendario visible, separador correcto. Elegir una fecha pasada y comprobar que los enlaces llevan `&asOf=`; con hoy, que no lo llevan. Descargar el `.md` y abrirlo.

- [ ] **Step 3: Commit**

```bash
git add src/components/features/statement/StatementExportMenu.tsx
git commit -m "feat(statement): selector de fecha y formato Markdown en el menu de extracto"
```

---

### Task 6: PDF profesional — fix del solape + aire + tono

**Files:**
- Modify: `src/lib/pdf/statement-report.ts`
- Modify: `src/lib/pdf/_kit.ts` (statCards ligeramente más altas)

**Interfaces:**
- Consumes: `report.asOf` (Task 2).
- Produces: nada aguas abajo.

- [ ] **Step 1: Fix section 2 overlap (the bug)**

En `src/lib/pdf/statement-report.ts`, reemplazar el bloque «2 · Composición» completo (desde `const sliceGroups = …` hasta `cur.y += Math.max(116, 26 + sliceGroups.length * 16);` inclusive) por una versión que (a) calcula las alturas de ambas columnas ANTES de dibujar, (b) reserva la altura total con `room(...)`, y (c) avanza `cur.y` por el máximo real:

```ts
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
        `${assetTypeLabelPdf(g.assetType)} — ${(g.weight * 100).toFixed(1)}%`,
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
```

- [ ] **Step 2: Professional tone — cards, header, footer**

En el mismo fichero:

1. Cabecera con soporte as-of — reemplazar la llamada a `headerBand` por:

```ts
  const stamp = report.asOf ?? fmtDateIso(report.generatedAt);
  cur.y = headerBand(doc, {
    title: "Extracto de cartera · Finances Panel",
    big: stamp,
    subtitle: `${t.positionsCount} posiciones abiertas en ${t.accountsCount} cuenta${t.accountsCount === 1 ? "" : "s"} · valoración en EUR`,
    metaLines: [`Generado el ${fmtDateIso(report.generatedAt)}`],
    badge: report.asOf ? { label: "A día de fecha", tone: "accent" } : undefined,
  });
```

2. Tarjetas sin didáctica — reemplazar la llamada a `statCards` por:

```ts
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
```

3. Pie de página — reemplazar la llamada a `finishFooters` por:

```ts
  finishFooters(doc, `Finances Panel · Extracto de cartera · ${stamp}`);
```

4. En `src/lib/pdf/_kit.ts`, dentro de `statCards`: `const h = 64;` → `const h = 72;`, `doc.setFontSize(15);` → `doc.setFontSize(17);`, la Y del valor `cur.y + 37` → `cur.y + 40`, la Y del sub `cur.y + 51` → `cur.y + 56`, y el avance final `cur.y += h + 22;` → `cur.y += h + 26;`. (El informe fiscal comparte `statCards`; el cambio es global y deseable — más aire en ambos documentos.)

- [ ] **Step 3: Breathing room — chart, tables, band**

En `src/lib/pdf/statement-report.ts`:

1. Gráfico de evolución: `room(130)` → `room(160)` y la altura del `areaChart` `96` → `120`.
2. Tabla de posiciones — en el `report.groups.forEach`:
   - `room(56)` → `room(64)`.
   - Cabecera de grupo: `doc.setFontSize(9.5)` → `doc.setFontSize(11)`; el subtotal derecho `doc.setFontSize(9)` → `doc.setFontSize(10)`; `cur.y += 16;` → `cur.y += 20;`.
   - Filas: `room(18, …)` → `room(20, …)`; `zebra(cur, i, 14)` → `zebra(cur, i, 17)`; `doc.setFontSize(7.5)` → `doc.setFontSize(8.5)`; `cur.y += 14;` → `cur.y += 17;`.
   - Subtotal: `doc.setFontSize(7.5)` → `doc.setFontSize(8.5)`; `cur.y += 24;` → `cur.y += 28;`.
3. Tabla de cuentas: `room(18, …)` → `room(20, …)`; `zebra(cur, i, 14)` → `zebra(cur, i, 17)`; `doc.setFontSize(8)` → `doc.setFontSize(9)`; `cur.y += 14;` → `cur.y += 17;`.
4. Banda final: `doc.roundedRect(M, cur.y - 12, CONTENT_W, 28, 5, 5, "F")` → altura `32` (y el filo de acento `doc.rect(M, cur.y - 12, 3, 28, "F")` → `32`); `doc.setFontSize(10)` → `doc.setFontSize(11)`; las Y de los textos `cur.y + 6` → `cur.y + 8`; `cur.y += 30;` → `cur.y += 34;`.

- [ ] **Step 4: Run the suite**

Run: `pnpm vitest run src/lib/exports/__tests__ && pnpm typecheck`
Expected: PASS (el test de exports genera el PDF y no debe lanzar).

- [ ] **Step 5: Visual verification with real data**

Crear `gen-statement-pdf.local.mts` en la RAÍZ del repo (se borra al terminar; no se commitea):

```ts
import { writeFileSync } from "node:fs";
import { getStatementReport } from "./src/server/statement";
import { getNetWorthSeries } from "./src/server/overview";
import { buildStatementReportPdf } from "./src/lib/pdf/statement-report";
import { buildStatementMd } from "./src/lib/exports/statement-md";

const OUT = "/private/tmp/claude-501/-Users-nyhzdev-devroom-battlefields-finances/7db64eb7-fd7c-410a-8a1c-2e5c4f81d389/scratchpad";

const live = await getStatementReport();
const series = await getNetWorthSeries({ range: "ALL", accountIds: [] });
writeFileSync(
  `${OUT}/statement-live.pdf`,
  buildStatementReportPdf(live, { series: series.map((p) => ({ date: p.date, valueEur: p.valueEur })) }),
);

const asOf = "2026-03-31";
const past = await getStatementReport(undefined, { asOf });
writeFileSync(
  `${OUT}/statement-asof.pdf`,
  buildStatementReportPdf(past, {
    series: series.filter((p) => p.date <= asOf).map((p) => ({ date: p.date, valueEur: p.valueEur })),
  }),
);
writeFileSync(`${OUT}/statement-asof.md`, buildStatementMd(past));

const today = new Date();
const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
const asOfToday = await getStatementReport(undefined, { asOf: todayIso });
console.log(JSON.stringify({ live: live.totals, asOfToday: asOfToday.totals }, null, 2));
```

Run: `cd /Users/nyhzdev/devroom/battlefields/finances && pnpm exec tsx gen-statement-pdf.local.mts` (ejecutar desde la raíz para que el cliente de DB encuentre `data/`). Abrir los PDF generados en el scratchpad con el tool Read (soporta PDF) para inspección visual: sección 2 sin solape, tablas con aire, sin subtítulos didácticos, cabecera as-of correcta. Comparar `live.totals` vs `asOfToday.totals` — deben coincidir al céntimo (las diferencias de valoración solo aparecerían si hoy aún no hay precio sincronizado; en ese caso contrastar contra la web). Al terminar: `rm gen-statement-pdf.local.mts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pdf/statement-report.ts src/lib/pdf/_kit.ts
git commit -m "fix(pdf): composicion sin solape y rediseño profesional del extracto"
```

---

### Task 7: SPEC sync + Definition of Done

**Files:**
- Modify: `SPEC.md` (localizar con `grep -n "xlsx\|exports/statement" SPEC.md` las menciones del export del extracto y añadir `md` + `asOf`)

**Interfaces:** n/a.

- [ ] **Step 1: Update SPEC.md**

Donde SPEC liste los formatos del export del extracto (ruta `/api/exports/statement`), añadir `md` al listado y documentar el query param `asOf=YYYY-MM-DD` (validado, no futuro; reconstrucción por replay del ledger + última valoración ≤ fecha + efectivo acotado). Una o dos frases, en el estilo existente del documento.

- [ ] **Step 2: Full Definition of Done pass**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: todo en verde. Checklist final:
- [ ] UI verificada en claro y oscuro (Task 5 Step 2).
- [ ] Sin migraciones ni env vars nuevas (n/a por diseño).
- [ ] Mutaciones: no hay ninguna nueva (todo son lecturas/exports) ⇒ no aplica audit_event/revalidatePath.
- [ ] Smoke fresh-DB: los tests de "fresh DB" existentes de statement siguen en verde.

- [ ] **Step 3: Commit**

```bash
git add SPEC.md
git commit -m "docs(spec): export del extracto con asOf y formato md"
```
