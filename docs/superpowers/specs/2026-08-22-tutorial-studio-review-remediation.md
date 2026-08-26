# Tutorial Studio — Review Remediation (2026-08-22)

Konrad tested the deployed standalone tool and gave a detailed review. This doc
captures every item + the decisions, so nothing is lost. Standalone tool for a
FRIEND (separate repo, single-tenant-org). "I do not want to see remnants of
Content Forge sitting in here."

## Decisions (from Konrad, 2026-08-22)
- **Accounts (was "Team"):** KEEP. Each VA, each admin, and even viewers get
  their own account (that is what makes per-VA metrics real). Rebuild as
  "Accounts": roles = ADMIN / PRODUCTION_VA / UPLOADER_VA / VIEWER. Strip
  ContentForge team/RBAC flavor (MANAGER etc.). Shrink the giant charts.
- **System Health:** REBUILD LEAN, brand-new, zero ContentForge. "This is
  something entirely new." Show: queue depth, recent failed jobs, provider-key
  presence/validity, disk, Drive status. Drop the provider-registry subsystem.
- **Branding:** remove "Content Forge" / "Pulse Console". Neutral "Tutorial
  Studio" placeholder until friend's brand name is supplied.

## Punch-list
### A. Settings — kill ContentForge remnants + make it complete  [DONE, compiles]
- [x] Removed tiles "Formats & Templates" + "Subtitle Presets"; renamed
      "Team & Access" → "Accounts".
- [x] Credentials list now a tutorial allowlist (shared module
      lib/tutorial/credentials.ts) — deepseek/gemini_direct/openai/fish/ai33/
      google_tts/elevenlabs_official/inworld + Drive(3) + Telegram.
- [x] Google Drive connectable via CLIENT_ID/SECRET/REFRESH_TOKEN credential
      rows + DriveArchiveCard status rendered on Settings.
- [x] Telegram bot token surfaced as a credential row (chat-id + test already
      in Alerts).
- [x] Branding: "Content Forge"/"Pulse Console" → "Tutorial Studio" (sidebar,
      login, tab title). Internal /opt/content-forge/* paths left untouched.

### B. Channels — adding a channel must fully work  [DONE, compiles]
- [x] createChannel now sets accepts_tutorials: true.
- [x] YouTube ID optional (unique placeholder "pending-<uuid>", shows "Not
      linked"); added language selector.
- [x] Channel list counted content_jobs (always 0) → now counts tutorial_jobs.

### C. System Health — lean rebuild  [DONE, compiles]
- [x] Brand-new page: keys-by-kind presence, live queue depth, recent failed
      jobs, disk usage, Drive status. Zero provider-registry / ContentForge.

### D. Accounts (was Team) — rebuild + shrink charts  [DONE, compiles]
- [x] Renamed Team → Accounts (page + sidebar + keybind). Roles Admin/ProdVA/
      UploaderVA/Viewer (dropped MANAGER).
- [x] DELETED the two fabricated components (va-productivity-chart.tsx = mock
      Math.random ContentForge formats; team-kpis.tsx = mock employees + the
      "gigantic" Math.random heatmap). Page is now just the REAL accounts table
      (add-user + real per-user stats) + a link to the Dashboard for metrics.
- [ ] Verify add-user flow end to end on the box.

### STATUS 2026-08-22: A,B,C,D,E,F-ui DEPLOYED + verified live on VPS
All pages 200, no console errors (one expected "Fish Audio DOWN" badge = no key),
zero "Content Forge" text anywhere. hub-web rebuilt on 212.132.103.168, pm2
tutorial-web restarted. Deferred: F per-language voice (worker+db), G polish,
optional /team→/accounts route rename (header breadcrumb still reads "team").

### E. Thumbnails — carry over the OLD facade compositor  [DONE, deployed]
- [x] Ported the offline browser canvas compositor to
      thumbnails/_components/composer.tsx (react-rnd + html-to-image + jszip +
      file-saver; localStorage custom assets; 10-lang ZIP; all asset dirs copied
      to hub-web/public). Default "Composer" tab; AI-generate demoted to optional
      with a banner. Verified rendering a real thumbnail live.
- Old tool = pure browser canvas compositor (react-rnd + html-to-image), works
  fully offline, no infra. Port it in as the REAL thumbnail tool + fallback.
  Assets: DEFAULT_PERSONAS (per-lang PNGs), ALL_APP_LOGOS (71), ALL_SYMBOLS
  (~43), DEFAULT_BGS (4) under public/. Per-channel thumbnailStyle preset.
- New AI-generate section needs Redis+worker+private VEO/VUP/forge servers that
  don't exist on friend's box → keep as OPTIONAL extra (only if AI33 image key
  + MEDIA_ALLOW_AI33_IMAGE), not the primary path.

### F. Localization — automatic, good-looking, per-language voices
- [x] UI (hub-web): flags + native names, live 5s auto-refresh polling while
      anything is pending, aggregate progress bar, and a global "Translate
      everything missing (N)" one-click bulk action. TargetLanguage gained `flag`.
- [ ] PER-LANGUAGE VOICE (worker + db) — DEFERRED to a focused pass (cross-
      package, needs worker+db rebuild): add getVoiceForLanguage(db, code)
      (active tts_voices where language=code), wire into worker translate.ts
      synthesizeTranslatedTts (resolve by target language first, fall back to
      source/channel voice). Friend tags a voice per language in Settings →
      Voices. Also verify that UI exists / is adequate.
- [ ] De-dup language list (enqueue route + worker still hardcode de/fr/es/ja/ko).
- Personas/avatars per language = phase 2.

### G. Cross-cutting
- [ ] Wrong icons — audit material-symbols names.
- [ ] Sizing sweep: shrink oversized controls across pages.
- [ ] Light mode deep sweep.

## Execution order
A (settings) → B (channels) → C (system health) → D (accounts) → E (thumbnails)
→ F (localization) → G (polish). Build green per batch; deploy to VPS after a
meaningful set; Konrad tests before shipping to friend.
