# CLAUDE.md — Rules of Engagement

> How to work in this battlefield. The product — stack, routes, entities, behaviour, directory layout, env vars — lives in SPEC.md. This file is rules, scripts, and discipline only. When in doubt, see SPEC.

Address the user as **Commander**. Patrimonio (the Finances Panel) is EUR-first, single-user, LAN-only. No auth, no Docker, no Bun, no monorepo tooling. pnpm + Node 22+ (Next 16 requirement).

---

## Scripts

```
pnpm dev              # next dev
pnpm build            # next build
pnpm start            # next start
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint (config from create-next-app)
pnpm test             # vitest
pnpm db:generate      # drizzle-kit generate
pnpm db:migrate       # apply migrations
pnpm db:seed          # optional seed data for dev
pnpm sync:prices      # local trigger of the Yahoo sync route
```

**Scaffolding discipline.** The baseline project is created with `pnpm create next-app@latest` — see SPEC §0 for the exact invocation. Never hand-write `package.json`, `tsconfig.json`, or `next.config.*`. Accept the versions the generator ships with for Next, React, React-DOM, Tailwind, and ESLint; only pin a version if a peer-dep break forces it, and write the reason in the commit. **If `pnpm install` fails twice in a row, stop and debrief — do not thrash through version permutations.**

For everything outside the generator's footprint (`better-sqlite3`, `drizzle-orm`, `zod`, etc.), use the latest stable release at install time and let pnpm resolve peer deps.

---

## Coding Rules

- **TypeScript strict**. No `any` without a one-line comment explaining why.
- Prefer `type` over `interface` for data shapes. Infer Drizzle row types from schema (`typeof table.$inferSelect`) — never hand-duplicate.
- **One source of truth per aggregate.** Read helpers in `src/server/`, mutations in `src/actions/`. `src/server/` also hosts the tx-scoped derived-state recompute engine (`recompute.ts`, `rebuild.ts`, `valuations.ts`, `tax/lots.ts`) — write functions, but only callable inside an action's transaction. See SPEC §7.
- **No raw SQL in app code.** Drizzle query builder only. Schema migrations are the one exception and live under `drizzle/`.
- **Never edit past migrations.** Generate a new one.
- **ULID for all new ids.** Never autoincrement.
- **Money is EUR.** Every monetary column stores EUR plus the native amount + `fxRateToEur` snapshot. Never mix units in the same column. FX resolution goes through `src/lib/fx.ts`, never ad-hoc. See SPEC §6.
- File conventions: one component per file, PascalCase filename matches export. Route handlers use named exports (`GET`, `POST`, …) — no default export. Keep generic primitives in `src/components/ui/`, feature components in `src/components/features/<feature>/`.
- No `<style>` blocks, no CSS modules. Tailwind utilities + the theme tokens defined in SPEC §2. Theme and sensitive-mode state live on `<html>` data attributes — do not re-implement per component.

---

## Data-Access Discipline

All mutations go through a Server Action in `src/actions/*.ts`. Every Server Action must:

1. **Validate input with Zod** at the entry point. Reject before touching the DB.
2. Run inside `db.transaction()` when it touches more than one table.
3. Write an `audit_events` row describing the change (`previousJson` / `nextJson`, actor, source).
4. Call `revalidatePath()` for every route that reads the affected data.
5. Return a discriminated result (`{ ok: true, data } | { ok: false, error }`) — never throw across the action boundary for expected failures.

Read paths go through `src/server/*.ts`. Server Components import these directly — no HTTP fetch, no SWR, no client-side data layer. Cursor pagination uses `src/lib/pagination.ts` helpers.

Position and cash-balance recomputation is part of the transaction that inserts or deletes a trade. Do not let `asset_positions` or `account.currentCashBalanceEur` drift out of sync with the source rows.

---

## UI Discipline

- **Every monetary value renders inside `<SensitiveValue>`.** No exceptions — KPIs, table cells, chart tooltips, PDF exports. The sensitive-mode toggle is meaningless if one component forgets.
- **Use the primitives.** Buttons go through `Button`; modals go through `Modal` / `ConfirmModal`; tables go through `DataTable`. If you reach for a raw `<button>` or `<dialog>`, stop and extend the primitive instead. Inventory in SPEC §2.
- **Loading states are skeletons, not spinners.** Use `StatesBlock` for empty / error / loading.
- **Charts track the theme via CSS variables.** Never hardcode colours in Recharts props.
- **Destructive actions require `ConfirmModal`.** Delete account, delete transaction, deactivate asset.
- Dark and light mode must both be verified before calling a UI task done.

---

## Data Entry and Pricing

The CSV importer subsystem was removed (2026-06; manual entry is the only registration path). Dedup discipline survives it: every inserted `asset_transactions` / `account_cash_movements` row carries a `rowFingerprint` (see SPEC §5.4). Do not insert a row without one.

The market-data clients (Yahoo, CoinGecko, and JustETF for geographic composition) are wrapped under `src/lib/pricing/`. Tests must stub them — no real network calls in the test suite. The cron route (`src/app/api/cron/sync-prices/route.ts`) is gated by `CRON_SECRET` and must be idempotent within a calendar day; besides prices it refreshes the sector (7-day) and geography (30-day) composition snapshots. See SPEC §6.

---

## Don't Do

- Don't add auth, sessions, or user accounts. Single-user LAN app by design. See SPEC §11.
- Don't introduce a new base currency or multi-currency base logic. EUR is fixed.
- Don't spin up a separate API service or worker process. Server Actions + the inline cron route are the entire backend.
- Don't add Docker, Bun, workspace packages, or monorepo tooling.
- Don't install a global state library (Zustand, Redux, Jotai). If you think you need one, you're probably fighting the Server Component model — reconsider.
- Don't call a market-data provider (Yahoo, CoinGecko, JustETF) directly from a component or action. Go through `src/lib/pricing/`.
- Don't render money without `<SensitiveValue>`.
- Don't amend or rewrite shipped migrations.
- Don't commit the SQLite file or anything under `data/`.

---

## Definition of Done

Before reporting a mission complete:

- [ ] `pnpm typecheck` passes with zero errors.
- [ ] `pnpm lint` passes.
- [ ] `pnpm test` passes; new logic has a unit test where it fits the surface listed in SPEC §10.
- [ ] `pnpm build` succeeds.
- [ ] New DB columns have a generated migration under `drizzle/`.
- [ ] New env vars are added to `.env.local.example` and referenced in SPEC §9.
- [ ] Touched UI was verified in both dark and light mode.
- [ ] Mutations write an audit event and call `revalidatePath`.
- [ ] Every new monetary render goes through `<SensitiveValue>`.
- [ ] Fresh-DB smoke: launching against an empty database shows empty states without errors (acceptance criterion SPEC §12.6).

---

## Cross-References

- Stack, routes, entities, feature behaviour, directory layout, env vars → **SPEC.md**.
- Pricing sync behaviour and FX precedence → **SPEC §6**.
- Data layer structure (`src/server/`, `src/actions/`, `src/db/schema/`) → **SPEC §7**.
- Acceptance criteria for v1 → **SPEC §12**.
