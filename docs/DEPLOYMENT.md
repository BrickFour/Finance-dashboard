# Deploying DHYEYA

One container serves the API and the built web client on port 4000. Data (SQLite file and uploaded workbooks) lives on the `/data` volume.

## 1. Docker Compose (recommended)

```bash
cp .env.example .env
# edit .env: set JWT_SECRET and BOOTSTRAP_ADMIN_PASSWORD (both are required)
docker compose up -d --build
docker compose logs -f dhyeya
```

On every start the container runs `migrate` (idempotent), `seed` (creates the system categories and the first administrator only if absent), then the server. Open `http://<host>:4000` and sign in as `BOOTSTRAP_ADMIN_EMAIL` with `BOOTSTRAP_ADMIN_PASSWORD`.

Health check: `GET /api/health` returns `{"status":"ok"}` (used by the container `HEALTHCHECK`).

### PostgreSQL instead of SQLite

```bash
# add POSTGRES_PASSWORD to .env, then
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build
```

## 2. Without Docker

```bash
cd client && npm ci && npm run build
cd ../server && npm ci && npm run build
export NODE_ENV=production JWT_SECRET=... BOOTSTRAP_ADMIN_PASSWORD=...
node dist/db/cli.js migrate && node dist/db/cli.js seed
node dist/index.js
```

Run it under a process manager (systemd, pm2) and keep `server/data` and `server/storage` (or `SQLITE_FILE` / `UPLOAD_DIR`) on persistent, backed-up storage.

## 3. Vercel

`vercel.json` builds the client as the static site and runs the API as one
serverless function (`api/index.mjs` → `server/src/serverless.ts`). The first
request on each instance migrates, seeds and builds the demo company (~5–10 s).

In the Vercel project: **Root Directory** must be the repository root (where
`vercel.json` is), Framework Preset **Other**, and leave the build/install/output
overrides empty so `vercel.json` applies. Environment variables:

| Variable | |
| --- | --- |
| `JWT_SECRET` | **Required.** Long random value; the API refuses to start without it. |
| `BOOTSTRAP_ADMIN_PASSWORD` | **Required** in practice: the admin login. |
| `BOOTSTRAP_ADMIN_EMAIL` | Optional, default `admin@dhyeya.local`. |
| `DATABASE_URL` | Recommended. A Postgres connection string (Neon, Vercel Postgres, Supabase). |

**Without `DATABASE_URL`** the API uses SQLite in `/tmp`, which Vercel wipes
whenever an instance is recycled. The demo company and admin are rebuilt
automatically, so the demo always works, but companies, users and imports you
add are lost and are not shared between instances. Use `DATABASE_URL` for
anything beyond a demo. Uploads are limited to 4.5 MB per request on Vercel.

## Production checklist

- **TLS is required.** Put the app behind a reverse proxy (Caddy, nginx, a cloud load balancer) that terminates HTTPS. In production the session cookie is `Secure` and Helmet sends HSTS and `upgrade-insecure-requests`, so plain `http://` access (other than some `localhost` cases) will not keep a login. The app already trusts one proxy hop (`trust proxy = 1`).
- Set `CORS_ORIGIN` to the public URL (for example `https://dhyeya.example.com`).
- `JWT_SECRET` must be a long random value; the server refuses to start in production with the default.
- The seeded admin must change the password at first sign-in. Pick a strong `BOOTSTRAP_ADMIN_PASSWORD`; do not use the documented dev default.
- **Back up** the `/data` volume (SQLite file + uploads) or your Postgres database. The data is financial.
- Optional integrations (AI, CRM, SMTP) stay "not configured" unless their variables are set; see `server/.env.example`.

## Updating

```bash
git pull && docker compose up -d --build
```

Migrations are applied automatically at startup; the volume is preserved.

## Status of this setup

The Docker files were written against the project's scripts and source but have **not been built or run** in the environment where they were authored (that machine blocks the Node build tools). Run `docker compose build` once and check `docker compose logs` before relying on it.
