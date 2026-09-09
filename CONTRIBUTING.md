# Contributing to TREK

This is **[iceafish/TREK](https://github.com/iceafish/TREK)** — an independently
maintained fork of [liketrek/TREK](https://github.com/liketrek/TREK). Development
happens directly in this repository, for this fork's own goals (currently a
China-mainland localization — see [`docs/amap/`](docs/amap/README.md)); nothing
is sent back upstream, and upstream's contribution process (Discord pitch,
issue-first PRs, wiki pages) does not apply here.

## How this repository is run

- **`dev` is the integration branch.** Feature branches come off `dev` and merge
  back into `dev`; `main` tracks released state.
- **Conventional commits** (`fix(maps): ...`, `feat(budget): ...`). No
  `Co-Authored-By` or other tool-attribution trailers.
- **One focused change per commit.** No unrelated reformatting or drive-by
  refactors. Never `git add -A` — stage only the files the change actually needs.
- **Breaking changes are a product decision, not a prohibition.** As an
  independent fork this repo may diverge from upstream behaviour on purpose (the
  AMap work does exactly that). What is forbidden is breaking something *by
  accident*: state the intent in the commit message and cover it with tests.

## Quality gates — hold them, never lower them

- **Tests are required.** The `server/src/nest/**` vitest coverage gate enforces
  **≥ 80%**.
- **Contracts live in `shared/`.** A route is done only once its Zod schema lives
  in `shared/src/<domain>/` and both server and client import the inferred types.
- **i18n parity.** Every translation key lands in every locale under
  `shared/src/i18n/<locale>/`; `pnpm --filter @trek/shared run i18n:parity:strict`
  is the CI gate.
- **Client invariants.** The Page pattern (`pnpm run lint:pages`) and the
  appearance-token rule (`pnpm run theme:lint`) hold for all UI work.
- No new `any`, no new `eslint-disable`, no downgraded lint severity.

## Development environment

[`AGENTS.md`](AGENTS.md) is the monorepo entry point (architecture, commands,
per-package `CLAUDE.md` pointers). In short:

```bash
pnpm install
pnpm run dev        # builds shared, then watches server (:3001) + client (:5173)
pnpm run test       # all workspaces
pnpm run lint
```

## Pull requests

The normal flow is local feature branches merged into `dev`. External pull
requests are welcome under the same rules: target `dev`, not `main`; keep one
focused change per PR; include the tests and locale updates your change needs.
CI (`test.yml`, `lint-prettier.yml`) runs on every push and enforces the gates
above.
