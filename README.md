# Tutorial Studio 🎬

A single-tenant, self-hosted **production line for YouTube tutorial videos** — from keyword to a
Google-Drive-delivered video, thumbnail, and localized versions. Built for teams of virtual
assistants (VAs) producing at high volume, with a clean split between the **VA daily cockpit** and
the **owner/admin configuration surface**.

> Standalone React + Vite workstation. No external services required to run the UI — provider API
> keys are entered in-app (Settings → Credentials) and everything persists locally.

---

## Pipeline

```
Keyword  →  AI Script  →  Neural Voice  →  Screen Recording  →  Splice  →  Thumbnail  →  Translations  →  Google Drive
```

## Highlights

- **Keyword engine** — discover new candidates from Google/YouTube autocomplete, opportunity
  scoring & ranking, AI screening (verdict + content type + angle), dedup/clustering, saved filter
  presets, CSV import/export, and claim-to-produce routing.
- **Creator conveyor** — 5-step guided flow (topic → script → voiceover → recording → review) with
  AI script generation, in-browser screen recorder, teleprompter, and dispatch.
- **Thumbnail studio** — drag-resize editor, AI generation, 111 symbols / 70 app logos / language
  persona packs / reference archetypes, channel style presets, PNG + multi-language ZIP export.
- **Adjustable without code** — the **Admin → Config** page controls video length presets, playback
  speed, content-type mix, topic/software focus, keyword filters & score weights, standard
  languages, VA production targets, and white-label branding (product name + accent color).
- **Roles** — capability-based access. VAs get Produce / Keywords / Thumbnails / Library / their
  Metrics; admins additionally get Config, Settings, API keys, team management, and backups.
- **Tracking** — production metrics computed from real records, per-VA targets with daily/weekly
  progress and observed peak-capacity, channel distribution, and delivery log.
- **Localization** — batch-translate scripts + metadata into a configurable standard language set.
- **Dual theme** — DaVinci-dark / editorial-light, reactive store, and a consistent design system.

---

## Run it

The standalone app manifest is `package.facade.json` (the root `package.json` is a separate
monorepo). Use it as your `package.json` when packaging the standalone, then:

```bash
# install
npm install

# dev (frontend on :3000, optional helper backend on :3001)
npm run dev          # vite
npm run server       # node server/index.js   (optional: Drive/localization helpers)

# production build (static bundle in dist/)
npm run build        # tsc && vite build
npm run preview
```

## Configuration

- **Provider keys** (LLM script/translation, TTS, thumbnails, Google Drive) are entered in the UI at
  **Settings → Credentials** and stored locally. See `.env.standalone.example` for optional
  server-side environment configuration.
- **Behavior** (lengths, filters, topics, targets, branding) is edited live in **Admin → Config** —
  no code changes required.
- **Backup / restore** the whole workstation from **Settings → Backup**.

## Notes on scope

This workstation is a self-contained control surface. Voiceover, translation, and Google Drive
delivery become fully live once the relevant provider keys (and, for real Drive uploads, the helper
backend) are configured; without them the app clearly labels placeholder/simulated output rather
than presenting it as real. It is single-tenant and self-hosted — role selection is a workstation
switch, not authenticated multi-tenant login.
