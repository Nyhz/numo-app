# SPEC.md — Patrimonio (Finances Panel)

> Standalone personal investment dashboard. EUR-first, single-user, LAN-only.
> Ported from the `second-brain` monorepo into a fully self-contained Next.js app. No Docker, no Bun, no external API service, no workspace dependencies. pnpm + Node 22+ only.

---

## 0. Project Initialization

The project MUST be scaffolded with the official Next.js generator — do not hand-write `package.json`, `tsconfig.json`, `next.config.*`, or any other config file the generator owns. From an empty repo root:

```
pnpm create next-app@latest . \
  --ts \
  --app \
  --src-dir \
  --tailwind \
  --eslint \
  --import-alias "@/*" \
  --use-pnpm \
  --no-turbopack \
  --yes
```

After it finishes:

- Accept whatever versions `create-next-app` ships with (Next, React, React-DOM, Tailwind, ESLint). Do not bump or downgrade them to chase a specific number.
- Run `pnpm install` once to confirm the lockfile is clean, then `pnpm build` to confirm the template builds before adding anything else. **If install fails twice in a row, stop and debrief — do not thrash version permutations.**
- Add the project-specific dependencies (`better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `zod`, `ulid`, `recharts`, `lucide-react`, `@radix-ui/react-dialog`, `yahoo-finance2`, `jspdf`, `vitest`) only after the baseline template builds green.
- Replace the generated `src/app/page.tsx` and `src/app/layout.tsx` with the shells described in §3, but keep the generated `src/app/globals.css` and `next.config.*` as the starting point — only edit them, never delete-and-rewrite.

Turbopack is disabled at scaffold time because gates run `next build` (webpack), and dev/build divergence is the most common cause of phantom failures.

---

## 1. Stack

| Layer | Technology |
|-------|------------|
| Package manager | pnpm |
| Runtime | Node.js 22+ (Next 16 requirement) |
| Framework | Next.js 16 (App Router, Server Components, Server Actions) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS 4.x |
| UI primitives | shadcn/ui (cherry-picked, restyled) + Radix (`@radix-ui/react-dialog`) |
| Icons | `lucide-react` |
| Charts | `recharts` |
| Database | SQLite via `better-sqlite3` (synchronous, single file, WAL mode) |
| ORM | Drizzle ORM (SQLite dialect) |
| IDs | ULID |
| Tests | Vitest (unit) |
| Lint | ESLint (the config that ships with `create-next-app`) |
| PDF | `jspdf` (or equivalent) for account statements and tax reports |
| Price source | `yahoo-finance2` (equities/ETFs/FX) + CoinGecko (crypto, EUR-native) |
| Composition data | Yahoo (sectors, via `topHoldings`/`assetProfile`) + JustETF (geography by ISIN, scraped) |
| AI advisor | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), billed to the Max subscription via `CLAUDE_CODE_OAUTH_TOKEN` |

### Not used
Docker, Bun, monorepo tooling, Postgres, workspace packages, external HTTP API service, separate worker process. The price-sync worker is inlined as a cron-triggered route.

---

## 2. Design System

### Visual language
Dense, professional, shadcn-first. Rounded cards (`--radius: 0.75rem`), subtle borders, generous spacing inside dense tables. Dark mode is the default; light mode is supported.

Theme is toggled via `data-theme="light|dark"` on `<html>`, persisted in `localStorage` + cookie (`sb-theme-mode`). A boot script runs `beforeInteractive` to avoid flash.

### Sensitive mode
Global blur toggle hides monetary values for screen-sharing. Persisted via `localStorage` only, applied as `data-sensitive="hidden|visible"` on `<html>`, realised as a CSS blur filter on `.sensitive` spans. Toggle lives in the top nav. Server-side exports (PDF/XLSX/CSV) intentionally ignore sensitive mode — exporting is an explicit act of extracting the real numbers.

### Theme tokens (HSL, shadcn convention)

Dark (default):
```
--background: 240 10% 3.9%
--foreground: 0 0% 98%
--card: 240 10% 3.9%
--primary: 0 0% 98%
--primary-foreground: 240 5.9% 10%
--secondary: 240 3.7% 15.9%
--muted: 240 3.7% 15.9%
--muted-foreground: 240 5% 64.9%
--border: 240 3.7% 15.9%
--destructive: 0 62.8% 30.6%
--success: 142.1 70.6% 45.3%
--radius: 0.75rem
```

Light: standard shadcn light palette (see `src/app/globals.css`).

### Primitives
Inline, no external UI package.

- **Button** — CVA-based. Variants `primary | secondary | ghost | danger`. Sizes `default | sm | lg | icon`. Supports `fullWidth`. Rounded-xl, `active:scale-[0.99]`, focus ring.
- **Card / CollapsibleCard** — bordered, rounded, optional title + action slot.
- **KPICard** — label + big value + optional delta/trend.
- **DataTable** — generic, sortable, cursor-paginated.
- **Modal / ConfirmModal** — Radix Dialog wrapper.
- **StatesBlock** — empty / error / loading placeholders.
- **SensitiveValue** — span that blurs when sensitive mode is active.
- **ThemeToggle** — sun/moon icon button.

### Charts
Recharts, styled via CSS variables so they track the theme. Tooltips minimal — value + date only. Loading state is a skeleton preloader, not a spinner.

- **Price line chart** — single-series line, range-aware Y-axis (min/max + ~5% margin, not zero-based).
- **Area performance chart** — filled area of cumulative portfolio value.
- **Allocation donut** — holdings split by asset type or by account.
- **Composition donut** — portfolio split by equity sector (Yahoo), by geographic region/continent (JustETF), or by allocation objective (the `/objectives` buckets). Geography is geography-only (non-classifiable value omitted); sectors bucket the remainder as «Sin clasificar»; objectives colour each slice from its stored theme token.
- **Sparkline** — inline trend for table rows.
- **Cash trend chart** — stacked cash balance over time.

---

## 3. Information Architecture

### Routes

| Route | Purpose |
|-------|---------|
| `/` | Overview dashboard — total portfolio value, range selector, account filter, performance chart, top positions, allocation donut. |
| `/accounts` | List of accounts with cash balances and account-type badges. Create/delete. |
| `/accounts/[accountId]` | Account detail — positions, performance chart, ledger, export statement PDF. |
| `/assets` | Master asset list with current holdings, create/edit/deactivate, manual price override. |
| `/transactions` | Unified timeline of asset trades + cash movements. Manual create flow (buy / sell / dividend / fee / swap / cash movement). **No CSV import** — the broker importers were removed 2026-06; manual entry is the only registration path. |
| `/statement` | Visual portfolio statement — value chart with range selector, reparto por tipo de activo, composición por regiones geográficas (JustETF), riesgo (caída desde máximos + volatilidad), composición por objetivos (1/3) y por sectores (2/3, Yahoo), value by account, P&L by type, holdings grouped by type, costes (comisiones + TER), accounts table. Export PDF / XLSX / CSV via `/api/exports/statement?format=`. |
| `/objectives` | Objetivos de asignación por activo — peso actual vs. objetivo, desviación (% y €), planificador de aportación. |
| `/simulador` | Simulador FIRE de interés compuesto — escenarios pesimista/base/optimista, año bola de nieve, regla del 4 %. Prerellenado con el patrimonio actual. |
| `/asesor` | Asesor financiero IA — chat con contexto de cartera, pestañas de conversación persistentes, coste mensual del crédito, toggle de scans de mercado. |
| `/taxes` | Redirige al año fiscal más reciente. |
| `/taxes/[year]` | Informe fiscal anual foral (Bizkaia): Declaración (FIFO lote a lote), Previsión (coeficientes forales), dividendos, retenciones/DDI, M720/M721, sellado de año. Export CSV (casillas / detalle), JSON/CSV (M720-diff), PDF. |
| `/settings` | Ajustes — tarjeta de entorno (solo lectura) + editor del perfil de inversor que alimenta al asesor. |
| `/audit` | Audit log of entity mutations, filterable by entity type/id. |
| `/health` | JSON health check. |
| `POST /api/cron/sync-prices` | Price + composition sync (shared-token gated). |
| `POST /api/cron/backfill-prices` | On-demand historical price backfill. |
| `POST /api/cron/advisor-scan` \| `advisor-curate` \| `advisor-chat-compact` | AI advisor maintenance crons (market scan + morning brief, weekly digest curation, weekly chat compaction). |
| `POST /api/advisor/chat` | Streaming advisor chat endpoint. |
| `/api/exports/{statement,account-statement,tax/casillas,tax/detail,tax/m720-diff,tax/pdf}` | PDF / XLSX / CSV / JSON export endpoints. |

### Layout shell
- **Top nav** — brand on left, account quick-switcher center, theme toggle + sensitive toggle on right.
- **Side nav** — collapsible, icon + label. Routes as above.
- **Content area** — `page-stack` layout: header row (title + actions) + sections.

---

## 4. Core Domain

All monetary values are stored in EUR (base currency) alongside native currency + FX rate snapshot. Base currency is fixed at EUR.

### Entities

**Account** — `id`, `name`, `currency`, `accountType` (broker / bank / crypto / cash / other), `openingBalanceEur`, `currentCashBalanceEur`, `createdAt`, `updatedAt`.

**Asset** — `id`, `name`, `assetType` (etf / stock / bond / crypto / fund / cash-equivalent / other), `subtype` (optional), `symbol`, `ticker`, `isin`, `exchange`, `providerSymbol` (Yahoo Finance symbol override), `currency`, `ter` (annual %), `objectiveId`, `excludeFromObjectives` (leave out of the allocation plan), `isActive`, `notes`.

**AssetPosition** (one per asset, aggregated) — `id`, `assetId`, `quantity`, `averageCost` (EUR), `manualPrice`, `manualPriceAsOf`.

**AssetTransaction** — `id`, `accountId`, `assetId`, `transactionType` (buy / sell / dividend / fee), `tradedAt`, `quantity`, `unitPrice`, `tradeCurrency`, `fxRateToEur`, `tradeGrossAmount`, `tradeGrossAmountEur`, `cashImpactEur`, `feesAmount`, `feesAmountEur`, `netAmountEur`, `dividendGross`, `dividendNet`, `withholdingTax`, `settlementDate`, `linkedTransactionId`, `externalReference`, `rowFingerprint` (import dedup), `source` (`manual` / `degiro` / `binance` / `cobas`), `notes`, `rawPayload`.

**AccountCashMovement** — `id`, `accountId`, `movementType` (deposit / withdrawal / interest / fee / transfer-in / transfer-out), `occurredAt`, `valueDate`, `nativeAmount`, `currency`, `fxRateToEur`, `cashImpactEur`, `externalReference`, `rowFingerprint`, `source`, `description`, `affectsCashBalance` (bool).

**DailyBalance** — `id`, `accountId`, `balanceDate`, `balance` (EUR).

**PriceHistory** — `id`, `symbol`, `pricedAt`, `pricedDateUtc`, `price`, `source` (`yahoo` / `yahoo_fx` / `manual`).

**AssetValuation** (snapshot per asset per day) — `id`, `assetId`, `valuationDate`, `quantity`, `unitPrice`, `marketValue`, `priceSource`.

**AuditEvent** — `id`, `entityType`, `entityId`, `action` (`create` / `update` / `delete`), `actorType` (`user` / `system`), `source`, `summary`, `previousJson`, `nextJson`, `contextJson`, `createdAt`.

**FxRate** — `currency`, `asOfDate`, `rateToEur`, `source` (`yahoo` / broker / manual). Date-keyed FX snapshots that stamp tax-relevant EUR amounts at entry time (see §6).

`AssetTransaction.source` still carries the legacy `degiro` / `binance` / `cobas` provenance on rows ingested before the importers were removed (2026-06); no import subsystem exists anymore. `AssetTransaction` also carries `valuationBasis` (`user` / `market-fx`) for the crypto-swap exception in §6.

**Derived & domain tables** (schema under `src/db/schema/`, kept in sync by tx-scoped recompute or cron, never hand-edited):
- **Composition:** `asset_sector_weightings`, `asset_country_weightings` — per-asset sector/country snapshots (§6).
- **Tax engine** (`src/server/tax/`): `tax_lots` (FIFO acquisition lots, gross cost + fees separated, deferred-loss carry), `tax_lot_consumptions` (sale→lot links), `tax_wash_sale_adjustments` (norma antiaplicación), `tax_year_snapshots` (sealed-year frozen reports), `tax_declared_baselines` (manually-entered prior M720/M721 filings).
- **Objectives:** `objectives` — allocation targets per asset (`/objectives`).
- **Advisor:** `advisor_conversations`, `advisor_messages` (persisted chat threads), `advisor_runs` (token/cost/model observability ledger).

### UnifiedTransactionRow (view type)
Merged timeline item across `AssetTransaction` and `AccountCashMovement`. Shared by the `/transactions` list and the account detail ledger.

---

## 5. Features (behaviour)

### 5.1 Overview Dashboard (`/`)

- **KPI row:** total portfolio value (EUR), 24h change, unrealized P&L, cash balance.
- **Account filter:** "All accounts" or pick one. Filter applies to every tile on the page.
- **Range selector:** `1D | 1W | 1M | YTD | 1Y | MAX`. Y-axis auto-scales to selected range min/max with ~5% margin (not zero-based). `MAX` starts at the first portfolio transaction date, not the full price-history window.
- **Performance chart:** filled area, cumulative portfolio value in EUR over the selected range. Server-computed from `daily_balances` + `asset_valuations`.
- **Top positions table:** quantity, avg cost, last price, market value, P&L %.
- **Allocation donut:** by asset type (toggle to by-account).
- **Preloader:** skeleton variant of each card while data loads.

### 5.2 Accounts

List (`/accounts`): rows show name + type badge, cash balance (EUR), current total value (cash + positions), last activity. Sensitive-mode blurs numeric columns. Row actions: create (modal — name, type, currency default EUR, opening balance); delete (confirm modal; blocks if transactions exist).

Detail (`/accounts/[accountId]`): header with name, type, cash balance. Positions table (assets held in this account with quantity, avg cost, market value, P&L). Performance chart (account value = cash + holdings over time). Ledger (UnifiedTransactionRow list, paginated). Export PDF (statement or transaction ledger for a date range).

### 5.3 Assets

Master list with current holdings.

Create asset (modal, EUR-first): required name, asset type; optional ISIN, ticker, exchange, `providerSymbol` (Yahoo override), currency (default EUR), notes. ISIN format validated per asset type.

Edit metadata (modal): same fields + manual price override (for illiquid assets).

Deactivate: soft-delete — hides from default list but preserves history.

Row actions: edit, deactivate.

### 5.4 Transactions

Unified timeline of all `AssetTransaction` + `AccountCashMovement`, newest first. Filters: account, date range, type. Pagination: cursor-based, 50 rows per page.

Create (modal): type selector (buy / sell / dividend / fee / deposit / withdrawal); account; asset (required for buy/sell/dividend/fee); traded/occurred at (date + time); quantity + unit price (trades) or amount (cash movements); currency + FX rate (auto-filled from latest price history if EUR target, editable); fees (optional); notes (optional). On save: recomputes `asset_positions.quantity` and `averageCost`; updates `account.currentCashBalanceEur`; replays FIFO tax lots; writes audit event. **Crypto/asset swaps** (`createSwap`, permutas) record a matched sell+buy pair on one date with zero net cash impact, both legs EUR-valued and linked via `linkedTransactionId`.

Delete: confirm modal → reverses position and cash balance changes → writes audit event.

Import CSV: **removed 2026-06** (manual entry is the only registration path; see git history for the DEGIRO/Binance/Cobas importers). The dedup discipline survives: every inserted row carries a `rowFingerprint`.

### 5.5 Taxes (foral — Bizkaia)

`/taxes` redirects to the latest year; `/taxes/[year]` is the year-end report. The engine is **Bizkaia/foral**, not estatal, and separates two layers:

- **Declaración** (`src/server/tax/report.ts`) — raw, untransformed FIFO detail, one row per (sale, consumed lot) pair, ready to transcribe into Rentanet. Carries a `recompra` flag where the wash-sale rule disallows a loss.
- **Previsión** (`src/server/tax/prevision.ts`) — an *estimate* of the foral outcome after applying the **coeficientes de actualización** (`coeficientes.ts`, annual DF tables that uplift acquisition cost, retained in Bizkaia for all asset classes). Explicitly non-binding.

Engine details: FIFO lots in `tax_lots`/`tax_lot_consumptions` store cost as lot totals (gross + fees separate, never pre-rounded per unit; see also the fees-always-EUR rule). **Norma antiaplicación** (wash sale, `washSale.ts`) defers a disallowed loss into the acquiring lot's basis (2-month window listed/crypto, 12-month unlisted). The **cuota** (`cuota.ts`) integrates two watertight compartments (ganancias patrimoniales / RCM) with no cross-offset, and applies the **€1.500 dividend exemption**. Year **sealing** (`seals.ts` → `tax_year_snapshots`) freezes the full report + M720/M721 blocks + interest rate as JSON; a drift banner appears if live numbers diverge after sealing.

**M720/M721** informational models: `tax_declared_baselines` records prior filings made outside the app; status (`ok` / `new` / `delta_20k` / `full_exit`) is computed against the €50k first-declaration and €20k re-declaration thresholds at the joint category level. Missing year-end valuations surface as `UNVALUED`, never silent €0.

Exports: `tax/casillas` (pipe-CSV of form boxes), `tax/detail` (Declaración + raw sales CSV), `tax/m720-diff` (JSON/CSV of current vs. declared blocks), `tax/pdf` (full printable report).

### 5.6 Audit

Chronological list of mutations across accounts, assets, and transactions. Each row: timestamp, actor, entity type/id, action, summary, optional expandable diff. Filters: entity type, entity id, date range.

### 5.7 Health

`GET /health` → `{ status: "ok", version, dbPath, prices: { lastSync } }`.

### 5.8 Statement (`/statement`)

The full visual portfolio statement (force-dynamic, always recomputed). Sections: value chart with range selector; **reparto por tipo de activo** (donut); **composición por regiones** geográficas (donut); **riesgo** (max drawdown + annualised volatility from the 100-anchored performance index, `src/lib/risk.ts`); **composición por objetivos** (1/3, donut coloured per objective) alongside **composición por sectores** (2/3); value by account; P&L by type; **costes** — accumulated commissions + custody fees + forward-looking TER drag (`src/server/costs.ts`); holdings grouped by type; accounts table. Exports PDF / XLSX / CSV.

### 5.9 Objectives (`/objectives`)

Allocation plan tied to **assets** (so the same exposure across brokers aggregates into one bucket). Each objective has a name, `targetPct`, sort order, theme colour, notes. The page shows current weight vs. target, drift (% and €), a draggable target ring, an unassigned («Sin objetivo») bucket, a contribution planner, and an asset→objective assignment table. Non-discretionary holdings (e.g. a fixed-contribution EPSV) can be **excluded** from the plan via that table (`excludeFromObjectives`) — they then count toward neither a bucket nor the valued total. The objectives are also surfaced as the composition-by-objective donut on `/statement`.

### 5.10 Simulator (`/simulador`)

Deterministic FIRE compound-interest projection (`src/lib/simulator.ts`, side-effect-free). Inputs: initial capital (prefilled from current net worth), monthly contribution + growth, expected return, horizon, inflation, scenario spreads. Outputs three scenarios (pesimista/base/optimista) with year-by-year nominal/real value, the **snowball year** (interest ≥ contribution), reverse solvers (required contribution / years to a target), and a **FIRE block** (4 %-rule number and when it's reached in real terms). Tax is injected as a callback so the lib stays server-free.

### 5.11 Advisor (`/asesor`) + Telegram

AI financial advisor on the **Claude Agent SDK**, billed to the Max subscription via `CLAUDE_CODE_OAUTH_TOKEN` (refuses to run if `ANTHROPIC_API_KEY` is set — it would bypass the credit). Interactive chat (`/api/advisor/chat`, streaming Opus) reasons over a live portfolio snapshot + the investor profile + the market digest; conversations persist as tabs (`advisor_conversations`/`advisor_messages`) and the assistant may propose profile-memory edits (confirm-gated). Three crons maintain the knowledge base: **advisor-scan** (hourly Sonnet + WebSearch news scan → digest; 09:00 slot sends a Telegram morning brief), **advisor-curate** (weekly digest prune), **advisor-chat-compact** (weekly transcript summarisation). Every run is metered in `advisor_runs` (tokens/cost/model). A standalone launchd daemon (`scripts/tg-bot.ts`, `com.finances.tg-bot`) long-polls Telegram for two commands — **`/net`** (portfolio KPIs) and **`/ask`** (one-shot advisor) — restricted to `TELEGRAM_CHAT_ID`.

### 5.12 Settings (`/settings`)

Read-only runtime card (app name, base currency EUR, `DB_PATH`, Node version) plus the **investor-profile editor** — free-form facts (risk tolerance, horizon, constraints, ≤4 KB) persisted to disk with rotating backups and a changelog, injected into every advisor prompt.

---

## 6. Pricing

### Source
Yahoo Finance via `yahoo-finance2`. Symbol resolution precedence: `asset.providerSymbol` → `asset.symbol` → `asset.ticker`. If an asset has `manualPrice` set and `manualPriceAsOf` is fresh enough, it overrides market lookup.

### Sync job
Inline scheduled route, not a separate worker.

- Route: `src/app/api/cron/sync-prices/route.ts`.
- Triggered by an external cron (launchd on the host) hitting `POST /api/cron/sync-prices` with a shared token (`CRON_SECRET`).
- Gated: skips if already ran successfully today (check `price_history.source='yahoo'` last row). The same-day skip is intentional idempotency — a re-run does NOT refresh that day's close; delete the day's `price_history` row to force one.
- Concurrency: an in-process guard returns 409 while a run is in flight; external calls carry a 10s timeout and retry with backoff.
- Incremental historical backfill: fetches missing days per symbol.
- Retries with delay on rate-limit errors.
- FX ingestion: pulls `EURUSD=X` (and any other needed pairs) into `price_history` with `source='yahoo_fx'`.
- Asset valuations: after each sync, recomputes `asset_valuations` for active assets for the new day.
- Composition snapshots: the same cron also refreshes the sector and geographic breakdowns (see below). Both are freshness-gated, so most daily runs skip every asset.

### Composition data (sectors & geography)
Slow-moving holdings breakdowns, snapshotted per asset (no history), surfaced as the composition donuts on `/statement`. Never call these sources from a component or action — go through `src/lib/pricing/`, stubbed in tests.

- **Sectors** — Yahoo `topHoldings.sectorWeightings` (ETFs/funds) or `assetProfile.sectorKey` (single stocks), via `src/lib/pricing/yahoo.ts`. Stored in `asset_sector_weightings` by `src/lib/sector-sync.ts`; refreshed every **7 days**. Read helper `src/server/sectors.ts`. Crypto and commodity ETPs (`subtype='commodity'`) get their own buckets; uncovered value → «Sin clasificar».
- **Geography** — JustETF profile page by ISIN (`src/lib/pricing/justetf.ts`). The static page lists only the top countries + an aggregated «Other»; the full breakdown lives behind a Wicket «Show more» AJAX callback, so the client does GET (for the session cookie + page-version URL) → POST `loadMoreCountries`, then parses the expanded table (falls back to the truncated list on failure). Stored **per country** in `asset_country_weightings` by `src/lib/country-sync.ts` (ETFs/funds with an ISIN only); refreshed every **30 days** (JustETF publishes a monthly snapshot). The read helper `src/server/countries.ts` folds countries into **regions/continents** via `src/lib/countries.ts` (`countryRegion`). Geography-only: crypto, gold, individual stocks, a fund's uncovered sleeve, and assets without an ISIN are omitted from the chart, not bucketed; slice weights are share of the classified total so the donut sums to 100%. The residual «Otros» is JustETF's own un-itemised tail. Force a refresh with `DELETE FROM asset_country_weightings` + re-trigger the sync.

### USD → EUR conversion
Market FX (`EURUSD=X` from `price_history`) first. Fallback to `fxRateToEur` stored on the originating transaction. Last resort: `1.0` with a warning badge on the row. **This last-resort applies to display valuations only — never to tax data.** Tax-relevant EUR amounts are stamped at entry time via `fx_rates` (precedence in `src/lib/fx.ts`: explicit user/broker rate → exact-date rate → stale-latest rate, flagged via `fxSource`), and entry is rejected when no rate exists at all.

### Tax-data provenance (hard invariant)
Values feeding the tax report (`src/server/tax/`) trace to user-entered transaction data; they are never derived from or backfilled with market quotes. One sanctioned exception, always disclosed:

- **Crypto permutas (swaps cripto↔cripto, `createSwap`):** both legs are valued at the quote currency's daily close from `fx_rates` (CoinGecko for stablecoins/crypto quotes), per DGT V0999-18 / V1149-20 — there is no user-entered EUR value for these trades. Such rows carry `asset_transactions.valuationBasis = 'market-fx'` and are flagged in the Gains table and the tax detail export.
- **Year-end balances (M720/M721/D-6):** declared at market value from `asset_valuations` by legal definition. Missing valuations surface as `UNVALUED` (never silent €0); valuations older than 10 days before Dec 31 are flagged stale.

The executable form of this invariant is `src/server/tax/__tests__/market-independence.test.ts`.

### Freshness indicator
Each asset row shows last market update timestamp + source (Yahoo / manual / stale).

---

## 7. Data Layer

Single `better-sqlite3` database, file path from env (`DB_PATH`, default `./data/finances.db`). WAL mode on.

Drizzle schema under `src/db/schema/*.ts`, one file per domain aggregate (accounts, assets, transactions, prices, audit). Migrations under `drizzle/`. `pnpm db:migrate` applies them; never edit past migrations.

All data access runs through Server Components + Server Actions. There is no HTTP API layer between the UI and the DB — the old `lib/api.ts` wrapper from the monorepo is replaced by direct Drizzle calls in `src/server/`.

Read helpers: `src/server/accounts.ts`, `assets.ts`, `transactions.ts`, `overview.ts`, `positions.ts`, `savings.ts`, `statement.ts`, `sectors.ts`, `countries.ts`, `costs.ts`, `audit.ts`, plus the tax engine under `src/server/tax/`. The same layer hosts the tx-scoped derived-state recompute engine (`recompute.ts`, `rebuild.ts`, `valuations.ts`, `tax/lots.ts`) — write functions callable only inside an action's transaction.

Mutations: Server Actions in `src/actions/*.ts`, one file per aggregate.

---

## 8. Project Structure

```
finances/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx                    # Overview
│   │   ├── accounts/
│   │   │   ├── page.tsx
│   │   │   └── [accountId]/page.tsx
│   │   ├── assets/page.tsx
│   │   ├── transactions/page.tsx
│   │   ├── statement/page.tsx
│   │   ├── objectives/page.tsx
│   │   ├── simulador/page.tsx
│   │   ├── asesor/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── taxes/page.tsx              # redirect → latest year
│   │   ├── taxes/[year]/page.tsx
│   │   ├── audit/page.tsx
│   │   ├── health/route.ts
│   │   └── api/
│   │       ├── cron/{sync-prices,backfill-prices,advisor-scan,advisor-curate,advisor-chat-compact}/route.ts
│   │       ├── advisor/chat/route.ts
│   │       └── exports/                # statement + tax (csv/json/pdf) endpoints
│   ├── components/
│   │   ├── ui/                         # Button, Card, Modal, DataTable, KPICard, charts/*
│   │   ├── layout/                     # LayoutShell, TopNav, SideNav, Providers
│   │   └── features/                   # accounts/, assets/, transactions/, overview/, statement/, taxes/, audit/
│   ├── server/                         # Drizzle read helpers + tx-scoped recompute (rebuild.ts)
│   ├── actions/                        # Server Actions (mutations)
│   ├── db/
│   │   ├── client.ts                   # better-sqlite3 + Drizzle init
│   │   └── schema/
│   ├── lib/
│   │   ├── domain.ts                   # domain constants + ActionResult types (client-safe)
│   │   ├── labels.ts                   # Spanish display-label maps (client-safe)
│   │   ├── format.ts                   # money formatting, locale (es-ES)
│   │   ├── money.ts                    # roundEur / round — the only sanctioned rounding
│   │   ├── pagination.ts               # cursor helpers
│   │   ├── fx.ts                       # FX resolution
│   │   ├── pricing/                    # Yahoo / CoinGecko / JustETF client wrappers
│   │   ├── sectors.ts                  # sector taxonomy + labels (client-safe)
│   │   ├── countries.ts                # country→region map + labels (client-safe)
│   │   ├── sector-sync.ts              # Yahoo sector snapshot refresh (cron)
│   │   ├── country-sync.ts             # JustETF geography snapshot refresh (cron)
│   │   ├── objective-colors.ts         # objective palette resolution (client-safe)
│   │   ├── simulator.ts                # deterministic FIRE projection (client-safe)
│   │   ├── risk.ts                     # drawdown + volatility
│   │   ├── benchmarks.ts / benchmark-sync.ts  # MSCI World / S&P 500 reference series
│   │   ├── advisor/                    # Claude Agent SDK client, scan/curate, memory, telegram
│   │   ├── exports/                    # XLSX/CSV builders
│   │   └── pdf/                        # statement-report.ts, account-statement.ts, tax-report.ts
│   └── types/                          # shared TS types (ported from @second-brain/types)
├── drizzle/                            # migrations
├── data/                               # sqlite file (gitignored)
├── public/
├── tests/                              # vitest
├── .env.local.example
├── drizzle.config.ts
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── package.json
└── README.md
```

---

## 9. Environment Variables

```
DATABASE_URL=data/finances.db            # primary; DB_PATH is a legacy alias
DB_PATH=./data/finances.db
CRON_SECRET=<random>
YAHOO_USER_AGENT=<optional override>
COINGECKO_API_KEY=<optional, enables crypto price sync>
NEXT_PUBLIC_APP_NAME=Patrimonio          # top-nav brand
PORT=3200

# AI advisor (asesor). Uses the Claude Agent SDK via the Max subscription token,
# so usage draws on the plan's monthly credit. NEVER set ANTHROPIC_API_KEY too —
# it wins auth precedence and would bypass the credit (the advisor refuses to run).
CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`>
ADVISOR_ENABLED=true
ADVISOR_CHAT_MODEL=claude-opus-4-8
ADVISOR_SCAN_MODEL=claude-sonnet-4-6
ADVISOR_DIGEST_MAX_BYTES=8192
ADVISOR_PROFILE_MAX_BYTES=4096
ADVISOR_TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=<bot de @BotFather, para el report matinal>
TELEGRAM_CHAT_ID=<chat del usuario con el bot>
```

No `NEXT_PUBLIC_API_URL` — data is fetched server-side via Drizzle, not HTTP.

---

## 10. Testing Surface

Vitest unit + in-process e2e tests cover:

- Money formatting, rounding, and FX resolution (`src/lib/format`, `src/lib/money`, `src/lib/fx`).
- Pagination cursor helpers (`src/lib/pagination`).
- Position + cash recomputation after a trade is inserted / deleted (`src/lib/price-sync`, e2e lifecycle).
- The foral tax engine: FIFO lots, wash-sale (antiaplicación), cuota/compartimentos, Previsión coefficients, M720 aggregation, year sealing, market-independence invariant (`src/server/tax/__tests__/`).
- Composition: sector & country sync + read layers, and the JustETF HTML parser against a captured fixture (`src/lib/__tests__/{sector,country}-sync`, `src/server/__tests__/{sectors,countries}`, `src/lib/pricing/justetf`).
- FIRE simulator math, XIRR, risk (drawdown/volatility), benchmarks, costs, objectives allocation, advisor conversations/memory/telegram.

No dedicated browser E2E in v1 (the e2e suite drives the DB + actions in-process). Manual verification in browser for UI flows. The Yahoo, CoinGecko and JustETF clients are all stubbed in tests — no real network calls.

---

## 11. Out of Scope (v1)

- Auth. LAN-only, single user. No session/login.
- Multi-currency base. EUR is fixed.
- Real-time price streaming. Daily sync only.
- Mobile-specific layouts. Desktop-first; must not break at tablet width, but no dedicated mobile UX.
- Integration tests against the real Yahoo / CoinGecko / JustETF endpoints.
- CSV / broker-statement import. The DEGIRO/Binance/Cobas importers were removed 2026-06; manual entry is the only registration path.

> Several v1 "future ideas" have since shipped and are now documented above: benchmark overlay (§5.8/§1), price-freshness indicator (§6), the AI advisor (§5.11), the FIRE simulator (§5.10), allocation objectives (§5.9), and the sector/geography composition donuts (§6).

---

## 12. Acceptance

v1 is done when:

1. Every route in §3 renders with real data from SQLite.
2. All CRUD flows in §5 work end-to-end (create, delete; manual entry only — no import).
3. The Yahoo sync route successfully populates `price_history` and `asset_valuations` for at least one asset with a `providerSymbol`.
4. Overview dashboard shows a non-empty performance chart for a seeded account with at least one buy transaction.
5. `pnpm build` and `pnpm test` both pass.
6. Launching with a fresh DB (no seed) shows empty states on every page without errors.
