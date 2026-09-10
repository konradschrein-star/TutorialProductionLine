# Keyword Tool deployment inventory — read-only, 2026-09-09

No server was launched, no credentials copied, and no production state changed during this inventory. The local frontend-start policy restriction remains unresolved; this document is not a workaround for that restriction.

## Observed footprint and preservation baseline

- VPS2: root filesystem 301 GiB, approximately 217 GiB used / 81 GiB available (74% used at inspection). Other applications remain present. No running Keyword Tool container or matching directory under `/opt` to depth two was found.
- Source: `/opt/keyword-tool-v2`; `data` approximately 73 MiB, logs 124 MiB. Main database file 57,470,976 bytes.
- Read-only source counts: 11 users, 23,662 keywords, 66,548 source videos, 43 source channels, 23,590 cached screening verdicts and two screening-prompt rows.
- Source data includes `data_lake.db`, `platform_profile.json`, `gatekeeper_rules.json`; source `frontend/public` exists. The candidate deliberately did not import the database, environment files, public assets or operational secrets.
- The live-derived candidate is `C:/Users/konra/AppData/Local/Temp/keyword-live-recovery-82957784c49447849cbff7d0a1c16669`. Its `RECOVERY-MANIFEST.md` records the baseline. Do not replace it with the older unrelated Git checkout.

Preserve the complete consistent SQLite database, not just the users table: user IDs/roles/disabled state and role locks, claims, keyword IDs, source evidence, verdict cache, edited rubrics, topic overrides, assignments, production bindings, operator notes and delivery references belong together. The new intent/checkpoint/outbox-receipt tables also become essential after cutover. Existing Studio job references must resolve to retained original IDs in the migrated Studio database.

For an eventual migration, create and integrity-check a SQLite online-backup snapshot or take a quiesced consistent snapshot; do not copy only the live `.db` while ignoring its WAL. Arrange a short single-writer cutover and final delta/backup before changing the board hostname. Do not run both boards accepting claims against divergent database copies. Keep a recoverable pre-migration backup and validate schema/migrations against a copy before enabling the new service.

## Existing container configuration is not a safe build recipe

Source has a Dockerfile, docker-compose.yml and .dockerignore; these were not part of the candidate's source allowlist.

- Legacy image combines Node frontend and Python backend. Frontend builder uses node:20-alpine; runtime uses python:3.11-slim and a generated start script. Exposes 8075 and 3075. Compose publishes both backend and frontend ports on all host interfaces by default and mounts source/data in one service variant.
- Dockerfile includes shell redirection and `|| true` inside COPY instructions. COPY does not execute shell fallback semantics. It also attempts to copy `data` while .dockerignore excludes it, and expects optional public/env-example files absent from the candidate.
- Existing .dockerignore is insufficient for this recovery directory: it does not comprehensively exclude `runtime` synthetic databases/WAL/SHM, `source.tar`, alternate `.next-integration-embed`, caches and private material. Do not use the entire candidate directory as an uncontrolled build context.
- Backend requirements pin many packages, but `mcp>=1.27.0` is unbounded and there is no complete hashed dependency lock. Sentence-transformers brings substantial Torch/model dependencies. Final image size and clean Linux installation remain unmeasured.

## Proposed clean Linux build path — not executed

1. Construct an allowlisted source build context: backend source and schema/migrations, src_v2, frontend source/package-lock/package/Next/PostCSS/TypeScript config, and separately reviewed public assets. Exclude all `.env*`, secrets, cookies/proxies, DB/WAL/SHM, runtime fixtures, source archive, node_modules, build output and logs. Include reviewed Dockerfiles explicitly, not the invalid legacy COPY lines.
2. Build a separate frontend image using a supported pinned Node image aligned with Studio's tested Node runtime, `npm ci` and `npm run build -- --webpack`. Set its public API base to `/api`; never bake an API secret into `NEXT_PUBLIC_API_KEY`. The tested Windows build is source evidence, not a portable Linux image artifact.
3. Build a separate Python backend image with explicit Python version and dependency installation, working directory `/app`, source copied read-only, one Uvicorn process and no reload. Resolve/test a reproducible CPU dependency set; do not assume a full sentence-transformers/Torch install will fit a tiny image budget. Build-time dependency downloads are not provider generation.
4. Mount a dedicated writable persistent volume at `/app/data`: the actual SQLite connection code uses this fixed path even though `DATABASE_PATH` exists in config. Mount writable bounded logs and model/cache paths separately, with a nonroot UID owning them. Do not share a SQLite volume between multiple backend replicas.
5. Before launch, address startup side effects: `backend.main` auto-applies migrations but currently logs migration failures and continues; it attempts `yt-dlp -U` and preloads an embedding model. A controlled deployment should fail on migration errors, keep scraper binaries immutable, and explicitly manage model caching/download permission. The synthetic `scripts.recovery_integration:app` is NOT a production entrypoint.
6. A split frontend cannot use the current Next rewrite to `127.0.0.1:8075`: that is its own container. Either add a validated internal backend proxy base and rebuild, or configure the public reverse proxy to route `/api/*` directly to the backend service. Proxy WebSocket endpoints as required. Keep backend/internal API ports unexposed publicly.
7. Validate image startup/migrations against a synthetic or backed-up database, API authentication, health, actual SSO, claim concurrency, frozen intents, ordered callbacks and rollback. Do not enable scraping/screening recovery against copied real credentials until the intended safety gates are verified.

## Browser and internal routing

