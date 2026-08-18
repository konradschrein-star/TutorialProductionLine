# Tutorial Studio Extraction & Deployment — Design

**Date:** 2026-08-17
**Owner:** Konrad
**Target host:** vps1 (`tutorials.schreinercontentsystems.com`), later the client's VPS
**Sole operator:** Lorraine Sabroso (VA)

## 1. Problem

The site live at `tutorials.schreinercontentsystems.com` is a standalone Vite SPA + tiny
Express server (a Gemini-built lookalike). Its internals are stubs, which explains every
reported symptom:

- **"Weird script that doesn't match what we wrote"** — `src/services/aiService.ts:40-55`
  returns a hardcoded placeholder script whenever no Groq key is present in the browser
  (always, on a fresh deploy). The wizard also has no outline field, so only a one-line
  topic is ever sent to the model. Prior context has nowhere to go.
- **"No security on the API keys"** — keys live in browser `localStorage` and are sent
  from the browser directly to third-party APIs. No server-side vault.
- **No real auth** — "login" is a dropdown selecting a hardcoded user; roles unenforced.
- **Fish Audio never implemented** — Fish voices fall through to a sine-wave tone
  generator; server writes dummy non-audio buffers.
- Pipeline is a linear, blocking wizard; the "batch 5×" button is `setTimeout` theater.

The real tool — the one to ship — already exists in ContentForge
(`C:\cfref\content-forge`). It is not a copy-pasteable folder; it is a monorepo slice:

- **Script engine:** `apps/worker-orchestrator/src/utils/tutorial/script-prompt.ts` —
  a tiered prompt stack (`NO_PRESENTER_RULE`, answer-first opening, anti-AI voice list),
  assembled by `buildAnswerFirstScriptPrompt` → `buildSharedRuleStack`, sent to the LLM
  via `generateScript` (`llm-registry.ts`).
- **Non-linear pipeline:** BullMQ (Redis) queue + a `tutorial_job_status` state machine
  (`packages/db/src/schema/tutorial-enums.ts`) + a Studio board polling every 5s. Script
  and TTS are decoupled queue stages; the VA fires jobs and never blocks.
- **Real auth:** JWT cookie sessions (`hub_session`) + RBAC
  (`apps/hub-web/src/lib/auth/rbac.ts`), a users table, and a single encrypted secrets
  vault (per-VA keys were deliberately abolished).
- **Fish Audio** is the primary TTS with a fallback chain and a real health check.

## 2. Goal & non-goals

**Goal:** Replace the decoy at `tutorials.schreinercontentsystems.com` with the real
ContentForge Tutorial Studio, isolated to its own database/queue, exposing only the
tutorial surface to the operator, with all secrets held server-side.

**Non-goals (this phase):**
- No new features. Ship the existing tool as-is.
- No keyword-tool integration (deliberately left inert — save processing for the client).
- No standalone repo carve-out yet (that is Phase 2, before the client-VPS move).

## 3. Approach — deploy the slice, gate by role

Deploy hub-web **whole** and confine the operator by RBAC rather than deleting pages.
The RBAC layer already has a tutorial-scoped role (`isTutorialScopedRole`) that lands a
user on `/tutorial-studio` and 404s/redirects them out of every other route. This is
safer than surgically removing routes (which would break shared imports) and is exactly
what that role was built for.

### 3.1 Topology on vps1

- **`docker-compose`** (from ContentForge, isolated instance): `postgres:16` + `redis:7`.
  Optionally `edge-tts` (not required — Fish is primary). This DB/Redis is **separate**
  from the main ContentForge instance at `65.108.6.149`.
- **PM2**, two processes:
  - `hub-web` — `next start` (serves UI + all `/api/*` Next route handlers).
  - `worker-orchestrator` — `node dist/index.js` (script + TTS generation engine).
- **nginx** — already terminates TLS for the domain. Repoint the vhost from the decoy
  (3080/3081) to hub-web's port. Everything (`/` and `/api/`) proxies to hub-web; the
  worker runs headless (no inbound port).
- The old Vite/Express decoy is **parked** (PM2 stop + keep on disk) for instant rollback,
  not deleted.

### 3.2 Data & migrations

Fresh Postgres for this deployment. Run `packages/db` migrations to create the schema
(users, `tutorial_jobs`, `encrypted_secrets`, channels, `tutorial_job_status` enum, etc.).
Seed the three accounts (below). Media root on local disk (or tmpfs) via
`LOCAL_MEDIA_ROOT`.

### 3.3 Accounts & auth (decision: 2 admins + tutorial-scoped VA)

- **Konrad** — `ADMIN`. Full access; owns the secrets vault; provisions credentials.
- **Developer** — `ADMIN`. Full access for maintenance.
- **Lorraine Sabroso** — tutorial-scoped role (`TUTORIAL_VA` per `isTutorialScopedRole`).
  Sees **only** `/tutorial-studio`; cannot reach any other ContentForge tool. She is the
  sole daily operator.

