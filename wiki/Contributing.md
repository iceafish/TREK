# Contributing

This repository ([iceafish/TREK](https://github.com/iceafish/TREK)) is an
independently maintained fork — development happens directly here, for this
fork's own goals (currently a China-mainland localization). See
[CONTRIBUTING.md](https://github.com/iceafish/TREK/blob/dev/CONTRIBUTING.md)
for the full process; the short version:

## How this repository is run

- **`dev` is the integration branch.** Feature branches come off `dev` and merge
  back into `dev`; `main` tracks released state.
- **Conventional commits** (`fix(maps): ...`, `feat(budget): ...`), one focused
  change per commit.
- **Breaking changes are allowed on purpose** — this fork may diverge from
  upstream behaviour deliberately. State the intent in the commit message and
  cover it with tests.
- **Tests are required.** The server coverage gate is ≥ 80% and is never lowered.

## Code Quality

- Write clean, readable code that matches the existing style
- No unnecessary abstractions or over-engineering
- Don't add comments unless the logic isn't self-evident
- Don't add error handling for scenarios that can't happen

## Contracts & i18n

- API contracts live as Zod schemas in `shared/src/<domain>/`; both server and
  client import the inferred types. A route is done only once its contract is there.
- Every translation key must exist in all 23 locales — the `i18n Key Parity` CI
  job fails on drift, so run `pnpm --filter @trek/shared run i18n:parity:strict`
  before pushing. Two directory names differ from the language they hold:
  Brazilian Portuguese is `br`, Greek is `gr`.

## Development Setup

See the [[Development Environment|Development-environment]] page for the full
setup guide and available scripts.

## Tech Stack

| Layer | Technology                                                                                |
|---|-------------------------------------------------------------------------------------------|
| Frontend | React 19, TypeScript, Zustand 5, Leaflet, Tailwind CSS 3.4, Vite 8 (Rolldown)             |
| Backend | NestJS 11 (Express 4 adapter), TypeScript, better-sqlite3, Zod (@trek/shared)             |
| Real-time | WebSocket (ws)                                                                            |
| Database | SQLite with WAL mode                                                                      |
| Auth | JWT (HS256), bcrypt, TOTP MFA, OIDC                                                       |
| Maps | AMap (高德) for China-mainland usage, plus Leaflet + react-leaflet (OpenFreeMap vector basemap via maplibre-gl-leaflet), MapLibre GL, Mapbox GL |
| i18n | 23 languages, EN canonical (locale directories live in shared/src/i18n/)                  |
