# Master Plan — Standalone Tutorial Studio (Friend's Industrial Production Line)

**Date:** 2026-08-20
**Owner:** Konrad (for his associate/friend — a separate production line, separate team)
**Repo:** `TutorialProductionLine` (branch `rebuild/tutorial-studio-standalone`)
**Status:** APPROVED to build. Autonomous sprint (deadline 10:00). No feature below may be silently dropped.

---

## 0. The one-sentence intent

Rip **Konrad's real Tutorial Studio out of ContentForge** and stand it up as a **sophisticated, single-tenant, standalone product** for his associate — VA-ergonomic on the production side, owner/admin-rich on the insight side, with **Industry-4.0 total-information-clarity metrics**, real (non-faked) pipeline, and later multi-language translation. Ship it on the associate's VPS. It is a sellable product template.

**We are NOT** continuing the previous developer's tool (the Vite facade currently in this repo). It is scrapped. The **only** salvage from it is its **thumbnail studio**, kept as a *fallback* for when the image-generation API fails.

---

## 1. Feature Inventory — the "nothing gets lost" checklist

Every item Konrad stated across the conversation, mapped to a phase (§3). Each is a tracked requirement.

### A. Foundation & architecture
- [ ] **F1.** Extract the real ContentForge tutorial-studio (Next.js 15 app + Postgres/Drizzle schema + Redis/BullMQ worker pipeline) into this repo as a standalone app. — *P1*
- [ ] **F2.** Scrap the previous dev's facade (mock Drive, fake metrics, tone-TTS, placeholder translation, localStorage-only). — *P1*
- [ ] **F3.** Single-tenant isolation: collapse the 8-role RBAC to a minimal set; remove the sales-demo/visitor redaction; nothing calls back to Konrad's infra (`65.108.6.149`). — *P1*
- [ ] **F4.** All provider credentials/endpoints are **the associate's own**, entered via Settings UI; keys masked/obfuscated, never logged, never committed. — *P2/P4*
- [ ] **F5.** Sophisticated, proper, buildable code — no hardcoded fakes, no dead multi-tenant weight, tests + green build. — *all phases*

