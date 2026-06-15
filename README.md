```
██████╗   █████╗  ████████╗ ██████╗  ██╗ ███╗   ███╗  ██████╗  ███╗   ██╗ ██╗  ██████╗
██╔══██╗ ██╔══██╗ ╚══██╔══╝ ██╔══██╗ ██║ ████╗ ████║ ██╔═══██╗ ████╗  ██║ ██║ ██╔═══██╗
██████╔╝ ███████║    ██║    ██████╔╝ ██║ ██╔████╔██║ ██║   ██║ ██╔██╗ ██║ ██║ ██║   ██║
██╔═══╝  ██╔══██║    ██║    ██╔══██╗ ██║ ██║╚██╔╝██║ ██║   ██║ ██║╚██╗██║ ██║ ██║   ██║
██║      ██║  ██║    ██║    ██║  ██║ ██║ ██║ ╚═╝ ██║ ╚██████╔╝ ██║ ╚████║ ██║ ╚██████╔╝
╚═╝      ╚═╝  ╚═╝    ╚═╝    ╚═╝  ╚═╝ ╚═╝ ╚═╝     ╚═╝  ╚═════╝  ╚═╝  ╚═══╝ ╚═╝  ╚═════╝
                        P A T R I M O N I O
```

![claude code](https://img.shields.io/badge/claude_code-required-blue?style=flat-square)
![node](https://img.shields.io/badge/node-22%2B-green?style=flat-square)
![next.js](https://img.shields.io/badge/next.js-16.2-white?style=flat-square)
![sqlite](https://img.shields.io/badge/sqlite-local-yellow?style=flat-square)
![eur](https://img.shields.io/badge/base-EUR-blue?style=flat-square)
![timezone](https://img.shields.io/badge/tz-Europe%2FMadrid-orange?style=flat-square)

**Patrimonio — Portfolio Tracker + Foral Tax Engine + AI Advisor**

> *Un dashboard para tu patrimonio. Una SQLite a tu lado. Un cron cada noche.*

A single-user portfolio tracker that lives on your machine. Register your trades by hand, let Yahoo Finance + CoinGecko quote your holdings every weekday at 23:00 Madrid, and watch range-aware P/L, per-asset sparklines, allocation objectives, sector/geography composition, a Bizkaia foral tax report, and an AI advisor land in a dark-mode dashboard.

No cloud. No auth. No subscription. One SQLite file, one cron entry, market-data clients, and Claude Code doing the talking.

---

## Capabilities

### Overview Dashboard

- **KPI row** — Net worth, cash (savings only), invested (cost basis), unrealized P/L with % delta, all range-aware
- **Portfolio evolution chart** — Area chart of `value / cumulative_invested × 100`, so the curve reflects market movement net of contributions (baseline 100 = break-even)
- **Top positions table** — Symbol + name, quantity, avg buy / unit, current / unit, current / total, range-aware P/L (EUR + %), per-asset sparkline sharing the same math as the portfolio chart
- **Range tabs** — 1M · 3M · 6M · YTD · 1Y · ALL. P/L figures subtract contributions that landed inside the window so fresh deposits don't inflate the gain
- **Account filter tags** — Multi-select: "All" plus one pill per account. Selecting DEGIRO narrows every card, the chart, and the table to assets traded in that account
- **Sensitive mode** — Blur every monetary value behind `<SensitiveValue>` with a single toggle; respected in cards, tables, charts, and PDF exports

### Accounts

- **Types** — `broker` · `crypto` · `investment` · `savings`. Only `savings` tracks a cash balance; broker/crypto/investment are pure position containers and buys never debit a fictional cash float
- **Account detail** — Header with cash KPI (hidden for non-cash types), holdings count, total value, PDF export link
- **Ledger** — Paginated unified feed of trades + cash movements with delete confirm

### Assets

- **Search & edit** — Name, symbol, ISIN, exchange, `providerSymbol` (Yahoo override), active toggle
- **Manual price** — Set a manual NAV for illiquid assets; stored as a `price_source='manual'` row
- **Deactivate** — Soft-hide stale assets; excluded from sync and valuations

### Data entry

- **Manual only** — The DEGIRO/Binance/Cobas CSV importers were removed (2026-06). Trades and cash movements are entered through the `/transactions` modal (buy / sell / dividend / fee / swap / cash movement)
- **Swaps** — `createSwap` records a matched sell+buy pair on one date with zero net cash impact (crypto↔crypto and cross-asset), both legs EUR-valued and linked
- **Dedup discipline survives** — every inserted row still carries a `rowFingerprint`; `asset_transactions.source` keeps the legacy `degiro`/`binance`/`cobas` provenance on rows ingested before the importers were dropped

### Pricing

- **Yahoo Finance** — `yahoo-finance2` v3 client, instantiated once. Quote currency is captured from the response (not the asset row) so ADRs and dual-listed funds convert correctly
- **Cron route** — `/api/cron/sync-prices`, gated by `x-cron-secret`. Idempotent within a calendar day: `price_history.(symbol, priced_date_utc)` has a unique index and the route skips existing rows
- **Historical backfill** — `scripts/backfill-history.ts` pulls daily bars for each asset from its first trade date, fills weekday holidays forward, and writes `price_history` + `fx_rates` + `asset_valuations`
- **Rebuild** — `scripts/rebuild-valuations.ts` regenerates `asset_valuations` from `price_history` + `fx_rates` with the same fill-forward, without hitting Yahoo
- **Composition snapshots** — the same cron also refreshes the `/statement` donuts: **sectors** from Yahoo `topHoldings`/`assetProfile` (7-day freshness), and **geography** from JustETF's profile page by ISIN (30-day freshness). The country breakdown is scraped in two steps — GET the page, then POST JustETF's Wicket "Show more" callback for the full list — stored per country and folded into regions/continents at read time. Geography is geography-only: crypto, gold, stocks and assets without an ISIN are omitted, not bucketed
- **Precision** — Unit prices stored to 6 decimals so sub-euro tickers (AMP.MC, NXT.MC) don't round to `€0.19`. Market values rounded to the cent

### Taxes (foral — Bizkaia)

- **Declaración vs Previsión** — `/taxes/[year]` shows the raw FIFO lot-by-lot detail to transcribe into Rentanet (*Declaración*) alongside an estimate after the foral *coeficientes de actualización* (*Previsión*)
- **FIFO lots + wash sale** — acquisition lots in `tax_lots`/`tax_lot_consumptions` (gross cost + fees separate); the *norma antiaplicación* defers disallowed losses into the acquiring lot's basis
- **Cuota & dividends** — two watertight compartments with no cross-offset, plus the €1.500 dividend exemption
- **M720 / M721** — informational-model status vs. manually-entered prior baselines (`tax_declared_baselines`), at the €50k / €20k thresholds
- **Sealing** — freeze a year's full report as a snapshot; a drift banner flags any later divergence
- **Exports** — `casillas` / `detail` CSV, `m720-diff` JSON/CSV, and a full PDF via `jspdf`

### Statement (`/statement`)

- **Composition donuts** — by asset type, by **geographic region** (JustETF), by **allocation objective** (1/3) alongside **equity sector** (2/3, Yahoo)
- **Risk** — max drawdown + annualised volatility from the 100-anchored performance index
- **Costs** — accumulated commissions + custody fees + forward-looking TER drag
- **Exports** — PDF / XLSX / CSV

### Objectives (`/objectives`)

- **Allocation plan tied to assets** (so the same exposure across brokers aggregates into one bucket): target % vs. current weight, drift (% and €), draggable target ring, contribution planner, per-asset assignment table. Surfaced as the by-objective donut on `/statement`

### FIRE Simulator (`/simulador`)

- **Deterministic compound-interest projection** with pesimista/base/optimista scenarios, the *snowball year*, reverse solvers (required contribution / years to target), and a 4%-rule FIRE block. Prefilled from current net worth

### AI Advisor (`/asesor`) + Telegram

- **Claude Agent SDK** chat over a live portfolio snapshot + investor profile + market digest; persistent conversation tabs; billed to the Max subscription (`CLAUDE_CODE_OAUTH_TOKEN`)
- **Scheduled crons** — hourly market scan (09:00 → Telegram morning brief), weekly digest curation, weekly chat compaction; every run metered in `advisor_runs`
- **Telegram bot** — standalone launchd daemon answering `/net` (KPIs) and `/ask` (one-shot advisor), restricted to one chat id

### Audit Log

- **Every mutation** writes an `audit_events` row: `previousJson` + `nextJson`, actor, source (`ui` / `degiro` / `binance` / `cobas`), context (FX source, override flags), summary
- **Filters** — Entity type, action, date range, actor. Row expansion shows the inline JSON diff

### Cron Integration

- **User crontab** — `scripts/cron-sync-prices.sh` sources `.env.local` and curls the sync route. Installed as:
  ```cron
  CRON_TZ=Europe/Madrid
  0 23 * * * /path/to/scripts/cron-sync-prices.sh >> ~/.finances/logs/cron.log 2>&1
  ```
- **launchd-friendly** — The companion `finances-service.sh` + plist run `pnpm start` on port 3200 with a SIGTERM-safe child reaper. xbar plugin polls the service every 5 seconds and exposes Start / Stop / Dev ↔ Prod / Restart

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                BROWSER (localhost:3200)                  │
│    Overview · Accounts · Assets · Txns · Taxes · Audit   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   Next.js 16 App Router                                  │
│   ├── Server Components (initial render, Drizzle reads)  │
│   ├── Client Components (Recharts, forms, modals)        │
│   ├── Server Actions — src/actions/*  (one per mutation) │
│   └── Route Handlers — /api/cron · /api/exports · /health│
│                                                          │
├────────────┬─────────────────┬───────────────────────────┤
│  SQLite    │  Yahoo Finance  │   Scripts / Cron          │
│  Drizzle   │  yahoo-finance2 │   ├── tsx backfill        │
│  data/     │  REST via node  │   ├── tsx rebuild         │
│  finances  │                 │   └── cron → /sync-prices │
│  .db       │                 │                           │
├────────────┴─────────────────┴───────────────────────────┤
│                                                          │
│   Vixie cron (user crontab, CRON_TZ=Europe/Madrid)       │
│   └── 23:00 Mon–Fri — fetch quotes + upsert valuations   │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                External (read-only)                      │
│   ├── Yahoo Finance — quotes, historical bars, FX pairs  │
│   ├── CoinGecko — crypto quotes (EUR-native)             │
│   └── JustETF — fund geography by ISIN (composition)     │
└──────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js 22+ | Next 16 requirement |
| Framework | Next.js 16 (App Router) | RSC, Server Actions, co-located routes |
| Language | TypeScript (strict) | No `any` without a comment |
| Styling | Tailwind CSS 4 | Utility-first, theme tokens as CSS vars |
| Database | SQLite via `better-sqlite3` | Zero infrastructure, one file |
| ORM | Drizzle ORM 0.45 + drizzle-kit 0.31 | Type-safe schema, generated migrations, no raw SQL in app code |
| Validation | Zod 4 | Every Server Action validates at the boundary |
| Charts | Recharts 3 | Area / Line primitives with theme tokens |
| Pricing | yahoo-finance2 3.14 | Quotes, chart bars, FX pairs (EURUSD=X) |
| Composition | Yahoo (sectors) + JustETF (geography by ISIN) | `/statement` sector and region donuts |
| PDF | jspdf | Account statement + tax report exports |
| IDs | ULID | Lexicographically sortable, monotonic |
| Testing | Vitest 4 | Unit + integration (in-memory SQLite) |

---

## Domain Model

All tables carry `id` (ULID text PK), `createdAt` / `updatedAt` (ms epoch). Every monetary column is EUR-normalised with the native amount + `fxRateToEur` snapshot stored alongside.

### `accounts`

| Column | Type | Notes |
|---|---|---|
| `name`, `currency` | text | `currency` is the user-chosen account currency (usually EUR) |
| `accountType` | text | `broker` · `crypto` · `investment` · `savings` |
| `openingBalanceEur` | real | Zero for non-cash-bearing types (enforced on write) |
| `currentCashBalanceEur` | real | Kept at 0 for non-`savings` types by `recomputeAccountCashBalance` |

### `assets`

| Column | Type | Notes |
|---|---|---|
| `name`, `symbol`, `ticker`, `isin` | text | ISIN is the primary match key for importers |
| `assetType` | text | `etf` · `stock` · `bond` · `crypto` · `fund` · `cash-equivalent` · `other` |
| `currency` | text | Quote currency (USD for US ADRs, EUR for UCITS). Drives FX resolution on sync |
| `providerSymbol` | text | Yahoo Finance ticker override (e.g. `VWCE.DE`, `0P0001LFVO.F`) |
| `isActive` | boolean | `false` excludes from sync and KPI aggregates |

### `asset_transactions`

| Column | Type | Notes |
|---|---|---|
| `accountId`, `assetId` | text | FKs |
| `transactionType` | text | `buy` · `sell` · `dividend` · `fee` |
| `tradedAt` | integer | ms epoch |
| `quantity`, `unitPrice` | real | Native |
| `tradeCurrency`, `fxRateToEur` | text, real | FX snapshot from the broker row or the date's `fx_rates` row |
| `tradeGrossAmount`, `tradeGrossAmountEur` | real | Native + EUR snapshot |
| `feesAmount`, `feesAmountEur` | real | Fees may be broker-reported already in EUR (`feesAlreadyEur`) |
| `cashImpactEur`, `netAmountEur` | real | Negative for buys, positive for sells |
| `rowFingerprint` | text | Deterministic `sha256(source+account+date+asset+side+qty+price)` for import dedup |
| `source` | text | `manual` · `degiro` · `binance` · `cobas` · `seed` |
| `rawPayload` | text | Original CSV row JSON, for debugging |

### `account_cash_movements`

| Column | Type | Notes |
|---|---|---|
| `movementType` | text | `deposit` · `withdrawal` · `interest` · `fee` · `dividend` · `transfer-in` · `transfer-out` · `trade` |
| `occurredAt` | integer | ms epoch |
| `nativeAmount`, `currency`, `fxRateToEur` | real, text, real | Same EUR-snapshot pattern |
| `cashImpactEur` | real | Signed; rolls up into `currentCashBalanceEur` |
| `affectsCashBalance` | boolean | False for synthetic entries we want logged but not balance-counted |
| `rowFingerprint` | text | For import dedup; trade-paired movements use `trade:<id>` |

### `asset_positions`

| Column | Type | Notes |
|---|---|---|
| `assetId` | text | Unique |
| `quantity` | real | Rounded to 10dp |
| `averageCostEur`, `totalCostEur` | real | Weighted average, EUR-native |
| `averageCostNative`, `totalCostNative` | real | Same in the asset's native currency |
| `manualPrice`, `manualPriceAsOf` | real, integer | Overrides latest valuation when set |

### `asset_valuations`

| Column | Type | Notes |
|---|---|---|
| `assetId`, `valuationDate` | text | Unique pair (`yyyy-mm-dd`) |
| `quantity`, `unitPriceEur`, `marketValueEur` | real | Unit price 6dp, market value 2dp |
| `priceSource` | text | `yahoo` · `manual` · `backfill` · `rebuilt` |

### `price_history`

| Column | Type | Notes |
|---|---|---|
| `symbol`, `pricedDateUtc` | text | Unique pair |
| `pricedAt`, `price` | integer, real | Native to the symbol's venue |
| `source` | text | `yahoo` · `yahoo-backfill` · `manual` |

### `fx_rates`

| Column | Type | Notes |
|---|---|---|
| `currency`, `date` | text | Unique pair |
| `rateToEur` | real | `native × rateToEur = EUR` (i.e. `1 / EURxxx=X`) |

### `audit_events`

| Column | Type | Notes |
|---|---|---|
| `entityType`, `entityId`, `action` | text | e.g. `account` · `create` · `<ulid>` |
| `actorType`, `source`, `summary` | text | Actor always `user`, source is the UI/import origin |
| `previousJson`, `nextJson`, `contextJson` | text | Diff payloads + FX/provider context |

---

## API Reference

Mutations live in Server Actions under `src/actions/*` — no REST endpoints. Read paths import directly from `src/server/*` in Server Components. The only HTTP surface is the cron route and PDF exports.

### Route Handlers

| Method | Path | Description |
|---|---|---|
| `GET` / `POST` | `/api/cron/sync-prices` | Fetch today's Yahoo quote for every active asset, upsert `price_history` + `fx_rates` + `asset_valuations`. Requires `x-cron-secret` header |
| `GET` | `/api/exports/account-statement?accountId=<ulid>` | PDF statement for the account (positions + ledger) |
| `GET` | `/api/exports/tax-report?year=YYYY` | PDF FIFO realized gains + dividend/interest report |
| `GET` | `/health` | Liveness probe — returns `200 { ok: true }` |

### Server Actions (representative)

| File | Purpose |
|---|---|
| `src/actions/accounts.ts` | Create account with optional opening deposit |
| `src/actions/deleteAccount.ts` | Delete — blocks if transactions exist |
| `src/actions/createAsset.ts` / `updateAsset.ts` / `deactivateAsset.ts` | Asset lifecycle |
| `src/actions/createTransaction.ts` / `deleteTransaction.ts` | Manual trade entry, recomputes position + cash |
| `src/actions/createCashMovement.ts` / `deleteCashMovement.ts` | Deposit / withdrawal / dividend / fee |
| `src/actions/createSwap.ts` | Matched sell+buy swap (permuta), zero net cash |
| `src/actions/objectives.ts` | Allocation-objective CRUD + asset assignment |
| `src/actions/setManualPrice.ts` | Override valuation for an illiquid asset |

All actions return `{ ok: true, data } | { ok: false, error }` — never throw across the boundary for expected failures. Input is Zod-validated at the entry point; Zod schemas live in sibling `<name>.schema.ts` files because Next 16's `"use server"` rule forbids non-async exports from action files.

### Status Codes

`200` ok · `201` created · `400` bad input · `401` unauthorized (cron) · `403` forbidden · `404` not found · `500` server error.

---

## Project Structure

```
finances/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout — theme + sensitive-mode attrs
│   │   ├── page.tsx                # /  Overview (KPIs + chart + top positions)
│   │   ├── accounts/               # /accounts · /accounts/[id]
│   │   ├── assets/                 # /assets
│   │   ├── transactions/           # /transactions
│   │   ├── imports/                # /imports (CSV preview → confirm)
│   │   ├── taxes/                  # /taxes (year selector)
│   │   ├── audit/                  # /audit (event feed with filters)
│   │   ├── settings/               # /settings
│   │   ├── health/route.ts         # Liveness probe
│   │   └── api/
│   │       ├── cron/sync-prices/   # Yahoo quote sync (cron-gated)
│   │       └── exports/            # PDF account-statement + tax-report
│   ├── actions/                    # One Server Action per mutation
│   │   ├── *.ts                    # "use server" — async functions only
│   │   └── *.schema.ts             # Zod schemas + related consts / types
│   ├── server/                     # Read helpers for Server Components
│   │   ├── overview.ts             # KPIs, series, top positions
│   │   ├── positions.ts            # Asset position projections
│   │   ├── accounts.ts             # Accounts summary (cash-aware)
│   │   ├── assets.ts               # Asset list with latest valuation
│   │   ├── taxes.ts                # FIFO realized gains computation
│   │   ├── audit.ts                # Filtered audit feed
│   │   └── recompute.ts            # Position + cash balance recompute
│   ├── components/
│   │   ├── features/
│   │   │   ├── overview/           # NetWorthChart, PositionSparkline, OverviewFilters, TopPositionsTable
│   │   │   ├── accounts/           # AccountHeader, AccountsTable, CreateAccountModal, AccountLedger
│   │   │   ├── assets/             # AssetsTable, CreateAssetModal, EditAssetModal, SetManualPriceModal
│   │   │   ├── transactions/       # CreateTransactionModal, DeleteTransactionButton
│   │   │   └── imports/            # ImportWizard (preview → confirm)
│   │   └── ui/                     # Card, DataTable, KPICard, Modal, SensitiveValue, StatesBlock, ...
│   ├── db/
│   │   ├── client.ts               # better-sqlite3 + drizzle singleton
│   │   ├── schema/                 # Drizzle tables (one file per aggregate)
│   │   ├── migrate.ts              # `pnpm db:migrate` entrypoint
│   │   └── seed.ts                 # Optional dev data
│   ├── lib/
│   │   ├── imports/
│   │   │   ├── degiro.ts           # DEGIRO Transactions CSV (new + legacy)
│   │   │   ├── binance.ts          # Binance spot + savings
│   │   │   ├── cobas.ts            # Cobas Asset Management
│   │   │   ├── _shared.ts          # CSV parse, fingerprint, decimal/date helpers
│   │   │   └── types.ts
│   │   ├── pricing.ts              # yahoo-finance2 v3 client wrapper
│   │   ├── price-sync.ts           # Sync orchestrator (price + FX + valuation)
│   │   ├── fx.ts                   # resolveFxRate, toIsoDate
│   │   ├── pdf/                    # account-statement + tax-report generators
│   │   └── format.ts               # formatEur, formatPercent, formatDate
├── drizzle/                        # Generated migrations (checked in)
├── scripts/
│   ├── backfill-history.ts         # Historical prices + FX + valuations from first trade
│   ├── rebuild-valuations.ts       # Rebuild asset_valuations from price_history
│   ├── sync-prices.ts              # One-shot local trigger
│   ├── cron-sync-prices.sh         # Cron wrapper (sources .env.local, curls route)
│   ├── resolve-symbols.ts          # ISIN → Yahoo symbol hint
│   └── apply-symbols.ts            # Bulk-set providerSymbol
├── data/                           # SQLite files (gitignored)
├── SPEC.md                         # Product spec — entities, routes, behaviour
├── CLAUDE.md                       # Engineering rules of engagement
├── drizzle.config.ts
├── next.config.ts
├── tsconfig.json
├── package.json
├── .env.local                      # gitignored
└── .env.local.example              # committed template
```

---

## Setup

### Prerequisites

- **Node.js 22+** (Next 16 requirement) and **pnpm**
- **Claude Code CLI** for schema/test workflows ([docs](https://docs.anthropic.com/en/docs/claude-code))
- One or more broker CSV exports — DEGIRO, Binance, or Cobas

### Install

```bash
git clone git@github.com:Nyhz/finances-bf.git
cd finances-bf
pnpm install
```

### Configure

Copy `.env.local.example` to `.env.local`:

```bash
# Path to the SQLite database file (relative to repo root)
DATABASE_URL=data/finances.db

# Legacy alias used in SPEC §9; keep in sync with DATABASE_URL
DB_PATH=./data/finances.db

# Shared secret required by the price-sync cron route
CRON_SECRET=change-me

# Optional override for the Yahoo Finance client User-Agent header
YAHOO_USER_AGENT=

# Display name shown in the UI shell (quote values with spaces)
NEXT_PUBLIC_APP_NAME="Patrimonio"

# Port Next.js binds to in dev/start
PORT=3200
```

### Database

```bash
pnpm db:migrate     # Apply pending migrations — creates data/finances.db on first run
pnpm db:seed        # Optional dev fixtures
```

### Launch

```bash
pnpm dev            # Next.js dev on :3200
pnpm build          # Production build
pnpm start          # Production server on :3200
```

Open [http://localhost:3200](http://localhost:3200). Create a savings account (or a broker for position-only tracking), import a CSV from `/imports`, then wire the cron below.

### Daily Price Sync

Install the cron entry (Madrid timezone, every day at 23:00 — crypto trades 24/7, weekday-only would leave Sat/Sun stale):

```bash
(crontab -l 2>/dev/null; cat <<'EOF'
CRON_TZ=Europe/Madrid
0 23 * * * /absolute/path/to/scripts/cron-sync-prices.sh >> ~/.finances/logs/cron.log 2>&1
EOF
) | crontab -
```

Weekend runs against Yahoo-tracked assets are harmless: the sync skips the insert when the returned quote timestamp matches the last bar (stocks/ETFs return Friday's close on Saturday — one `price_history` row per actual trading day, no duplicates).

### Historical Backfill (one-shot)

After registering your first trades, populate daily history from Yahoo for every active asset:

```bash
pnpm exec tsx scripts/backfill-history.ts
```

This pulls per-symbol daily bars from each asset's first trade date, seeds `fx_rates` for non-EUR currencies, and writes weekday `asset_valuations`.

---

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Next.js dev server on port 3200 |
| `pnpm build` | Production build |
| `pnpm start` | Production server on port 3200 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint (config from create-next-app) |
| `pnpm test` | Vitest run |
| `pnpm db:generate` | Drizzle → SQL migration (after schema changes) |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Seed dev fixtures |
| `pnpm sync:prices` | Local cron trigger — curls `/api/cron/sync-prices` |
| `pnpm exec tsx scripts/backfill-history.ts` | Historical prices + FX + valuations |
| `pnpm exec tsx scripts/rebuild-valuations.ts` | Rebuild valuations from `price_history` + `fx_rates` |

---

## Design Rules

### EUR Is Base

**Every monetary column stores EUR** plus the native amount + `fxRateToEur` snapshot. Never mix units in a single column. All FX resolution goes through `src/lib/fx.ts`, never ad-hoc. Importers that carry broker-supplied FX (DEGIRO's `Exchange rate`) pass it via `fxRateToEurOverride` on `ParsedTradeRow`, and `confirmImport` uses it instead of the date's `fx_rates` row.

### Range-Aware P/L

Every P/L computation — KPI card, per-position cell, sparkline — subtracts contributions made *inside* the selected range so fresh deposits don't inflate the gain. For the portfolio chart this means `marketIndex = valueEur / cumulative_investedEur × 100` with baseline 100. For `range === "ALL"` it collapses to `marketValue − costBasis`.

### Sensitive Mode

**Every monetary value renders inside `<SensitiveValue>`.** No exceptions — KPIs, table cells, chart tooltips, PDF exports. The blur toggle is useless if a single component forgets.

### Server Actions

All mutations go through an action under `src/actions/*`. Every action must:

1. Validate input with Zod at the entry point. Reject before touching the DB
2. Run inside `db.transaction()` when it touches more than one table
3. Write an `audit_events` row describing the change
4. Call `revalidatePath()` for every route that reads the affected data
5. Return `{ ok: true, data } | { ok: false, error }` — never throw across the boundary for expected failures

### Next 16 `"use server"` Rule

Files with `"use server"` can only export async functions. Zod schemas and related consts live in sibling `<name>.schema.ts` modules. Tests and non-server consumers import from the schema file.

### UI Primitives

Buttons go through `Button`; modals through `Modal` / `ConfirmModal`; tables through `DataTable`. Destructive actions require `ConfirmModal`. Loading states are skeletons (`StatesBlock`), not spinners. Charts read colours from `hsl(var(--primary|border|muted-foreground))` — never hardcode hex.

### Single-User, LAN-Only

The web UI has **no auth**. The cron route is gated by `x-cron-secret`. That's the whole security model. Do not expose this to the internet without a tunnel or reverse proxy.

---

## Definition of Done

Before reporting a mission complete:

- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes; new logic has a unit test where it fits the listed surface
- [ ] `pnpm build` succeeds
- [ ] New DB columns have a generated migration under `drizzle/`
- [ ] New env vars are added to `.env.local.example` and referenced in `SPEC.md`
- [ ] Touched UI was verified in both dark and light mode
- [ ] Mutations write an audit event and call `revalidatePath`
- [ ] Every new monetary render goes through `<SensitiveValue>`
- [ ] Fresh-DB smoke: launching against an empty database shows empty states without errors

---

## Implementation Notes

- **SQLite file** (`data/finances.db`) is gitignored. Created automatically on first `db:migrate`
- **Xetra / EU market holidays** — Yahoo's chart endpoint returns no bar on closed days. The rebuild scripts carry the last known close forward for missing weekdays so portfolio aggregates don't crater
- **US quote currency** — JD and UNH (DEGIRO ADRs) trade in USD on Yahoo but DEGIRO's CSV reports the EUR-settled amount. The parser reads the instrument currency from the unnamed column next to `Price`, uses the broker's `Exchange rate` as the snapshot, and the asset row carries `currency = 'USD'` so daily sync FX-converts correctly
- **Cobas NAV** — Published Mon–Fri as `0P0001LFVO.F` on Yahoo (`<provider>.F` suffix). Not a weekly fund
- **Preview batch dedup** — Multi-row CSVs that reference the same pending asset only flag the *first* row as `needs_asset_creation`; the rest preview as `new` and resolve to the freshly-created asset on confirm
- **Position recompute** — Runs inline inside the same transaction as the trade insert/delete. `asset_positions` and `account.currentCashBalanceEur` never drift out of sync with the source rows
- **Non-cash account types** — `recomputeAccountCashBalance` forces the balance to 0 for `broker` / `crypto` / `investment`. Cash KPIs treat those as contributing 0 even if a legacy row has a non-zero value
- **Migrations are append-only** — Never edit a shipped `drizzle/000X_*.sql`; generate a new one

---

## Philosophy

**One user. One machine. One currency.** This is not a multi-tenant SaaS. It runs on your laptop, stores positions in a file, and answers to exactly one person — you. No sharing, no accounts, no multi-base-currency gymnastics. EUR is base; native is snapshotted.

**Brokers can't be trusted on their own.** CSV formats change, currencies flip between settlement and instrument, fees get baked into rounded totals. The importer treats every field with suspicion, stores the raw CSV row for audit, and persists the broker-supplied FX so your cost basis matches what you actually paid — not whatever Yahoo quotes today.

**Precision beats prettiness.** Unit prices at 6 decimals, quantities at 10, market values at 2. Never fight sub-euro tickers with `Math.round(x*100)/100`.

**Local-first, boring infrastructure.** SQLite file. User crontab. Subprocess. No Redis, no queues, no Docker. If it can't survive a laptop reboot, it doesn't belong here.

**Spanish by default.** Madrid timezone, Spanish number formatting (`35.188,14€`), Spanish holidays respected by the cron. Your money speaks your language.

---

<p align="center">
  <sub>PATRIMONIO — v0.1.0</sub><br>
  <sub>Europe/Madrid · EUR · Local-first · One user, one portfolio.</sub>
</p>
