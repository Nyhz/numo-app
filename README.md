```
 ███╗   ██╗ ██╗   ██╗ ███╗   ███╗  ██████╗      █████╗  ██████╗  ██████╗
 ████╗  ██║ ██║   ██║ ████╗ ████║ ██╔═══██╗    ██╔══██╗ ██╔══██╗ ██╔══██╗
 ██╔██╗ ██║ ██║   ██║ ██╔████╔██║ ██║   ██║    ███████║ ██████╔╝ ██████╔╝
 ██║╚██╗██║ ██║   ██║ ██║╚██╔╝██║ ██║   ██║    ██╔══██║ ██╔═══╝  ██╔═══╝
 ██║ ╚████║ ╚██████╔╝ ██║ ╚═╝ ██║ ╚██████╔╝    ██║  ██║ ██║      ██║
 ╚═╝  ╚═══╝  ╚═════╝  ╚═╝     ╚═╝  ╚═════╝     ╚═╝  ╚═╝ ╚═╝      ╚═╝
                       patrimonio, en claro
```

![next.js](https://img.shields.io/badge/next.js-16.2-black?style=flat-square)
![react](https://img.shields.io/badge/react-19.2-149eca?style=flat-square)
![node](https://img.shields.io/badge/node-22%2B-green?style=flat-square)
![sqlite](https://img.shields.io/badge/sqlite-local-yellow?style=flat-square)
![eur](https://img.shields.io/badge/base-EUR-blue?style=flat-square)
![timezone](https://img.shields.io/badge/tz-Europe%2FMadrid-orange?style=flat-square)
![ai](https://img.shields.io/badge/AI-Claude_Agent_SDK-8a4fff?style=flat-square)

**Numo App — Portfolio Tracker · Foral Tax Engine · AI Advisor**

> *Tu patrimonio en claro. Una SQLite a tu lado. Un par de crons cada noche.*

Numo App is a single-user portfolio tracker that lives on **your** machine. You register your trades by hand; it quotes your holdings from Yahoo Finance + CoinGecko, watches a list of tickers intraday, fires price alerts, runs a Claude-powered advisor over a live snapshot of your wealth, and renders range-aware P/L, allocation objectives, sector/geography composition, a FIRE simulator and a full Bizkaia foral tax report — all in euros, all in Spanish, all in a dark-mode dashboard.

No cloud. No auth. No subscription tier. One SQLite file, a couple of `launchd` jobs, the market-data clients, and Claude doing the talking.

---

## Contents

- [Capabilities](#capabilities)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Domain Model](#domain-model)
- [Routes](#routes)
- [Cron & Background Jobs](#cron--background-jobs)
- [Setup](#setup)
- [Scripts](#scripts)
- [Design Rules](#design-rules)
- [Philosophy](#philosophy)

---

## Capabilities

### Overview (`/`)

- **KPI row** — Net worth, cash (savings only), invested (cost basis), unrealized P/L with % delta, all range-aware.
- **Portfolio evolution chart** — Area chart of `value / cumulative_invested × 100`, so the curve reflects market movement net of contributions (baseline 100 = break-even).
- **Top positions table** — Symbol + name, quantity, avg buy, current price, total value, range-aware P/L (EUR + %), per-asset sparkline sharing the portfolio's math.
- **Range tabs** — 1M · 3M · 6M · YTD · 1Y · ALL. P/L figures subtract contributions that landed inside the window so fresh deposits don't inflate the gain.
- **Account filter tags** — Multi-select pills narrow every card, the chart, and the table to a subset of accounts.
- **Sensitive mode** — Blur every monetary value behind `<SensitiveValue>` with one toggle; respected in cards, tables, chart tooltips, and PDF exports.

### Accounts (`/accounts`)

- **Types** — `broker` · `crypto` · `investment` · `savings`. Only `savings` tracks a cash balance; the rest are pure position containers and buys never debit a fictional cash float.
- **Account detail** — Cash KPI (hidden for non-cash types), holdings count, total value, paginated ledger of trades + cash movements, PDF statement export.

### Assets (`/assets`)

- **Search & edit** — Name, symbol, ISIN, exchange, `providerSymbol` (Yahoo override), active toggle, ⭐ watchlist star.
- **Manual price** — Set a manual NAV for illiquid assets, stored as a `price_source='manual'` valuation.
- **Deactivate** — Soft-hide stale assets; excluded from sync and valuations.

### Watchlist (`/watchlist`) + Price Alerts

- **Star any asset or free symbol** — Track instruments you don't yet own. Quotes refresh intraday (~5 min) via a `launchd` job, gated by `WATCHLIST_SYNC_ENABLED`.
- **Price alerts** — Create above/below thresholds per symbol; fired alerts surface in a global banner (with a glow) that stays until acknowledged. Full CRUD + acknowledged-event history.

### Discover (`/discover`)

- **Weekly opportunity scan** — A Claude agent (Mondays 15:30 Madrid, or on manual trigger) uses WebSearch to surface candidate instruments, then **verifies each one against real Yahoo data** before persisting it as a `discover_candidate`. Optional Telegram summary after any run with findings.

### Data Entry (`/transactions`)

- **Manual only** — The DEGIRO/Binance/Cobas CSV importers were retired (2026-06). Trades and cash movements are entered through the `/transactions` modal: buy · sell · dividend · fee · cash movement.
- **Swaps** — `createSwap` records a matched sell+buy pair on one date with zero net cash impact, both legs EUR-valued and linked.
- **Dedup discipline** — Every inserted row carries a deterministic `rowFingerprint`; legacy `source` provenance survives on pre-2026 rows.

### Pricing

- **Yahoo Finance** (`yahoo-finance2` v3) — Quotes, historical bars, FX pairs. Quote currency is read from the response (not the asset row) so ADRs and dual-listed funds convert correctly.
- **CoinGecko** — EUR-native crypto quotes (free "demo" API key).
- **JustETF** — Fund geography by ISIN, scraped in two steps (GET + Wicket "Show more" POST) for the `/statement` region donut.
- **Precision** — Unit prices to 6 decimals so sub-euro tickers don't round to `€0.19`; market values to the cent.

### Statement (`/statement`)

- **Composition donuts** — by asset type · by **geographic region** (JustETF) · by **allocation objective** (1/3) alongside **equity sector** (2/3, Yahoo).
- **Risk** — max drawdown + annualised volatility from the 100-anchored performance index.
- **Costs** — accumulated commissions + custody fees + forward-looking TER drag.
- **Exports** — PDF (`jspdf`) · XLSX (`exceljs`) · CSV.

### Objectives (`/objectives`)

- **Allocation plan tied to assets** so the same exposure across brokers aggregates into one bucket: target % vs. current weight, drift (% and €), draggable target ring, contribution planner, per-asset assignment. Surfaced as the by-objective donut on `/statement`.

### FIRE Simulator (`/simulador`)

- **Deterministic compound-interest projection** with pesimista/base/optimista scenarios, the *snowball year*, reverse solvers (required contribution / years to target), and a 4%-rule FIRE block. Prefilled from current net worth.

### Taxes — Bizkaia foral (`/taxes/[year]`)

- **Declaración vs Previsión** — Raw FIFO lot-by-lot detail to transcribe into Rentanet (*Declaración*) alongside an estimate after the foral *coeficientes de actualización* + art. 66 + the €1.500 dividend exemption (*Previsión*).
- **FIFO lots + wash sale** — Acquisition lots store gross cost + fees separately; the *norma antiaplicación* defers disallowed losses into the acquiring lot's basis.
- **M720 / M721** — Informational-model status vs. manually-entered prior baselines, at the €50k / €20k thresholds.
- **Sealing** — Freeze a year's report as a snapshot; a drift banner flags any later divergence.
- **Exports** — `casillas` / `detail` CSV, `m720-diff` JSON/CSV, full PDF.

### AI Advisor (`/asesor`) + Telegram

- **Claude Agent SDK** chat over a live portfolio snapshot + investor profile + market digest; persistent conversation tabs, Markdown rendering, billed to the Max subscription via `CLAUDE_CODE_OAUTH_TOKEN`.
- **MyInvestor catalog (MCP)** — The official public catalog MCP gives the advisor tools to search and compare funds/portfolios and fit them into your holdings.
- **Scheduled crons** — hourly/morning market scan (09:00 → Telegram brief), weekly digest curation, weekly chat compaction; every run metered in `advisor_runs`.
- **Telegram bot** — Standalone `launchd` daemon answering `/net` (KPIs) and `/ask` (one-shot advisor), restricted to a single chat id.

### Audit Log (`/audit`)

- **Every mutation** writes an `audit_events` row: `previousJson` + `nextJson`, actor, source, context, summary. Filter by entity, action, date range; expand a row for the inline JSON diff.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   BROWSER (localhost:3200)                     │
│  Resumen · Extracto · Cuentas · Activos · Watchlist ·          │
│  Descubrir · Objetivos · Simulador · Asesor · Fiscalidad · …   │
├──────────────────────────────────────────────────────────────┤
│  Next.js 16 App Router                                         │
│   ├── Server Components  → Drizzle reads via src/server/*      │
│   ├── Client Components  → Recharts, forms, modals             │
│   ├── Server Actions     → src/actions/*  (one per mutation)   │
│   └── Route Handlers     → /api/cron · /api/exports · /health  │
├──────────────┬──────────────────────┬─────────────────────────┤
│   SQLite     │   Market data         │   AI (Claude)           │
│   Drizzle    │   ├── Yahoo Finance    │   ├── Agent SDK chat    │
│   data/      │   ├── CoinGecko        │   ├── advisor scans     │
│   *.db       │   └── JustETF          │   └── discover scans    │
├──────────────┴──────────────────────┴─────────────────────────┤
│  launchd jobs (Europe/Madrid)                                  │
│   ├── com.finances.app          → pnpm start :3200 (KeepAlive) │
│   ├── sync-prices    23:00 daily → quotes + FX + valuations    │
│   ├── sync-watchlist ~5 min      → intraday watchlist quotes   │
│   ├── advisor-scan   09:00 daily → market brief → Telegram     │
│   ├── discover-scan  Mon 15:30   → WebSearch + Yahoo verify    │
│   └── tg-bot         daemon      → /net · /ask                 │
├──────────────────────────────────────────────────────────────┤
│  External (read-only): Yahoo · CoinGecko · JustETF ·           │
│  Anthropic (Claude Agent SDK) · MyInvestor catalog MCP         │
└──────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js 22+ | Next 16 requirement |
| Framework | Next.js 16 (App Router) | RSC, Server Actions, co-located routes |
| Language | TypeScript (strict) | No `any` without a comment |
| Styling | Tailwind CSS 4 | Utility-first, theme tokens as CSS vars |
| Database | SQLite via `better-sqlite3` | Zero infrastructure, one file |
| ORM | Drizzle ORM 0.45 + drizzle-kit 0.31 | Type-safe schema, generated migrations, no raw SQL in app code |
| Validation | Zod 4 | Every Server Action validates at the boundary |
| Charts | Recharts 3 | Area / Line primitives reading theme CSS vars |
| Pricing | yahoo-finance2 3.14 · CoinGecko · JustETF | Quotes, FX, crypto, fund geography |
| AI | `@anthropic-ai/claude-agent-sdk` | Advisor chat, market scans, discover agent |
| Exports | jspdf · exceljs | PDF statement / tax report · XLSX |
| IDs | ULID | Lexicographically sortable, monotonic |
| Testing | Vitest 4 | Unit + integration (in-memory SQLite, stubbed network) |

---

## Domain Model

All tables carry `id` (ULID text PK) and `createdAt` / `updatedAt` (ms epoch). Every monetary column is EUR-normalised with the native amount + `fxRateToEur` snapshot stored alongside — never mix units in one column.

| Aggregate | Purpose |
|---|---|
| `accounts` | Broker / crypto / investment / savings; only savings carries a cash balance |
| `assets` | Instrument metadata: symbol, ISIN, `providerSymbol`, type, active flag |
| `asset_transactions` | buy · sell · dividend · fee, EUR-snapshotted with `rowFingerprint` |
| `account_cash_movements` | Deposits/withdrawals/interest/dividends/fees, signed `cashImpactEur` |
| `asset_positions` | Per-asset quantity + weighted average cost (EUR + native) |
| `asset_valuations` | Daily `(assetId, valuationDate)` market value, unit price 6dp |
| `price_history` / `fx_rates` | Raw symbol bars + `native × rateToEur = EUR` |
| `watchlist_quotes` | Intraday quotes for starred symbols |
| `price_alerts` / `alert_events` | Above/below thresholds + fired-and-acknowledged history |
| `discover_candidates` | Verified opportunities surfaced by the weekly agent |
| `tax_lots` / `tax_lot_consumptions` | FIFO acquisition lots (gross cost + fees separate) + wash-sale deferral |
| `tax_declared_baselines` | Manually-entered M720/M721 prior baselines |
| `advisor_conversations` / `advisor_runs` | Persistent chat tabs + metered AI run telemetry |
| `audit_events` | `previousJson` / `nextJson` diff for every mutation |

> Schema lives under `src/db/schema/` (one file per aggregate). Row types are inferred with `typeof table.$inferSelect` — never hand-duplicated.

---

## Routes

| Route | Page |
|---|---|
| `/` | Resumen — KPIs, evolution chart, top positions |
| `/statement` | Extracto — composition donuts, risk, costs, exports |
| `/accounts` · `/accounts/[id]` | Cuentas — list + detail with ledger |
| `/assets` | Activos — search, edit, manual price, watchlist star |
| `/watchlist` | Watchlist — tracked symbols + price alerts |
| `/discover` | Descubrir — verified weekly opportunities |
| `/objectives` | Objetivos — allocation plan + contribution planner |
| `/simulador` | Simulador FIRE |
| `/asesor` | Asesor — Claude chat over your portfolio |
| `/transactions` | Transacciones — manual entry modal |
| `/taxes` · `/taxes/[year]` | Fiscalidad foral (Bizkaia) |
| `/audit` | Auditoría — mutation event feed |
| `/settings` | Ajustes |

### Route Handlers (the only HTTP surface)

| Method | Path | Description |
|---|---|---|
| `GET`/`POST` | `/api/cron/sync-prices` | Daily quotes + FX + valuations + composition snapshots. `x-cron-secret` gated, idempotent per calendar day |
| `GET`/`POST` | `/api/cron/sync-watchlist` | Intraday watchlist quote refresh |
| `GET`/`POST` | `/api/cron/advisor-scan` · `advisor-curate` · `advisor-chat-compact` | AI market scan / digest / chat compaction |
| `GET`/`POST` | `/api/cron/discover-scan` | Weekly opportunity discovery |
| `GET` | `/api/exports/*` | PDF account statement / tax report |
| `GET` | `/health` | Liveness probe → `200 { ok: true }` |

All mutations live in Server Actions (`src/actions/*`) returning `{ ok: true, data } | { ok: false, error }` — never throwing across the boundary for expected failures. Zod schemas sit in sibling `*.schema.ts` files (Next 16's `"use server"` forbids non-async exports).

---

## Cron & Background Jobs

Numo App runs under `launchd` (macOS). Plists live in `scripts/launchd/`, wrappers in `scripts/`:

| Job | Cadence | Wrapper |
|---|---|---|
| `com.finances.app` | KeepAlive (port 3200) | supervises `pnpm start` |
| Price sync | 23:00 daily (crypto trades weekends) | `scripts/cron-sync-prices.sh` |
| Watchlist sync | ~5 min | `scripts/cron-watchlist-sync.sh` |
| Discover scan | Mon 15:30 Madrid | `scripts/cron-discover-scan.sh` |
| Telegram bot | daemon | `pnpm tg:bot` |

The app is supervised — restart with `launchctl kickstart`, don't kill/build manually while it serves.

---

## Setup

### Prerequisites

- **Node.js 22+** (Next 16 requirement) and **pnpm**.
- A **CoinGecko** demo API key (free) if you hold crypto.
- A long-lived **Claude Code OAuth token** (`claude setup-token`) to enable the advisor + discover agents.
- A **Telegram** bot token + chat id for the morning brief and `/net` · `/ask` (optional).

### Install

```bash
git clone git@github.com:Nyhz/numo-app.git
cd numo-app
pnpm install
```

### Configure

Copy the template and fill it in:

```bash
cp .env.local.example .env.local
```

Key variables (see `.env.local.example` for the full annotated list):

```bash
DATABASE_URL=data/finances.db        # SQLite path
CRON_SECRET=change-me                # gates the sync + watchlist cron routes
COINGECKO_API_KEY=                    # free demo tier — enables crypto sync
NEXT_PUBLIC_APP_NAME="Numo App"      # top-nav brand
PORT=3200

CLAUDE_CODE_OAUTH_TOKEN=             # routes AI billing to your Max subscription
ADVISOR_ENABLED=true
DISCOVER_ENABLED=true
WATCHLIST_SYNC_ENABLED=true

TELEGRAM_BOT_TOKEN=                  # optional — morning brief + /net · /ask
TELEGRAM_CHAT_ID=
```

> ⚠️ Do **not** set `ANTHROPIC_API_KEY` alongside `CLAUDE_CODE_OAUTH_TOKEN` — the API key wins precedence and would bypass your subscription credit.

### Database

```bash
pnpm db:migrate     # apply migrations — creates data/finances.db on first run
pnpm db:seed        # optional dev fixtures
```

### Launch

```bash
pnpm dev            # Next.js dev on :3200
pnpm build          # production build
pnpm start          # production server on :3200
```

Open [http://localhost:3200](http://localhost:3200). Create an account, register your trades in `/transactions`, star a few tickers in `/assets`, then install the `launchd` jobs from `scripts/launchd/`.

---

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js on port 3200 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint + migration sanity check |
| `pnpm test` | Vitest (network stubbed) |
| `pnpm db:generate` | Drizzle → SQL migration after a schema change |
| `pnpm db:migrate` / `db:seed` / `db:backup` | DB lifecycle |
| `pnpm sync:prices` | Local trigger of the price-sync route |
| `pnpm advisor:scan` / `advisor:curate` / `advisor:chat-compact` | Trigger AI crons locally |
| `pnpm tg:net` / `tg:ask` / `tg:bot` | Telegram snapshot / one-shot advisor / bot daemon |

---

## Design Rules

The full engineering contract lives in **[CLAUDE.md](CLAUDE.md)** (rules of engagement) and **[SPEC.md](SPEC.md)** (stack, entities, routes, behaviour). The essentials:

- **EUR is base.** Every monetary column stores EUR + the native amount + `fxRateToEur` snapshot. FX resolution always goes through `src/lib/fx.ts`.
- **Range-aware P/L.** Every P/L figure subtracts contributions made *inside* the selected window; the portfolio index is `value / cumulative_invested × 100` (baseline 100).
- **Sensitive mode is sacred.** Every monetary value renders inside `<SensitiveValue>` — KPIs, cells, tooltips, PDFs.
- **One source of truth per aggregate.** Reads in `src/server/*`, mutations in `src/actions/*`. Position + cash recompute is part of the same transaction as the trade.
- **Server Actions** validate with Zod, run in a transaction when they touch >1 table, write an `audit_events` row, and `revalidatePath()` every affected route.
- **No raw SQL in app code** (Drizzle only) · **ULID for all ids** · **never edit a shipped migration** — generate a new one.
- **UI primitives only** — `Button`, `Modal`/`ConfirmModal`, `DataTable`, `StatesBlock`. Destructive actions require `ConfirmModal`. Charts read colours from CSS vars. Dark **and** light verified before done.
- **Market data only through `src/lib/pricing/`** — never call Yahoo/CoinGecko/JustETF from a component or action.

---

## Philosophy

**One user. One machine. One currency.** Numo App is not a multi-tenant SaaS. It runs on your laptop, stores everything in a single SQLite file, and answers to exactly one person — you. No sharing, no accounts, no multi-base-currency gymnastics. EUR is base; native is snapshotted.

**Precision beats prettiness.** Unit prices at 6 decimals, quantities at 10, market values at 2. Sub-euro tickers are first-class citizens.

**Local-first, boring infrastructure.** SQLite file. `launchd` jobs. Server Actions + inline cron routes are the entire backend. No Redis, no queues, no Docker, no separate worker. If it can't survive a laptop reboot, it doesn't belong here.

**Spanish by default.** Madrid timezone, Spanish number formatting (`35.188,14 €`), foral Bizkaia tax rules, Spanish-language UI throughout. Tu dinero habla tu idioma.

---

<p align="center">
  <sub><b>Numo App</b> · patrimonio, en claro</sub><br>
  <sub>Europe/Madrid · EUR · Local-first · One user, one portfolio.</sub>
</p>
