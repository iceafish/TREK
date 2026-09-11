# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What OhMyTrek is

**This repository (`iceafish/ohmytrek`, project name **OhMyTrek**) is an independent project —
it began as a fork of liketrek/TREK and now iterates under its own name** — see
[Repository status](#repository-status) before following any contribution
process you find in this repo. The rename is documentation-level for now:
`@trek/*` package names, `TREK_*` env vars and other in-code identifiers still
carry the old name and are not renamed casually.

A self-hosted, real-time collaborative travel planner. pnpm-workspaces monorepo (pinned via `packageManager: pnpm@10.34.5` in the root package.json) with three workspaces:

- **`shared/`** (`@trek/shared`) — Zod schemas that are the **single source of truth** for API contracts, consumed by both server and client. Also owns all i18n locale files. Must be built before server/client typecheck or run.
- **`server/`** (`@trek/server`) — NestJS API (Express adapter), SQLite via `better-sqlite3`, WebSocket sync, built-in MCP server (decorator-driven registration layer in `server/src/nest-mcp/`, formerly the `@trek/nest-mcp` workspace), sandboxed plugin runtime.
- **`client/`** (`@trek/client`) — React 19 + Vite + Zustand + Tailwind PWA, offline-first via Dexie/IndexedDB.

**`plugin-sdk/`** (`trek-plugin-sdk`) also lives in the repo but is **not a root workspace member** — it is its own standalone pnpm workspace root with its own lockfile, is published to npm independently, and must ship standalone. Run its commands from `plugin-sdk/`, not the root.

Each package has its own `CLAUDE.md` with internals; this file covers the monorepo picture.

## Commands

Run from the repo root unless noted. **Use `pnpm --filter @trek/<pkg> run <script>` to target one workspace** (or `cd` into the package and run `pnpm run <script>`).

```bash
pnpm run dev                      # build shared, then watch shared + server + client concurrently
pnpm run build                    # build shared → server → client (order matters)
pnpm run lint                     # lint all three workspaces
pnpm run format                   # prettier --write all three
```

Tests:

```bash
pnpm run test                                      # all workspaces
pnpm --filter @trek/server run test                # vitest run (server)
pnpm --filter @trek/server run test:unit           # tests/unit only
pnpm --filter @trek/server run test:integration
pnpm --filter @trek/server run test:ws             # websocket tests
pnpm run test:e2e                                  # server e2e (boots Nest against temp SQLite)
pnpm run test:cov                                  # coverage (lcov), all four packages incl. shared + plugin-sdk
cd client && pnpm run test                         # client vitest run
cd client && pnpm run e2e                          # Playwright
cd client && pnpm run lint:pages                   # enforce the Page pattern (see below)
cd client && pnpm run theme:lint                   # flag styling that bypasses appearance tokens (--strict in CI mindset)
pnpm --filter @trek/server run typecheck           # tsc --noEmit (also client/shared)
```

Run a single test file or test:

```bash
pnpm exec vitest run tests/unit/nest/weather.controller.test.ts   # (from server/ or client/)
pnpm exec vitest run -t "name of the test"                        # by test-name pattern
```

i18n parity (enforced in CI — every non-`en` locale must have identical file set + top-level keys):

```bash
pnpm --filter @trek/shared run i18n:parity         # audit (exit 0)
pnpm --filter @trek/shared run i18n:parity:strict  # CI gate (exit 1 on drift)
```

Dev ports: server listens on **3001**, Vite dev server proxies `/api`, `/ws`, `/uploads`, `/oauth`, etc. to `http://localhost:3001` (see `client/vite.config.js`).

## Server architecture

Nest owns everything: the strangler migration **completed 2026-08-10**, and the last seam — the pre-`app.init()` MCP/OAuth mount — moved behind the container 2026-08-11: **zero `*.bridge.ts` files remain**. Legacy `src/services/` is deleted (ESLint errors on any import of it) and all business logic lives in DI modules under `server/src/nest/<domain>/`. `server/src/nest/README.md` is the module blueprint. Every cron is Nest-owned (`server/src/nest/scheduling/`, `@nestjs/schedule`).

- **`bootstrap.ts` — `buildApp()`** is the single shared builder used by both production (`index.ts`) and the integration/e2e test harness. **Composition order is load-bearing**: global middleware → platform uploads → the discovery metadata middleware → static assets → the named body-parser wrappers are all registered on the raw Express instance **before `app.init()`**, because Nest's router throws `NotFoundException` on unmatched routes and won't fall through to anything registered after init. The transport surface (`/api/health`, `/mcp`, `/.well-known/*` documents, `/oauth/*`) is Nest controllers/middleware. The SPA `index.html` fallback and the global error envelope are `APP_FILTER`s (`SpaFallbackFilter`, `TrekExceptionFilter`).
- **`/mcp` bodies are raw by design** — bootstrap's parser wrappers exempt `/mcp` so the MCP SDK reads the untouched stream; never `@Body()` a `/mcp` route.
- **Per-domain module shape** (one folder under `server/src/nest/<domain>/`): `<domain>.controller.ts` + `<domain>.service.ts` + `<domain>.module.ts`, registered in `app.module.ts`. **`weather/` is the reference implementation** — copy its shape. The Zod contract for the domain lives in `shared/src/<domain>/<domain>.schema.ts`.
- **Auth is default-deny**: `GlobalAuthGuard` + `MfaPolicyGuard` run as `APP_GUARD`s; public routes opt out with `@Public()`, and a boot-time ratchet (`validate-route-guards.ts`) refuses unknown public routes. New domain logic goes in the module's `.service.ts` — never resurrect a `services/*`-style plain module.
- **Trip-scoped routes** must verify trip access (404 on no access) and the relevant permission (403) — the standard shape is `@UseGuards(JwtAuthGuard, TripAccessGuard)` + `@RequirePermission('<action>')` per handler (a few domains still check inline; see `roadmap.md`) — and forward `X-Socket-Id` to the WebSocket broadcast so the originating client doesn't echo its own change. Never gate a multipart upload with a guard (ECONNRESET instead of 403 — check in the handler).
- **DB** (`server/src/db/`): `better-sqlite3`, WAL mode, FK on. `database.ts` initializes; `schema.ts` creates tables; `migrations.ts` + `seeds.ts` run on boot. In `NODE_ENV=test` each vitest worker gets an isolated `:memory:` DB; the Playwright harness uses `TREK_DB_FILE` for a throwaway file DB.
- **WebSocket** (`server/src/websocket.ts`): JWT-authed, room-per-trip (`tripId → Set<WebSocket>`), heartbeat keep-alive, per-connection rate limiting, served on `/ws`.
- **MCP** (`server/src/mcp/`): OAuth 2.1-authenticated MCP server exposing OhMyTrek to AI assistants (150+ tools in `tools/`, resources, scopes, session manager). See `MCP.md`.
- **Addons** are admin-toggleable feature modules keyed by `ADDON_IDS` in `server/src/addons.ts` (mcp, packing, budget, documents, vacay, atlas, collab, journey, airtrail, llm_parsing, collections).
- **Plugins** (`server/src/nest/plugins/`): sandboxed third-party plugin runtime — one forked child process per plugin (`supervisor/`), permission-gated RPC (`host/rpc-host.ts` registers a handler only if the plugin holds the unlocking permission), install-time manifest/signature/egress checks (`install/`, `runtime/egress-policy.ts`). Author tooling lives in `plugin-sdk/`; the `trek-plugin-dev` skill covers plugin authoring.

## Client architecture

Offline-first, with a layered data flow. A Page never owns state directly:

- **Page pattern** (enforced by `lint:pages`, see `client/src/pages/PATTERN.md`): a `*Page.tsx` default export is a **wiring container** — it composes a co-located `use<Page>()` hook into JSX and must **not** call `useState/useReducer/useEffect/useLayoutEffect/useMemo/useCallback/useRef` in its own body. Stateful logic lives in the hook.
- **State**: Zustand stores in `client/src/store/`. The big one is `tripStore.ts`, assembled from **slices** in `store/slices/` (places, packing, todo, budget, reservations, files, …). `slices/remoteEventHandler.ts` applies incoming WebSocket events to local state.
- **Data flow (offline-first)**: `store → repo (client/src/repo/) → api (client/src/api/) | Dexie (client/src/db/offlineDb.ts)`. Repos check `navigator.onLine`: online they hit the REST API and upsert into Dexie; offline they read from Dexie. Writes go through `sync/mutationQueue.ts` — optimistic Dexie write, then on reconnect `flush()` replays REST with an `X-Idempotency-Key` header so retried writes don't double-apply. `sync/tripSyncManager.ts` and `sync/syncTriggers.ts` drive reconnection sync; `sync/tilePrefetcher.ts` caches map tiles.
- **Styling**: use the appearance tokens (`var(--token)` inline or `bg-[var(--...)]` Tailwind classes), never hardcoded color literals or numeric `fontSize` — `theme:lint` flags bypasses so user-chosen scheme/transparency/text-size keep working. Suppress intentional exceptions (map/PDF/brand colors) with a `theme-lint-disable` line comment.
- **PWA**: `vite-plugin-pwa` + Workbox caches tiles/API/uploads. `prebuild` generates icons.

## Shared contracts & i18n

- A route is "done" only once its contract lives in `shared/` and both sides import the inferred types. Edit the Zod schema in `shared/src/<domain>/`, rebuild shared, then both server (validation + DTO types) and client (typed requests) pick it up.
- **i18n locale files live in `shared/src/i18n/<locale>/`**, one file per domain. `en/` is canonical. When you add/change a translation key, **add it to every locale** or `i18n:parity:strict` fails CI. The client resolves keys via `client/src/i18n/TranslationContext.tsx` (`t(key)`), which only reads top-level string keys.

## Project direction

These principles come out of a verified 2026 full-repo audit and shape how all new code should be written:

- **Protect the crown jewels.** The client's offline-first data core (repos + mutation queue + Dexie), the out-of-process plugin sandbox, the Zod contract layer, and the auth primitives are production-grade. Extend them; never route around them or rewrite them in anger.
- **No "modern shell over legacy core."** The debt pattern is a modern frame delegating to the old approach underneath (historically Nest controllers over legacy `services/*` — that migration is done; on the client it's the long tail of feature components calling the raw API past the offline core). New code goes all-in on the target architecture; when touching a legacy seam, migrate it rather than adding another wrapper.
- **Single source of truth over manual synchronization.** Never add a hand-mirrored copy of state, schema, or contract (server↔Dexie↔Zustand, schema↔SQL, the plugin contract). Derive from one source, or guard the copy with a parity test that cannot silently skip.
- **DI over global mutable module state.** The `db` proxy, `ws` singleton, and event-sink globals are what force `require()`-to-dodge-cycles and load-bearing boot ordering. New server code injects its dependencies; new client code avoids `window`-global buses and mutable module state.
- **Use the runtime's native idioms.** Prefer React 19 features (`useOptimistic`, Actions, `use()`/Suspense) and Nest subsystems (DI providers, pipes, guards, `@nestjs/schedule`) over hand-rolled equivalents of the same machinery.
- **Fail closed, gates stay on.** Security switches default to safe; misconfiguration must refuse, not silently degrade. Never lower a quality gate (strict TS, lint severity, coverage, parity checks) to land a change — no new `any`, no new `eslint-disable`, no downgrading rules to `warn`.

## Repository status

**This is an independent project — OhMyTrek, renamed from the TREK fork — and it does not
contribute back.** There is no
`upstream` remote and no plan to open pull requests against the original project. The goal is to
iterate on this codebase for its own needs — currently a China-mainland localization
(`docs/amap/` holds the in-progress AMap integration). GitHub-facing docs (README,
CONTRIBUTING, issue/PR templates) use the OhMyTrek name; in-code identifiers
(`@trek/*`, `TREK_*`) keep the old name until a deliberate rename.

`CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md` and the issue templates
**describe this fork's own process** — they are maintained here and no longer
carry upstream's rules (no Discord pitch, no linked-issue requirement, no
upstream wiki links). Upstream's community-management automations
(close-stale-*/close-untitled-issues workflows, `FUNDING.yml`) were removed;
`enforce-target-branch.yml` runs on this repository and enforces the `dev`
target below. The engineering standards are this repository's own.

## Conventions

- **`dev` is the integration branch.** Feature branches come off `dev` and merge back into
  `dev`; `main` tracks released state.
- **Conventional commits** (`fix(maps): ...`, `feat(budget): ...`). Do not add `Co-Authored-By`
  or other tool-attribution trailers.
- **One focused change per commit**; no unrelated reformatting or drive-by refactors. **Never
  `git add -A`** — the working tree may hold unrelated in-progress work, and sweeping it into an
  unrelated commit makes the history impossible to review or roll back. Stage only the files the
  change actually needs.
- **Tests are required.** The `src/nest/**` vitest coverage gate enforces **≥80%**; hold the gate
  rather than lowering it.
- **Breaking changes are a product decision, not a prohibition.** As an independent fork this
  repo may diverge from upstream behaviour on purpose — the AMap work does exactly that. What is
  forbidden is breaking something *by accident*: state the intent in the commit message and cover
  it with tests.
- When refactoring an existing route, **parity is law**: same URL, method, query/body, HTTP
  status, `Set-Cookie`, and JSON body — including bespoke error strings (e.g. reproduce
  `{ error: 'Admin only' }` exactly rather than relying on a generic guard message). Note Nest
  defaults POST to 201; add `@HttpCode(200)` where the legacy contract returned 200. Declare
  static sub-routes (`/reorder`, `/in-app/all`) **before** `:id` param routes. This governs
  refactors; a *deliberate* contract change is the bullet above.

## Reference docs

- `MCP.md` — MCP server/tools/scopes. `README.md` — deployment, env vars, reverse-proxy setup. `server/src/nest/README.md` — per-module blueprint and test layout (unit / parity / e2e).
- `docs/amap/` — the AMap (高德地图) integration: work packages, shared constraints, and the
  verified coordinate baseline. Start at `docs/amap/README.md`; every package brief requires
  `docs/amap/00-constraints.md` first.
