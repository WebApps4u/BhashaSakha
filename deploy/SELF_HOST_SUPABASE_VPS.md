# Self-Hosted (Local DB) Deployment on VPS (Docker)

This is the **local database** deployment. You will run the full Supabase stack (Postgres + Auth + Storage + API) on your VPS, then point BhashaSakha to it.

You will end up with:
- App: `https://server.jssc.site`
- Supabase: `https://supabase.server.jssc.site`

## A) Prepare DNS + Firewall (before Docker)

1) DNS records
- `server.jssc.site` → VPS public IP
- `supabase.server.jssc.site` → VPS public IP

2) Firewall
- Allow inbound: `80/tcp` and `443/tcp`

## B) Upload your project from PC to VPS

On your PC (in the project folder):

```bash
rsync -avz --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude build \
  --exclude .git \
  ./  root@server.jssc.site:/opt/bhashasakha/
```

On VPS:

```bash
cd /opt/bhashasakha
ls -la
```

## C) Install and start self-hosted Supabase on VPS

### 1) Download the official Supabase docker setup

```bash
mkdir -p /opt/supabase
cd /opt
git clone --depth 1 https://github.com/supabase/supabase
cp -rf supabase/docker/* /opt/supabase/
cd /opt/supabase
```

If you already have a `/opt/supabase` from a previous attempt, remove it first:

```bash
rm -rf /opt/supabase
```

### 2) Create Supabase `.env`

```bash
cp .env.example .env
nano .env
```

Important: DO NOT keep defaults.

Generate secrets on VPS:

```bash
openssl rand -hex 32   # for POSTGRES_PASSWORD (letters+numbers recommended)
openssl rand -base64 48
openssl rand -hex 16
openssl rand -base64 24
```

Now set at least:
- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `ANON_KEY`
- `SERVICE_ROLE_KEY`

Also set these URLs so Supabase knows its public address:
- `SITE_URL=https://server.jssc.site`
- `API_EXTERNAL_URL=https://supabase.server.jssc.site`
- `SUPABASE_PUBLIC_URL=https://supabase.server.jssc.site`

Use Supabase’s own guide for the exact meaning of keys and required variables: https://supabase.com/docs/guides/self-hosting/docker

### 3) Start Supabase

```bash
docker compose pull
docker compose up -d
docker compose ps
```

If something fails, view logs:

```bash
docker compose logs -f --tail=200
```

Confirm ports on VPS:
- Kong (Supabase API gateway): `8000`
- Studio (optional UI): `3000`

Important: our app will run on `3100` to avoid clashing with Supabase Studio.

Test Supabase locally on VPS:

```bash
curl -sS http://127.0.0.1:8000/auth/v1/health || true
```

## D) Apply your app “data schema” migrations into the local Supabase Postgres

Your project migrations are in: `/opt/bhashasakha/supabase/migrations/`

We will run them against the Supabase DB container.

1) Load Supabase env into your shell (so `$POSTGRES_PASSWORD` is available):

```bash
cd /opt/supabase
set -a
source .env
set +a
```

2) Verify DB service exists:

```bash
cd /opt/supabase
docker compose ps
```

In the official stack it’s usually named `supabase-db`.

3) Copy migrations into DB container:

```bash
docker cp /opt/bhashasakha/supabase/migrations/. $(docker compose ps -q db):/tmp/migrations
```

If `docker cp` says the container name is different, use the DB container name from `docker compose ps`.

4) Execute migrations in order:

```bash
docker compose exec -T db bash -lc '
  set -e
  for f in /tmp/migrations/*.sql; do
    echo "Applying $f"
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$f"
  done
'
```

If you see `password authentication failed`, double-check that `POSTGRES_PASSWORD` is exported in your current shell:

```bash
cd /opt/supabase
set -a
source .env
set +a
echo "$POSTGRES_PASSWORD" | wc -c
```

If your Supabase `.env` uses a different DB name than `postgres`, change `-d postgres` accordingly.

## E) Configure BhashaSakha to use your local Supabase

Edit `/opt/bhashasakha/deploy/.env`:

```bash
cp /opt/bhashasakha/deploy/.env.example /opt/bhashasakha/deploy/.env
nano /opt/bhashasakha/deploy/.env
```

Set these values (IMPORTANT):
- `VITE_SUPABASE_URL=https://supabase.server.jssc.site`
- `VITE_SUPABASE_ANON_KEY=<ANON_KEY from /opt/supabase/.env>`

- `SUPABASE_URL=https://supabase.server.jssc.site`
- `SUPABASE_ANON_KEY=<same ANON_KEY>`
- `SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from /opt/supabase/.env>`

Set CORS:
- `CORS_ORIGIN=https://server.jssc.site`

Set Gemini:
- `GEMINI_API_KEY=...` (or `GOOGLE_API_KEY=...`)

## F) Put everything behind HTTPS (Caddy)

We use **one Caddy** for both hostnames.

1) Create the real Caddyfile:

```bash
cp /opt/bhashasakha/deploy/Caddyfile.vps.example /opt/bhashasakha/deploy/Caddyfile.vps
nano /opt/bhashasakha/deploy/Caddyfile.vps
```

Replace:
- `you@example.com`
- keep `server.jssc.site`
- keep `supabase.server.jssc.site`

2) Start the app + caddy:

```bash
cd /opt/bhashasakha/deploy
docker compose -f docker-compose.vps.yml up -d --build
docker compose -f docker-compose.vps.yml ps
```

Check Caddy logs if HTTPS isn’t issued:

```bash
docker compose -f docker-compose.vps.yml logs -f --tail=200 caddy
```

Now:
- App: `https://server.jssc.site`
- Supabase: `https://supabase.server.jssc.site`

Verify from your laptop:

```bash
curl -sS https://server.jssc.site/api/health
curl -sS https://supabase.server.jssc.site/auth/v1/health || true
```

## G) Bootstrap your first admin (one-time)

1) Sign up in the app.
2) Promote your email:

```bash
curl -X POST "https://your-domain.com/api/admin/bootstrap" \
  -H "Content-Type: application/json" \
  -H "x-bootstrap-token: $(grep ^ADMIN_BOOTSTRAP_TOKEN= /opt/bhashasakha/deploy/.env | cut -d= -f2-)" \
  -d '{"email":"you@example.com"}'
```

## H) Updating

```bash
cd /opt/bhashasakha
git pull
cd deploy
docker compose -f docker-compose.vps.yml up -d --build
```

## I) Backups (very important)

### Backup Postgres

```bash
cd /opt/supabase
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" supabase-db pg_dump -U postgres -d postgres > /opt/backup/supabase_$(date +%F).sql
```

### Backup storage files

Supabase Storage uses Docker volumes. Back up with:

```bash
docker volume ls | grep supabase
```

Then archive the storage volume (example command will vary depending on your exact volume name).