Credential provisioning is done by an ADMIN (Konrad/dev), not by Lorraine. Additional VA
operator accounts can be added later as tutorial-scoped users.

Passwords are real (bcrypt via `lib/auth/password.ts`); logins arbitrary/choosable per
the owner's request. Login page is the app's existing `/login`.

### 3.4 Providers & secrets (the security fix)

All keys live server-side in the encrypted secrets vault (`encrypted_secrets`,
ADMIN-only, resolved via `getSecret`). Nothing reaches the browser.

- **Script LLM (decision: Gemini now, DeepSeek fallback):** primary provider
  `google_gemini` using the existing Google Studio key(s) (`GEMINI_API_KEY`,
  `GEMINI_FALLBACK_API_KEY`); DeepSeek (`deepseek-v4-pro`, `DEEPSEEK_API_KEY`) wired as
  fallback for when that key is available. The provider registry already supports both.
  Note: the prompt stack was tuned against DeepSeek, so we revisit primary once a DeepSeek
  key exists.
- **TTS:** Fish Audio (`FISH_API_KEY`, voice `TUTORIAL_FISH_VOICE`), with the existing
  fallback chain. Health badge probes `/api/health/tts`.
- **Keyword tool:** leave `KT_EMBED_URL` / `KT_EMBED_SECRET` unset → Keywords tab inert.

Infra env (not user secrets): `JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`, the secrets-vault
master encryption key, `LOCAL_MEDIA_ROOT`, `FFMPEG_PATH`/`FFPROBE_PATH`.

## 4. How this resolves the reported symptoms

| Symptom | Resolution |
|---|---|
| Weird/placeholder script | Real tiered prompt stack in the worker; no placeholder path exists. |
| Context not passed | Real create form + preset + title/steps feed the prompt; source modes (from-scratch / transcript-rewrite) supported. |
| No key security | Server-side encrypted vault; browser never sees a key. |
| No auth | JWT sessions + RBAC; tutorial-scoped operator. |
| Fish Audio broken | Real Fish provider + fallback chain + health check. |
| Linear/blocking pipeline | BullMQ queue + Studio board; fire-and-forget jobs. |

## 5. Deployment outline (detailed steps go in the implementation plan)

1. Provision vps1 base (FFmpeg, Node/pnpm, PM2, docker, nginx already present).
2. Clone ContentForge to the box from a committed, building ref (git = source of truth;
   never edit in place — per `DEPLOYMENT.md`).
3. `docker compose up -d postgres redis` (isolated instance).
4. Configure env + seed the secrets vault (Gemini, Fish).
5. Run `packages/db` migrations; seed the 3 accounts.
6. Build + start `worker-orchestrator` (gated `deploy-worker.sh`) and `hub-web`
   (`next build` + `pnpm start`) under PM2.
7. Verify `/api/health` and `/api/health/tts`; queue one test job end-to-end
   (script → Fish audio → READY_TO_RECORD).
8. Repoint nginx vhost to hub-web; park the decoy.
9. Smoke test as Lorraine (tutorial-scoped): can only see the Studio; can queue a job.

## 6. Rollback

The decoy stays on disk and in PM2 (stopped). If the new stack misbehaves, repoint nginx
back to 3080/3081 and restart the decoy. New Postgres/Redis are separate, so nothing about
the main ContentForge instance is touched.

## 7. Phase 2 — client-VPS handoff (later, not now)

Before moving to the client's VPS, carve a tutorial-only build so none of the other
ContentForge tools travel to him: either a trimmed build or a standalone repo containing
only the tutorial-studio surface + worker + required `packages/*`. The client gets build
artifacts + tutorial-scoped access, not the full ContentForge git history. His deployment
gets its own isolated Postgres/Redis and its own secrets.

## 8. Risks & mitigations

- **Shared codebase exposure on your box** — an ADMIN can navigate to other ContentForge
  tools. Accepted while it is your vps1 and your VA; closed by the Phase-2 carve before
  the client move. Lorraine is tutorial-scoped regardless.
- **Leaked/pasted keys** — the `distribution-deploy2` private key was shared in plaintext;
  rotate after deployment settles. Confirm the old leaked `ssh-key-2026-07-10.key` is gone
  from all `authorized_keys`.
- **Resource sizing** — the real stack (Postgres + Redis + hub-web + worker + headful
  upload later) needs the beefier box already discussed; this reinforces the earlier
  hosting conclusion (Hetzner i7 class, not the decoy's assumptions).
- **Drift** — follow `DEPLOYMENT.md`: deploy only from a committed, building ref; rebuild
  `dist` on deploy; never edit `/opt` in place.

## 9. Success criteria

- Lorraine logs in, sees only the Studio, queues a tutorial job.
- Job runs non-linearly: script (Gemini) → Fish audio → `READY_TO_RECORD`, visible on the
  board without blocking.
- No API key is present anywhere in the browser.
- nginx serves the real app on the domain; decoy parked and rollback verified.
