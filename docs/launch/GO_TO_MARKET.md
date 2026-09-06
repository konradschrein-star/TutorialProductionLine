# Tutorial Studio — Go-To-Market Brief

## What it is
A self-hosted, single-tenant **production line for YouTube tutorials**: keyword → AI script →
neural voiceover → screen recording → splice → thumbnail → translations → Google Drive. Run by a
team of virtual assistants; fully configured by the owner from the UI.

## Positioning
**"From keyword to uploaded video — your team runs it, you control it."**
The self-serve production line for high-volume tutorial channels, where the owner adjusts every
knob without touching code.

## Target customer
Agencies and creators running one or more tutorial channels with a team of VAs, who need
throughput, consistency, per-VA tracking, and owner-level control over topics, filters, lengths,
and branding — and don't want to depend on a developer to change how the machine runs.

## The problem we solve
Tutorial channels stall on process: shallow manual keyword research, inconsistent scripts,
time-sink thumbnails, ad-hoc translations, no visibility into VA output — and every workflow change
means bugging a developer.

## Pillars → proof
1. **Keyword engine** — Google/YouTube autocomplete discovery, opportunity scoring, AI screening, clustering, saved presets, claim-to-produce.
2. **Guided production** — 5-step conveyor + async studio pipeline; teleprompter, in-browser recorder, dispatch.
3. **Thumbnail studio** — drag-resize editor, AI generation, 100+ symbols / app logos / persona packs, channel presets, PNG + multi-language ZIP.
4. **Adjustable without code** — one Config page controls lengths, filters, topics, content mix, score weights, languages, VA targets, and white-label branding.
5. **VA vs Admin** — capability-based roles; VA daily cockpit vs owner console; optional admin access PIN.
6. **Tracking & targets** — honest per-VA output, daily/weekly targets with progress, observed peak capacity.
7. **Localization** — batch-translate scripts + metadata into a configurable language set.

## Differentiators
- **Owner-configurable end to end** — no developer in the loop.
- **Honest by default** — placeholder/simulated output is labeled, never faked (no false "Uploaded to Drive", no tone-as-narration, metrics computed from real records).
- **Self-hosted single-tenant** — your keys, your data, your instance.

## Launch assets
- **Landing page** — published (private artifact; share from the artifact page when ready).
- **Launch video script** — `docs/launch/LAUNCH_VIDEO_SCRIPT.md` (~75s walkthrough).
- **In-app Guide** — reconciled to the real feature set; deep-linkable sections.
- **Quickstart** — `README.md` (install, run, configure keys, set config, add VAs).

## Honest scope (say this plainly)
Ships as a **self-hosted single-tenant** product — the intended model, and independently reviewed
as ship-ready for it. To offer it as a **multi-tenant hosted cloud** later, three things are
required first: real authentication (so roles can't be self-granted), a server-side provider-key
proxy (keys currently live client-side), and per-tenant data isolation. These are a deliberate
next phase, not blockers for the single-tenant launch.

## CTA
"Deploy your studio" — self-hosted, single-tenant.
