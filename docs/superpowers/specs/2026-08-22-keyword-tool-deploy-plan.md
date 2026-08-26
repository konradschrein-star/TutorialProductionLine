# Keyword Tool V2 — Deploy Plan (friend's VPS)

Source: `C:\Users\konra\OneDrive\Projekte\20260713 Keyword Tool V2`.
Target: friend's VPS 212.132.103.168, isolated alongside the tutorial studio.

## What it actually is (surprises)
- **Python 3.11 FastAPI backend + separate Next.js 16 frontend** (NOT a Node
  monorepo; ships an npm lockfile). Entry: `python -m backend.run_backend`;
  frontend `next start`.
- **Storage = a single SQLite file** `data/data_lake.db` (no Postgres/Redis/queue).
- Backend boot preloads `all-MiniLM-L6-v2` (sentence-transformers/torch) →
  **budget ~1.5–2 GB RAM** just for kw-backend. Needs python3.11 explicitly.
- **The ~2150 keywords are DATA, not code** — live in `data_lake.db` on the OLD
  prod box `65.108.6.149:/opt/keyword-tool-v2`. `*.db` is gitignored; a fresh
  clone is empty. Must copy the live file (WAL-checkpoint first).

## Deploy shape (isolated, pm2 + nginx, ports 3100 FE / 8100 BE, 127.0.0.1)
1. Code → `/opt/keyword-tool-v2` (rsync/scp without node_modules/.venv/.next/data).
2. `python3.11 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt`.
3. Copy live `data/data_lake.db` (+ data/*.json, proxies.txt) from 65.108.6.149.
4. Frontend: **build with `NEXT_PUBLIC_API_URL=/api NEXT_PUBLIC_WS_URL=/ws`**
   (build-time! else browser calls 127.0.0.1:8075) → `npm ci && npm run build`.
5. Fresh `/opt/keyword-tool-v2/.env` (do NOT reuse committed one — it has a
   leaked YT key + old domain). Key vars: API_HOST=127.0.0.1, API_PORT=8100,
   FRONTEND_PORT=3100, DATABASE_PATH, CORS_ORIGINS, API_SECRET_KEY (auth on/off),
   JWT_SECRET, GOOGLE_CLIENT_ID/SECRET, BOOTSTRAP_ADMIN_EMAIL (default is
   hardcoded konrad.schrein@gmail.com — change it), YOUTUBE_API_KEY (rotate),
   GEMINI_API_KEY, DEEPSEEK_API_KEY. CONTENT_FORGE_ENABLED=false, DRIVE_ENABLED=
   false, MCP_ENABLED=false for standalone.
6. pm2 apps `kw-backend` (.venv/bin/python -m backend.run_backend) + `kw-frontend`
   (npm run start -- -p 3100). Distinct names → no collision with tutorial-*.
7. Own nginx server block (own server_name) → / →3100, /api/ + /ws/ →8100.

## DECISIONS MADE (Konrad, 2026-08-22)
- **No separate domain, no Google login.** Serve KT under the tutorial tool's
  host on a subpath (/kw) and use it THROUGH the hub's existing embed-SSO
  (hub mints a KT_EMBED_SECRET token → KT /api/integration/forge/embed-login).
  This sidesteps Google-OAuth-needs-a-domain entirely. Frontend must be built
  with Next basePath=/kw AND NEXT_PUBLIC_API_URL=/kw/api (or same-origin /api
  behind the /kw proxy).
- **Do NOT copy Konrad's full keyword DB.** Seed the friend's EMPTY KT with the
  **Guide Realm** subset only: `kt_keywords WHERE channel_ref='@guiderealmvideos'`
  = **2128 rows** (verified on 65.108.6.149). SCRUB per-VA/production fields on
  import (status→'NEW', clear claimed_by/assignee/claimed_at/forge_job_id/
  forge_status_detail/drive_url/done_at/uploaded_by/qc_* ) so the friend gets a
  clean board. Also carry the GuideRealmVideos kt_channels row (id 7) if the
  board needs it. sqlite3 is now installed on both boxes.

## ENVIRONMENT PREPPED ON VPS (2026-08-22)
- Ubuntu 26.04 ships Python 3.14 (no 3.11 in apt). Installed **uv 0.12.5** and
  fetched **standalone CPython 3.11** at
  `/root/.local/share/uv/python/cpython-3.11-linux-x86_64-gnu/bin/python3.11`.
  Use `uv venv .venv --python 3.11 && uv pip install -r backend/requirements.txt`.
- sqlite3 installed. RAM 14 GB free, disk 458 GB free — ample.

## STATUS 2026-08-22: DEPLOYED + WORKING (embedded)
- Local clone was STALE (no v5 board/embed) → deployed the CURRENT code from
  prod 65.108.6.149 instead (code only, not data). Python 3.11 via uv; frontend
  built basePath=/kw + NEXT_PUBLIC_API_URL=/kw/api.
- Fresh DB built from prod .schema (37 tables; prod has no schema_migrations —
  base schema is the source of truth). Seeded 2128 Guide Realm keywords
  (channel_ref=@guiderealmvideos), scrubbed of claim/production state.
- pm2: kw-backend (:8100, auth OFF/API_SECRET_KEY empty), kw-frontend (:3100,
  basePath /kw). nginx: /kw/api/ + /kw/ws + /kw/health → :8100, /kw → :3100.
  pm2 save done.
- Hub wired: KT_EMBED_URL=http://212.132.103.168/kw, shared KT_EMBED_SECRET +
  KT_WEBHOOK_SECRET in both .envs. tutorial-web restarted via ecosystem.
- VERIFIED: hub Keywords tab renders the embedded board with the 2128 keywords
  in 182 software packets (Claim/Release/Discard, filters). No Google login on
  the embed path.
- KNOWN: direct /kw/v5 has KT's own Google-login guard (needs a domain) — but
  access is via the hub embed, so not blocking. Produce-from-KT→hub needs the
  hub inbound /api/v1/tutorial/jobs route (not built) — browse/claim works.

## REMAINING STEPS (done above; kept for reference)
1. Transfer KT code → /opt/keyword-tool-v2 (excl node_modules/.venv/.next/data/.git).
2. `uv venv .venv --python 3.11 && uv pip install -r backend/requirements.txt`.
3. Frontend: build with basePath=/kw + NEXT_PUBLIC_API_URL, `npm ci && npm run build`.
4. Fresh .env (ports 8100/3100, API_HOST=127.0.0.1, CONTENT_FORGE_ENABLED=true,
   KT_EMBED_SECRET=<shared with hub>, KT_WEBHOOK_SECRET, BOOTSTRAP_ADMIN_EMAIL=
   friend, no leaked keys).
5. pm2 kw-backend + kw-frontend; add /kw + /kw/api + /kw/ws locations to the
   existing nginx tutorial-studio server block.
6. Hub side: set KT_EMBED_URL (→ /kw), KT_EMBED_SECRET (match), KT_STATUS_WEBHOOK_URL,
   KT_WEBHOOK_SECRET in /opt/tutorial-studio/.env; rebuild+restart tutorial-web;
   verify the Keywords tab loads the embedded board.
7. Seed the Guide Realm 2128 (scrubbed) into the fresh data_lake.db.
8. (Later) build the hub inbound `/api/v1/tutorial/jobs` route if KT Produce must
   push jobs into the studio.

## OLD BLOCKERS (now resolved by the decisions above)
1. **Login is Google OAuth** → needs a real domain + HTTPS (Google rejects raw
   IP/http origins). Same blocker as the Drive OAuth flow → tied to the deferred
   DNS cutover. Options: (a) do DNS now; (b) deploy with `API_SECRET_KEY` empty
   (auth OFF) behind nginx basic-auth for private use on the IP.
2. **Copy keyword DB from 65.108.6.149** (Konrad's other infra) — one-time data
   migration, needs the user's OK to pull from that box.
3. Rotate the leaked YOUTUBE_API_KEY in the committed .env.
4. Register the new domain as an authorized Google OAuth origin (once DNS done).

## Integration with the tutorial studio (after DNS)
Matching secrets both sides: `KT_EMBED_URL`, `KT_EMBED_SECRET` (SSO both ways),
`KT_STATUS_WEBHOOK_URL` + `KT_WEBHOOK_SECRET` (status back). KT exposes
`/api/integration/forge/embed-login`, `/api/v5/keywords`, `/embed/board`,
`/board`, status-webhook receiver. Set `CONTENT_FORGE_ENABLED=true` on KT +
fill KT_* on the hub. NOTE: the hub's inbound "KT pushes Produce" route
(`/api/v1/tutorial/jobs`) is NOT built yet — Produce currently works only from
inside the hub UI; build that route (behind CF_API_TOKEN) if KT's Produce button
must push jobs in.
