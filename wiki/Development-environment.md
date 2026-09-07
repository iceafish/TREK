# Developer Setup Guide

> Before anything else, please read the [[Contributing]] guidelines.

## Prerequisites

- Node.js 22+
- pnpm 10 (enable with `corepack enable` — the repo pins the exact version via `packageManager`)
- Git
- A GitHub account

---

## 1. Fork & Clone the Repository

Go to the [TREK repository](https://github.com/liketrek/TREK) and click **Fork** to create your own copy.

Then clone your fork locally:

```bash
# Clone your fork, checking out the dev branch
git clone -b dev git@github.com:your-username/TREK.git
cd TREK
```

---

## 2. Configure Git Remotes

Add the original repository as `upstream` so you can pull in future updates:

```bash
git remote add upstream git@github.com:liketrek/TREK.git
```

You should now have two remotes:

| Remote     | URL                                          | Purpose                        |
|------------|----------------------------------------------|--------------------------------|
| `origin`   | `git@github.com:your-username/TREK.git`      | Your fork — push changes here  |
| `upstream` | `git@github.com:liketrek/TREK.git`         | Main repo — pull updates from here |

---

## 3. Keep Your Fork Up to Date

Before starting any work, make sure your local `dev` branch is in sync with upstream:

```bash
git fetch upstream
git rebase upstream/dev  # or: git merge upstream/dev
```

---

## 4. Create a Feature Branch

Working on a dedicated branch keeps your changes isolated and makes PRs easier to review:

```bash
# Create a new branch off of dev
git checkout -b fix/my-changes origin/dev
```

Branch naming conventions:
- `feat/short-description` for new features
- `fix/short-description` for bug fixes
- `chore/short-description` for maintenance tasks

---

## 5. Install Dependencies

The repo is a pnpm workspace monorepo with three workspaces — `shared`, `server`, and `client`. One command at the root installs all three:

```bash
pnpm install
```

`plugin-sdk/` is **not** a root workspace: it is its own standalone workspace root with its own lockfile and is published to npm independently, so a root install never touches it. If you are working on the SDK, install and run its commands from that directory:

```bash
cd plugin-sdk && pnpm install
```

---

## 6. Optional: KItinerary (Booking Import)

The booking-confirmation import feature uses [KDE KItinerary](https://apps.kde.org/itinerary/) to parse travel documents. The server works without it, but the import endpoint will be non-functional.

### Linux

```bash
sudo apt-get install -y libkitinerary-bin
```

### Environment variables

Add these to your local `.env` (or export them before starting the server):

```bash
# Prevent Qt from probing for a display in headless/server environments
QT_QPA_PLATFORM=offscreen

# KDE cache directory (avoids writing to $HOME)
XDG_CACHE_HOME=/tmp/kf6-cache

# Optional: only needed when the binary is not found on its own
# KITINERARY_EXTRACTOR_PATH=/usr/lib/x86_64-linux-gnu/libexec/kf6/kitinerary-extractor
```

`KITINERARY_EXTRACTOR_PATH` is optional. Left unset, the server looks for the Debian/Ubuntu location `/usr/lib/<triplet>/libexec/kf6/kitinerary-extractor` and then for `kitinerary-extractor` on `PATH` — one of which is what `libkitinerary-bin` gives you. Set it only if the binary ended up somewhere neither lookup reaches, and make sure the path exists: a value that does not resolve logs a warning and stops the lookup instead of falling back, which turns the import feature off. The Docker image sets it to `/usr/local/bin/kitinerary-extractor`, a symlink created at image build; that path does not exist on a plain apt install.

---

## 7. Available Scripts

### Root (`/`)

These commands run across all workspaces at once and are the recommended way to work:

| Command              | Description                                                         |
|----------------------|---------------------------------------------------------------------|
| `pnpm run dev`        | Build shared, then start shared (watch), server, and client together via `concurrently` |
| `pnpm run build`      | Build shared → server → client in order                            |
| `pnpm test`           | Run tests in shared, server, and client                            |
| `pnpm run test:cov`   | Run coverage for shared, server, client and plugin-sdk             |
| `pnpm run test:e2e`   | Run end-to-end tests (server)                                      |
| `pnpm run lint`       | Lint shared, server, and client                                    |
| `pnpm run format`     | Format shared, server, and client                                  |
| `pnpm run format:check` | Check formatting across all workspaces                           |

### Shared (`/shared`)

The `@trek/shared` package is the single source of truth for code shared between the client and server. It holds the **Zod schemas that define the API contracts** (request/response shapes, common primitives, pagination) and the **i18n translation layer** (per-language keys and types). Both workspaces import from it, so schema and translation changes propagate to both sides from one place.

> **Tip:** run `pnpm run i18n:parity` (or `i18n:parity:strict`) in this package to verify every locale exposes the same translation keys — the CI parity gate runs the strict variant.

| Command                     | Description                          |
|-----------------------------|--------------------------------------|
| `pnpm run build`             | Compile shared package (tsdown)      |
| `pnpm run build:watch`       | Compile in watch mode                |
| `pnpm test`                  | Run tests                            |
| `pnpm run test:watch`        | Run tests in watch mode              |
| `pnpm run typecheck`         | Type-check without emitting          |
| `pnpm run i18n:parity`       | Check locale key parity              |
| `pnpm run i18n:parity:strict`| Strict locale key parity (CI gate)   |
| `pnpm run lint`              | Lint source                          |
| `pnpm run format`            | Format source                        |
| `pnpm run format:check`   | Check formatting                  |

### Server (`/server`)

> **Tip:** `tests/` sits outside the build `tsconfig.json`, so `pnpm run typecheck` skips it — `pnpm run typecheck:tests` is the only step that catches a broken test call site. CI runs both.

| Command                      | Description                              |
|------------------------------|------------------------------------------|
| `pnpm start`                  | Start the server (production)            |
| `pnpm run dev`                | Start the server in watch mode           |
| `pnpm run build`              | Compile server                           |
| `pnpm run typecheck`          | Type-check without emitting              |
| `pnpm run typecheck:tests`    | Type-check `tests/` too (CI gate)        |
| `pnpm test`                   | Run all tests                            |
| `pnpm run test:unit`          | Run unit tests only                      |
| `pnpm run test:integration`   | Run integration tests                    |
| `pnpm run test:ws`            | Run WebSocket tests                      |
| `pnpm run test:e2e`           | Run end-to-end tests                     |
| `pnpm run test:watch`         | Run tests in watch mode                  |
| `pnpm run test:coverage`      | Run tests with coverage report           |
| `pnpm run lint`               | Lint source                              |
| `pnpm run lint:check`         | Lint everything, no `--fix` (CI gate)    |
| `pnpm run check:plugin-facts` | Verify generated plugin facts (CI gate)  |
| `pnpm run format`             | Format source                            |

### Client (`/client`)

| Command                    | Description                                          |
|----------------------------|------------------------------------------------------|
| `pnpm run dev`              | Start the Vite dev server                            |
| `pnpm run build`            | Build for production (runs icon generation first)    |
| `pnpm run preview`          | Preview the production build locally                 |
| `pnpm run typecheck`        | Type-check without emitting (CI gate)                |
| `pnpm test`                 | Run all tests                                        |
| `pnpm run test:unit`        | Run unit tests only                                  |
| `pnpm run test:integration` | Run integration tests                                |
| `pnpm run test:watch`       | Run tests in watch mode                              |
| `pnpm run test:coverage`    | Run tests with coverage report                       |
| `pnpm run lint`             | Lint source                                          |
| `pnpm run lint:check`       | Same command as `pnpm run lint` — the name CI uses    |
| `pnpm run lint:pages`       | Enforce the Page pattern (CI gate)                   |
| `pnpm run theme:lint`       | Flag styling that bypasses the appearance tokens     |
| `pnpm run format`           | Format source                                        |

---

## 8. Commit & Push Your Changes

```bash
git add .
git commit -m "fix: describe your change"

# Push to your fork's dev branch
git push origin fix/my-changes

# Or if working directly on dev
git push origin dev
```

Then open a Pull Request from your fork to `liketrek/TREK` targeting the `dev` branch. If your PR only modifies files under `wiki/`, it is exempt from branch enforcement and may target any branch.

---

## Tips

- Always branch off from an up-to-date `dev` — run `git fetch upstream && git rebase upstream/dev` before starting new work.
- Run tests before pushing: `pnpm test` at the repo root runs all workspaces. That alone is not the full CI gate — also run `pnpm run typecheck && pnpm run typecheck:tests && pnpm run lint:check && pnpm run check:plugin-facts` in `server/`, `pnpm run typecheck && pnpm run lint:check && pnpm run lint:pages` in `client/`, and `pnpm run i18n:parity:strict --filter @trek/shared` at the root if you touched translations.
- Follow the commit message conventions described in the [[Contributing]] guidelines.
