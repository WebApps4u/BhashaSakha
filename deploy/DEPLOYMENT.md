# VPS Docker Deployment

This repo ships a Docker production build where one Node process serves:
- the frontend (`/`) and
- the API (`/api/*`).

There are 2 database options:
- **Option 1 (Recommended for “local DB”):** self-host Supabase on your VPS (Postgres/Auth/Storage) and point the app to it.
- **Option 2:** managed Supabase.

If you want **no third-party DB**, follow: `deploy/SELF_HOST_SUPABASE_VPS.md`.

## 0) Prerequisites on VPS

- A Linux VPS with Docker installed (and `docker compose` plugin)
- A domain name pointing to the VPS IP
- Ports opened:
  - If using Caddy HTTPS: `80` and `443`
  - If exposing plain HTTP only: your chosen port (default here is `8080`)

Verify Docker:

```bash
docker --version
docker compose version
```

## 1) Supabase project (Data + Auth + Storage)

Create a Supabase project and collect:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, never expose to browser)

### Apply database migrations (one-time)

All SQL migrations live in `supabase/migrations/`.

Safest approach:
1. Open Supabase Dashboard → SQL Editor.
2. Execute the migration SQL files in **lexicographic order** (top to bottom as they appear in the folder listing).
3. Confirm tables exist (`profiles`, `translations`, `subscription_*`, `feature_flags`, `app_settings`, etc.).

Notes:
- This app uses Supabase Storage buckets:
  - `session-exports`
  - `tts-cache`
- If you already ran migrations once, re-running should be mostly idempotent.

## 2) Copy the repo to VPS

```bash
git clone <your-repo-url> BhashaSakha
cd BhashaSakha
```

## 3) Create production env file

The Docker compose setup reads env from `deploy/.env`.

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env
```

Fill at least:
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_API_KEY` and/or `GEMINI_API_KEY`
- `CORS_ORIGIN=https://your-domain.com`

Generate a strong admin bootstrap token:

```bash
openssl rand -hex 32
```

Put it into `ADMIN_BOOTSTRAP_TOKEN=`.

## 4) Deploy with Docker

### Option A: simple HTTP on port 8080

```bash
cd deploy
docker compose up -d --build
docker compose ps
```

Open:
- `http://YOUR_VPS_IP:8080/`

### Option B: HTTPS with Caddy (recommended)

1) Edit `deploy/Caddyfile`:
- Replace `you@example.com`
- Replace `your-domain.com`

2) Start:

```bash
cd deploy
docker compose -f docker-compose.caddy.yml up -d --build
docker compose -f docker-compose.caddy.yml ps
```

Open:
- `https://your-domain.com/`

## 5) First-time Admin bootstrap

1) Create a normal user account in the app (sign up).
2) Call bootstrap endpoint once to grant admin role to that email.

Example:

```bash
curl -X POST "https://your-domain.com/api/admin/bootstrap" \
  -H "Content-Type: application/json" \
  -H "x-bootstrap-token: $ADMIN_BOOTSTRAP_TOKEN" \
  -d '{"email":"you@example.com"}'
```

After this:
- Sign in → open `/admin`
- You can manage feature flags (including `tts_style_prompting`)

## 6) Update / Redeploy

```bash
cd BhashaSakha
git pull
cd deploy
docker compose up -d --build
```

If using Caddy compose:

```bash
docker compose -f docker-compose.caddy.yml up -d --build
```

## 7) Logs / Debug

```bash
cd deploy
docker compose logs -f --tail=200
```

Health endpoint:
- `GET /api/health`

## Important security notes

- Never put `SUPABASE_SERVICE_ROLE_KEY` into any `VITE_*` variable.
- Keep `deploy/.env` private (do not commit it).
- Use HTTPS when deploying publicly.