Studio's public parent is `https://tutorials.schreinercontentsystems.com`. Keep Keyword Tool a separate service and preferably retain its existing public board hostname (`keywordtool.schreinercontentsystems.com`) at an explicitly coordinated cutover; no DNS change is implied by this document.

- Browser: Studio `KT_EMBED_URL` points to the public board; board embed response permits exactly the Studio origin through `HUB_EMBED_ORIGIN`. Do not apply a conflicting blanket X-Frame-Options header to `/embed/*`.
- Hub server: `KT_API_URL` points to the internal backend service, independently of the browser hostname. This is now implemented and tested.
- KT server: `CONTENT_FORGE_API_URL` points to the internal Studio API; `CONTENT_FORGE_PUBLIC_URL` points to the Studio public hostname; `CONTENT_FORGE_KT_PUBLIC_URL` points to the public board.
- Studio outbox: `KT_STATUS_WEBHOOK_URL` points to the reachable authenticated backend callback, and `KT_WEBHOOK_SECRET` must match KT's callback credential.
- Shared SSO: `KT_EMBED_SECRET` must match on both services. Preserve existing Google auth configuration if standalone Google sign-in remains supported, updating authorized browser origins deliberately rather than copying localhost URLs.
- Attach backend and Hub to the same private application network. Research/provider access requires deliberate egress; a Docker network marked `internal: true` by itself cannot reach YouTube, model registries or cloud providers. No new public backend listen port is needed.

## Runtime environment names (no secret values)

Hub integration: `KT_ENABLED`, `KT_EMBED_URL`, `KT_API_URL`, `KT_EMBED_SECRET`, `KT_STATUS_WEBHOOK_URL`, `KT_WEBHOOK_SECRET`.

Frontend build/routing: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_WS_URL`, `HUB_EMBED_ORIGIN`; current `BACKEND_PORT` rewrite is only suitable for a shared network namespace. `NEXT_PUBLIC_API_KEY` must be empty/absent for browser builds; users authenticate via their session, not a published machine credential.

Backend auth/runtime: `API_SECRET_KEY`, `JWT_SECRET`, `JWT_TTL_HOURS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`, `DEBUG_MODE`, `API_HOST`, `API_PORT`, `API_RELOAD`, `CORS_ORIGINS`, `RATE_LIMIT_ENABLED`, `RATE_LIMIT_REQUESTS`, `RATE_LIMIT_PERIOD`, `LOG_LEVEL`, `LOG_FORMAT`, `DATABASE_TIMEOUT`. Require real secret material and DEBUG_MODE=false; do not accept the development JWT fallback. `DATABASE_PATH` alone does not relocate the existing SQLite pool.

Studio handoff: `CONTENT_FORGE_ENABLED`, `CONTENT_FORGE_API_URL`, `CONTENT_FORGE_PUBLIC_URL`, `CONTENT_FORGE_SHARED_SECRET`, `CONTENT_FORGE_KT_PUBLIC_URL`, `CONTENT_FORGE_CHANNEL_ID`, `CONTENT_FORGE_TUTORIAL_MODE`, `CONTENT_FORGE_DEFAULT_LANGUAGE`, `CONTENT_FORGE_INTENT_RECOVERY_ENABLED`, `KT_EMBED_SECRET`, `KT_WEBHOOK_SECRET`.

The source also has legacy `CONTENT_FORGE_CREATED_BY`, `CONTENT_FORGE_SCRIPT_PROVIDER`, `CONTENT_FORGE_SCRIPT_MODEL`, `CONTENT_FORGE_TTS_PROVIDER`, `CONTENT_FORGE_TTS_VOICE`, `CONTENT_FORGE_PROMPT_PRESET_ID` configuration. The recovered intent client intentionally does not send those recipe/identity overrides: actual claimed producer and Studio's Admin workspace defaults are authoritative. Preserve configured Studio voices/keys in Studio, not a competing KT recipe.

Research/screening as actually used: `YOUTUBE_API_KEYS` / `YOUTUBE_API_KEY`, `DEEPSEEK_API_KEY`, `GOOGLE_AI_STUDIO_KEY`, `V5_SCREEN_MODEL`, `V5_SCREEN_ESCALATE_MODEL`, `V5_SCREEN_HIDE_UNSCREENED`, `V5_SCREEN_BATCH`, `V5_SCREEN_TIMEOUT`, `V5_SCREEN_MAX_TOKENS`, `V5_SCREEN_MAX_TOKENS_GOOGLE`, `V5_SCREEN_SLEEP`, `V5_SCRAPER_PROXY_MODE`, `V5_SCRAPER_COOKIE_FILE`, `V5_SCRAPER_TIMEOUT_SECONDS`, `V5_SCRAPER_ROTATE_UA`, `V5_SCRAPER_USE_PROXY`, `SNIPER_MAX_WORKERS`, `SNIPER_TIMEOUT`, `SNIPER_SCORING_MODE`. Existing cookie/proxy files are secrets and must not enter images. Model/YouTube egress is separate from API startup safety.

Optional KT Drive: `DRIVE_ENABLED`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_DRIVE_TOKEN_PATH`, `DRIVE_DEFAULT_LANGUAGE`. Retain disabled unless its distinct direct-Drive workflow is deliberately required; Studio remains the tutorial artifact archive owner. Never copy the authorized-user token into the image.

## Remaining deployment blockers

Clean Linux images have not been built for KT. Split frontend proxy routing, strict startup/migration behavior, complete source-data/public-asset preservation and image dependency footprint still require implementation/testing. The local API contract passed real HTTP acceptance; the embedded frontend remains unverified because port 17878 startup was policy-blocked. Neither that restriction nor the production cutover has been bypassed here.
