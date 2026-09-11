# Updating

How to update this fork of TREK to a newer version without losing data.

> **Note:** This repository is an independently maintained fork
> ([iceafish/ohmytrek](https://github.com/iceafish/ohmytrek)). It does not publish
> prebuilt Docker images and does not follow upstream releases — update from
> this repository only.

## Before You Update

Back up your data first. Go to Admin Panel → Backups and create a manual backup, or copy your `./data` and `./uploads` directories to a safe location. See [Backups](Backups) for details.

## From Source

```bash
git fetch origin
git checkout dev        # or a release tag
pnpm install
pnpm run build
# restart the server the way you run it (pm2, systemd, …)
```

`pnpm run build` builds `shared` → `server` → `client` in dependency order.

## Docker Compose

The shipped `docker-compose.yml` builds the image from this repository, so an
update is a rebuild:

```bash
git pull
docker compose up -d --build
```

If you publish the image to your own registry and your compose file names it,
pull instead:

```bash
docker compose pull && docker compose up -d
```

Your volumes are untouched by either path — only the image and container are replaced.

## Helm (Kubernetes)

The chart lives in this repository under `charts/trek` (no external chart
repository). To update:

```bash
git pull
helm upgrade trek ./charts/trek
```

Your existing values and PVCs (data, uploads) are preserved. To pin an exact
chart version instead, pass `--version <x.y.z>`.

See [Install-Helm](Install-Helm) for the values reference.

## Database Migrations

TREK runs any pending database migrations automatically at startup. No manual migration steps are required after updating.

## Encryption Key Note

If you are upgrading from a version that predates the dedicated `ENCRYPTION_KEY` (i.e. you have no `ENCRYPTION_KEY` environment variable set), TREK automatically falls back to `./data/.jwt_secret` on startup and immediately promotes it to `./data/.encryption_key`. No manual steps are required — the transition is handled at first boot after the upgrade.

If you want to rotate to a new key at any point (not required for a normal update), see [Encryption-Key-Rotation](Encryption-Key-Rotation) for the full procedure.

## Next Steps

- [Backups](Backups) — schedule automatic backups so you always have a restore point before updates
- [Encryption-Key-Rotation](Encryption-Key-Rotation) — if you need to rotate or migrate the encryption key
