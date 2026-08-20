# Standalone Tutorial Studio — Deploy Runbook

Single-tenant extraction of the ContentForge tutorial-studio. Target: the associate's VPS
(`212.132.103.168`, 8 vCPU / 15 GB / no GPU), domain `tutorials.schreinercontentsystems.com`.

## Architecture

```
                       ┌──────────────┐
  browser ── nginx ──▶ │  hub-web     │  Next.js 15 + custom server (tsx src/server/index.ts)
   (TLS)               │  :3000       │  serves UI + /api/* + SSE (/api/events)
                       └──────┬───────┘
                              │ enqueue (BullMQ)
              ┌───────────────┴───────────────┐
        ┌─────▼──────┐                   ┌─────▼───────────────┐
        │  Redis     │                   │ worker-orchestrator │  tutorial-generate → splice → stitch
        └────────────┘                   │  (Node)             │  + thumbnail queue; ffmpeg
        ┌────────────┐                   └─────┬───────────────┘
        │ Postgres   │◀───── Drizzle ──────────┤
        │  (16)      │                   ┌─────▼───────────────┐
        └────────────┘                   │ storage-drive-      │  scans finished jobs →
                                         │ uploader (Node)     │  Google Drive delivery
                                         └─────────────────────┘
```

- **DB:** PostgreSQL 16 (Drizzle). **Queue:** Redis 7 + BullMQ.
- **Providers (all the associate's own keys, entered in Settings → Credentials, stored AES-GCM
  in `encrypted_secrets`):** LLM script (DeepSeek/Gemini/Claude), TTS (Fish Audio primary),
  thumbnail image (AI33), Google Drive delivery.
- **Media/work files:** `LOCAL_MEDIA_ROOT` on disk.

## Prerequisites (VPS)

Node ≥22, pnpm 9.15, PostgreSQL 16, Redis 7, **ffmpeg + ffprobe**, nginx, certbot.
(Or run Postgres/Redis via Docker; app + workers on the host or in containers.)

## 1. Configure

```bash
cp .env.standalone.example .env      # fill CORE block; JWT_SECRET + SECRETS_ENCRYPTION_KEY random
#   JWT_SECRET:            openssl rand -hex 32
#   SECRETS_ENCRYPTION_KEY: openssl rand -base64 32
```
Provider API keys are best entered later in the **Settings → Credentials** UI (encrypted at rest),
not in `.env`.

## 2. Infra (dev/local)

```bash
docker compose -f deploy/standalone/docker-compose.infra.yml up -d   # Postgres + Redis
```

## 3. Install, migrate, seed

```bash
pnpm install
pnpm --filter @repo/db build
pnpm --filter @repo/db db:migrate     # applies all Drizzle migrations to a fresh DB
pnpm --filter @repo/db seed           # seed baseline (creates first ADMIN user)
```

## 4. Build

```bash
pnpm build                            # turbo: packages + apps
```

## 5. Run

Dev (host):
```bash
# terminal 1 — web + API
cd apps/hub-web && pnpm start          # tsx src/server/index.ts on :3000
# terminal 2 — pipeline worker
cd apps/worker-orchestrator && node dist/index.js
# terminal 3 — Google Drive uploader
cd apps/worker-orchestrator && node dist/storage/standalone.js
```
Prod: use `deploy/standalone/ecosystem.config.cjs` (PM2) — `pm2 start deploy/standalone/ecosystem.config.cjs`.

## 6. First-run config (single-tenant, in the UI)

1. Log in as the seeded ADMIN.
2. **Settings → Credentials:** paste the associate's own keys — DeepSeek/Gemini (script), Fish Audio (TTS), AI33 (thumbnails).
3. **Google Drive:** run `node scripts/drive-authorize.mjs` once (his Google project + account) → writes the refresh-token file → set `STORAGE_DRIVE_ENABLED=true`.
4. **Channels:** create his channel(s), bind a voice + persona + thumbnail presets.
5. **(Optional) Keyword Tool:** set `KT_EMBED_URL`/`KT_EMBED_SECRET` once his own Keyword Tool is deployed.

## 7. Cutover (nginx + TLS)

- nginx: serve/proxy `hub-web` on :3000; `certbot` for `tutorials.schreinercontentsystems.com`.
- Only after this is verified do we retire the facade + Konrad's bridge (checkpoint first).

> Nothing here contacts Konrad's infrastructure. All provider keys, channels, Drive, and the
> Keyword Tool are the associate's own.