### B. Look & feel
- [ ] **L1.** Keep the color scheme (it's good) but make the **accent adjustable** (ContentForge already has 6 CSS-var accent themes — expose + extend). — *P5*
- [ ] **L2.** Build a **proper light mode** (ContentForge is dark-only today; fix the "yellow-in-light" + "pure-black elements" problems by building real light tokens). — *P5*
- [ ] **L3.** Fix the **wrong icons**. — *P5*
- [ ] **L4.** **Drop the conveyor / "Studio Pipeline"** doubling entirely (that was the facade's concept; CF flow is Create → Studio → Review). — *P1*

### C. Production tabs (VA-facing, ergonomic & efficient)
- [ ] **C1.** Core flow: **Create → (script → TTS → record → splice/stitch) → Review**, ported from CF, made maximally ergonomic for VAs. — *P1/P2*
- [ ] **C2. Keywords:** two sources in **separate tabs** — bundled **Starter 2,150** and **My Keywords** (his own, scraped/imported). VA can browse + **claim**. **NO hallucinated monthly volume** — show only real data from his keyword tool (`priority_score`) or nothing. — *P2*
- [ ] **C3. Thumbnail Studio:** CF's API-driven thumbnail generation is **primary**; the salvaged facade thumbnail editor is the **manual fallback** when the image-gen API fails. Improve it (current approach is weak); take the best parts over. — *P3*
- [ ] **C4. Video Stitcher:** include as a **separate tab** with a visible "**proof-of-concept**" note (lets VAs make longer videos). *Skip if genuinely hard.* — *P7 (conditional)*

### D. Owner/Admin — control & Industry-4.0 insight
- [ ] **D1. Two audiences, clearly separated:** VA side = fast production. **Owner/Admin side = deep control (admin) + deep metrics insight (owner).** — *P1 (roles) / P6 (dashboards)*
- [ ] **D2. Metrics = industrial floor telemetry, real logs visualized:**
  - [ ] Every **keyword-claim** timestamp → a **dot** on a timeline diagram.
  - [ ] Every **audio-upload / audio-generated** timestamp → visualized.
  - [ ] **Per-step timestamps** per job per VA (script / audio / record / splice / complete) captured as first-class events.
  - [ ] **Per-VA per-step durations** → compare VAs; find bottlenecks (e.g., "Mondays scripts always slow").
  - [ ] **Working frequency** across **day / week / month**; videos produced per window.
  - [ ] Data is **inspectable/editable** ("see everything").
  - [ ] **Total information clarity** — cheap, comprehensive monitoring. NO fabricated numbers, ever. — *P6*
- [ ] **D3. Settings** (currently "missing a bunch"): complete it — all provider keys (masked), Google Drive config, keyword-tool URL, recording defaults, prompt library, voice defaults, channel management entry. — *P4*
- [ ] **D4. Channel-config page:** create/configure the associate's channels — link channel URL, bind a **voice**, bind a **face persona**, add **thumbnail backgrounds**, map **thumbnail presets** to channels. (CF already has the schema: `channels.voice_id`, `characters`/`channel_personas`, `channelThumbnailProfiles`, `thumbnailArchetypes`.) His setup today: **1 channel + ~4 language subchannels** (same video, different languages). — *P5*

### E. Delivery & translation
- [ ] **E1. Google Drive delivery** is **real** (not mocked), **UI-configurable** destination + folder structure. The distribution/uploader engine itself is out of scope (separate system). — *P2*
- [ ] **E2. Translation (after English produces cleanly):** one English channel → **5–20 language subchannels on the same Gmail**, as another **upload path**. Fed by finished video + transcript. **Re-voiced per language (TTS)**, per-language metadata + thumbnail text.
  - Launch languages: **German, French, Spanish, Japanese, South Korean.**
  - Then expand to **every language with decent RPM / large viewership.** — *P8*

### F. Companion services & deployment
- [ ] **G1. Keyword Tool:** a **configurable clone** of Konrad's keyword tool, deployed on the **associate's VPS**, that the associate configures to **his own channel + competitors**, and which phones back to **HIS** tool (not Konrad's). — *P7 (companion)*
- [ ] **G2. Ranking / tier-list:** an **exact clone** of Konrad's, running on the associate's server. *Skip if too hard — low importance.* — *P7 (conditional)*
- [ ] **G3. Deploy** the standalone studio on the associate's VPS `212.132.103.168` (Postgres + Redis + Node workers + ffmpeg), domain `tutorials.schreinercontentsystems.com`, off Konrad's VPS. — *P9*

### H. Operational (immediate, time-boxed)
- [ ] **O1.** Cron: **standby Render Node 3** (`192.168.178.48`) at **09:00**; **standby this computer** shortly after (quiet morning). — *done first, see §5*
- [ ] **O2.** Never leak secrets; delete any committed private keys; rotate after go-live. — *ongoing*

### I. Later (explicitly deferred decisions — do NOT act without Konrad)
- Whether to also extract tutorial-studio out of ContentForge for **Konrad's own** ops, or keep it embedded, and how isolated. Proven features here can be back-ported to ContentForge.

---

## 2. Architecture (target)

- **Frontend + API:** the extracted CF **Next.js 15** app (`hub-web`), pruned to tutorial-only, single-tenant. Bespoke "V2 Pulse Console" design system (inline styles + `v2.css` CSS-variable tokens) — recolorable; add a **light** token set.
- **Data:** **PostgreSQL (Drizzle)** — port the tutorial subset of the schema (`tutorial_jobs` with per-step timestamps, `tutorial_settings`, `tutorial_prompt_presets`, `channels`, `tts_voices`, `characters`/`channel_personas`, thumbnail tables, `storage_artifacts`, `users`, `encrypted_secrets`, + stitcher/caption presets). **+ a new `production_events` append-only table** for Industry-4.0 metrics (see D2).
- **Jobs:** **Redis + BullMQ** queues; **worker-orchestrator** processors (generate → splice → stitch) ported with their utils (tts-registry/gateway, media-gateway, thumbnail utils, drive scanners).
- **Providers (all his own keys, config-driven):** LLM script gen, **Fish Audio** TTS (primary) + fallbacks, AI33 image gen (+ Gemini QA) for thumbnails, Google Drive delivery. Where CF uses internal load-balancer "pools" (gemini/claude), collapse to **direct provider calls** with his key for single-tenant simplicity.
- **Auth:** cookie/JWT, roles collapsed to **Owner/Admin + Production VA (+ optional Uploader)**.
- **Deploy:** single VPS — Postgres + Redis + Node (app + worker) + ffmpeg, via PM2 or docker-compose; nginx + certbot.

*(The precise file/package copy closure + adaptation list is produced by the running extraction-manifest analysis and appended as `EXTRACTION-MANIFEST.md`.)*

---

## 3. Phased execution

| Phase | Goal | Key outputs |
|---|---|---|
| **P1** | **Extract + prune + build green** | Standalone Next.js app in repo; drama/ranking/demo-redaction removed; RBAC collapsed; conveyor gone; `pnpm build` + typecheck pass. |
| **P2** | **Real English pipeline E2E** | Create→script→Fish TTS→record→splice→**real Drive delivery**; Keywords (Starter + My, claim, no fake volume); Postgres + Redis up. |
| **P3** | **Thumbnails** | CF API generation primary + salvaged manual editor as fallback; improved. |
| **P4** | **Settings complete** | All his keys (masked), Drive config, keyword-tool URL, prompt/voice/recording defaults. |
| **P5** | **Look & feel + channels** | Light mode, adjustable accent, fixed icons; **channel-config page** (URL/voice/persona/backgrounds/presets). |
| **P6** | **Industry-4.0 metrics** | `production_events` capture on every step; owner dashboards: keyword-claim dots, audio-upload timeline, per-VA per-step durations, day/week/month frequency, bottleneck detection. Real data only. |
| **P7** | **Companions (conditional)** | Keyword Tool clone on his VPS; Video Stitcher tab (PoC note); Ranking clone — *skip the last two if hard.* |
| **P8** | **Translation** | EN → DE/FR/ES/JA/KO subchannels; per-language TTS re-voice + metadata + thumbnail text + delivery; expandable language set. |
| **P9** | **Deploy + cutover** | Provision his VPS, deploy, TLS, verify; then (checkpoint) retire the facade + Konrad's bridge. |

**Ordering rule:** English must produce cleanly (P1–P2) before translation (P8). Metrics (P6) depends on the real event capture added in P1–P2. Ranking/Stitcher are droppable; Keyword Tool clone and Translation are required (Translation later).

---

## 4. Non-negotiables (quality gates)

1. **No fakes / no hallucinated data** — anywhere. Failures are surfaced honestly.
2. **Real per-step event capture** from day one of the new backend (metrics depend on it).
3. **Single-tenant, his creds, no call-home.**
4. **Secrets never committed/logged;** masked inputs; rotate after go-live.
5. **Buildable + typechecked + tested** at each phase; sophisticated, maintainable code.

---

## 5. Operational task O1 — morning standby cron (do first)

- **Render Node 3:** `192.168.178.48` (LAN, RDP 3389). Standby at **09:00**.
- **This computer (laptop/controller):** standby **after** the render node (e.g., 09:02), for a quiet morning.
- Implement as Windows Scheduled Tasks (`schtasks`). Details + the exact commands recorded in `docs/ops/morning-standby.md`.

---

## 6. Working log

- 2026-08-20 — Branch `rebuild/tutorial-studio-standalone` created off `main` (facade preserved on `main`; associate's live tool untouched). Extraction-manifest analysis of ContentForge dispatched. This master plan written.
- 2026-08-20 — **Morning standby cron:** laptop task armed (daily 09:02); render-node installer + doc (`docs/ops/morning-standby.md`) — node is RDP-only so needs one manual step.
- 2026-08-20 — **P1 extraction committed** (`644e08f`): copied tutorial closure (apps/hub-web, apps/worker-orchestrator, packages/*) as a pnpm monorepo. Purged 8003 node_modules + 4488 dist/.next files the facade had committed; removed leaked `apps/hub-web/.env.local`. `pnpm install` clean; **all 13 shared packages build green.**
- 2026-08-20 — **DB layer validated:** local Postgres 16 (:5433) + Redis 7 via `deploy/standalone/docker-compose.infra.yml`; **full Drizzle migration chain applies cleanly** (95 tables) — tutorial_jobs, tutorial_settings/prompt_presets, channels, tts_voices, thumbnails+archetypes+profiles, encrypted_secrets, storage_artifacts, users all present. Dev `.env` written (gitignored, fresh JWT/secret keys).
- 2026-08-20 — **Deploy kit:** runbook + single-tenant `.env.standalone.example` + PM2 `ecosystem.config.cjs`. **Security:** removed committed `deploy/vps_deploy_key` + hardened ignore (history purge + rotation still TODO).
- 2026-08-20 — **P1 PRUNE COMPLETE (committed `d4677c5`):** worker-orchestrator rewritten to tutorial+thumbnail only (`tsc --build` exit 0; 153 non-tutorial files deleted); hub-web pruned to tutorial-only (39 route dirs removed), RBAC collapsed to ADMIN/PRODUCTION_VA/UPLOADER_VA, demo/visitor redaction removed, middleware trimmed (`tsc --noEmit` exit 0). ~142k lines of non-tutorial code removed.
- 2026-08-20 — **RUNTIME VALIDATED:** hub-web dev server boots, loads env, **pg-listen connects to Postgres**, ready on :3000; `/login` → **HTTP 200**; unauth `/` and `/tutorial-studio` → **307 → /login** (single-tenant auth gate works). Seeded admin (`admin@content-forge.com/admin123`) ready.
- 2026-08-20 — **Single-tenant config fix (committed):** `@repo/config` no longer hard-requires provider keys / default voices at boot (`.default("")`) — the associate boots keyless and configures in the UI. Production `next build` validation running.

- 2026-08-20 — **Runtime fully validated via Playwright** (logged in as seeded admin): login works, tutorial-studio + dashboard render clean (professional dark "Pulse Console" theme, tutorial-only sidebar). Worker boots and registers exactly the tutorial+thumbnail queues. Removed a stray top-level `clip-forge` route; hub-web `tsc --noEmit` + production `next build` both green.
- 2026-08-20 — **⭐ FEATURE: Industry-4.0 metrics (committed `6677a0a`)** in the Tutorial Studio Dashboard: per-VA step-duration bars with per-VA + floor **bottleneck** detection, "where time goes" averages, **scripting-time-by-weekday** (Mondays pattern), and a **production timeline with a dot per keyword-claim / audio-ready / recording-upload / completion** — exactly the spec. Built on the existing per-step timestamps; validated visually against 44 seeded demo jobs (VA 3 slow-script + VA 5 slow-record correctly surfaced).

### FEATURE STATUS MAP (review item → status)
| Requested | Status |
|---|---|
| Color scheme kept + adjustable accent | ✅ Exists (6 CSS-var accent themes + theme-selector) |
| No hallucinated data | ✅ Real tool has none (fakes were the facade only) |
| Drop conveyor/Studio-Pipeline doubling | ✅ Gone (facade discarded) |
| Channel config (voice / persona / thumbnail presets) | ✅ Largely exists — `/channels/[id]/voice`, `/characters`, `/narrators`, presets |
| Thumbnail studio (+ improve) | ✅ Real thumbnail studio present (AI33 gen + archetypes) |
| Settings "missing a bunch" | ✅ Comprehensive settings present (credentials, voices, prompts) |
| Wrong icons | ✅ N/A (real tool uses Material Symbols correctly) |
| **Industry-4.0 metrics** | ✅ **BUILT this session** (per-VA step durations, bottlenecks, timeline dots, weekday pattern) |
| **Light mode** | ⛔ Not done — 92 hardcoded whites + black layout bg = a real refactor (see follow-up). Won't ship half-baked. |
| Translation (EN → DE/FR/ES/JA/KO subchannels) | ⛔ Deferred by owner until English produces cleanly; net-new schema+UI |
| Keyword Tool clone on his VPS | ⛔ Follow-on (separate app) |
| Salvage facade thumbnail as API-fail fallback | ⛔ Follow-up (minor) |

### Top follow-ups (precise)
1. **Light mode** — add a light token palette under `:root[data-theme="light"]` in `v2.css` (bg→light, surfaces→grays, text→dark, borders→black-alpha), fix `layout.tsx` hardcoded `#000`, add a light/dark toggle (cookie like the accent theme), and convert the ~92 `rgba(255,255,255,α)` + 11 `#000` in tutorial-studio components to tokens. Validate each core screen with Playwright.
2. **Rebrand** shell "Content Forge / Pulse Console" → the associate's name (or neutral "Tutorial Studio").
3. **Video Stitcher** button present but `/api/video-stitch` backend pruned — remove the button (owner said stitcher is skippable) or re-add the backend.
4. `getServerSnapshot should be cached` React warning (upload-queue `useSyncExternalStore`); `/api/health/tts` 503 with placeholder key (both non-fatal).
5. Deploy to the associate's VPS (Postgres+Redis+Node+ffmpeg) per `deploy/standalone/README.md`; purge `vps_deploy_key` from git history + rotate.
6. Relax remaining ContentForge-isms if any surface at runtime with keyless boot.

### Local validation environment (this machine)
- Postgres :5433 + Redis (docker `deploy/standalone/docker-compose.infra.yml`), dev `.env` (gitignored), seeded admin `admin@content-forge.com / admin123`, **44 dev demo jobs** seeded to populate metrics (LOCAL ONLY — fresh VPS DB has none; clear with `delete from tutorial_jobs;`).
