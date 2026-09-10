# Tutorial production recovery — delivery plan

This is the execution checklist for the September 9 operator review. A box may
only be checked after code, a focused regression test, and live acceptance on
the target environment. VPS2 and Omar remain separate tenants: never copy users,
channel mappings, provider secrets, assets, or Drive roots between them.

## 1. Production contract

- [ ] Final review owns the exact video, thumbnail and metadata revision.
- [ ] Approval reserves the next enabled weekly slot for the assigned channel.
- [ ] Automatic delivery is scheduled-publication, not merely a private upload.
- [ ] Audience, monetization and ad-suitability declarations are saved per
      channel and included in every request; the VA is not asked to re-enter
      stable declarations for every video.
- [ ] Emergency pause stops new claims without inventing cancellation of an
      upload already admitted or a video already scheduled at YouTube.
- [ ] Manual VA delivery exposes video, thumbnail, and complete bundle downloads
      plus a clearly unverified "mark uploaded" report.
- [ ] Exact approved masters are retained in Google Drive; verified disposable
      VPS cache may be evicted after upload, not after an arbitrary 90-day timer.

## 2. Channel-group model

- [ ] A primary English/USA channel can own zero or more explicitly mapped
      translated channels. No language is enabled implicitly.
- [ ] Each destination stores its YouTube identity, uploader identity, voice,
      host/avatar references, translation method, thumbnail mode, prompt
      overrides, and enabled state.
- [ ] The language inventory derives from configured voices (currently 17), not
      a hard-coded de/fr/it/sv list.
- [ ] Backfill has an explicit start/cutoff and maximum count, runs through the
      queue, and cannot silently enqueue an entire archive.
- [ ] AI/procedural/both thumbnail mode controls which VA tabs are rendered.

## 3. Thumbnail contract

- [ ] One or two independently positioned headline blocks; four total words is
      a hard limit; text never wraps or clips.
- [ ] Big host, big tightly-bounded logo, big text, simple background, useful
      arrow. Logo artwork scale and optional circle are independent controls.
- [ ] Text contrast derives from explicit light/dark background metadata.
- [ ] Shadows, position, size, rotation, layer order, and symbol mirroring are
      adjustable and persist through save/reload/export.
- [ ] A locale deep link defaults to locale-only edits. Shared edits require an
      explicit choice.
- [ ] Save, approval, matrix status, export, and final review agree on the same
      saved revision.

## 4. Operator experience

- [ ] Final Review lists every pending review, not an 18-hour slice.
- [ ] Language rows are compact: title plus status flags; yellow animates while
      queued/running, red offers Generate missing, green opens locale editor.
- [ ] Workflow settings are separated from per-VA recording defaults.
- [ ] Credentials can be entered and tested in the same Admin area, including
      Fish Audio. Existing user passwords are never recoverable plaintext;
      Admins can set a replacement password.
- [ ] Team presence distinguishes enabled, online, active work, and completed
      counts without loading an unbounded event feed.

## 5. Environment declarations

### VPS2 / Schreiner Content Systems

- Host: `167.233.145.218` (`vps2`).
- Intended hostname: `tutorials.schreinercontentsystems.com`.
- Current DNS must resolve to VPS2 before public TLS acceptance.
- Users: Konrad team only; never Omar, Nalu, or Lorraine.
- AI thumbnails may be enabled only when the configured provider/tunnel health
  check passes.
- Drive and YouTube destinations must be configured for the Schreiner tenant.

### Omar / Axtrelis

- Host alias: `tutorial-vps`; hostname `tutorials.axtrelis.com`.
- Users: Omar (Admin), Nalu, Lorraine, plus explicitly retained test/view users.
- AI thumbnail generation remains disabled; procedural thumbnails stay enabled.
- Drive root ID: `1dq1J2su1zNWS34hkKLXywf-lIrfBxPDS` (`Tutorials Omar`).
- Existing logged-in uploader channel profiles are preserved; no Schreiner
  channel or credential is introduced.

## 6. Release gate

- [ ] Contracts/domain/database builds.
- [ ] Hub and worker type checks plus focused tests.
- [ ] Immutable release per server; build before switching processes.
- [ ] Migrations are additive and backed up first.
- [ ] Health, login, settings, channel group, thumbnail save/approve, review,
      Drive archive, and non-public delivery canary are verified on each tenant.
- [ ] Scheduled-publication is declared operational only after the uploader
      returns provider readback for the exact channel, video, visibility, and
      publication time. A queued request or private upload is not sufficient.
