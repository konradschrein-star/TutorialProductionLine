# Tutorial production recovery — explicit delivery declaration

Declared at 2026-09-09 after candidate 21 deployment, production reset, clean
regeneration, and live browser acceptance.
"Delivered" below means the code is present in the stated environment and the
listed acceptance check passed. It does not mean an external provider action
was inferred from a queue entry.

Candidate 21 artifacts:

- Linux/amd64 image ID:
  `sha256:576dba56df65e770cb41a0533bad1100201843056a78332745bcee8b24e14ab1`
- Image tar SHA-256:
  `E563D5FEF1FD2F2391F0CEAD4A7643D5A8B69FD668D217E5196514B0FE84778D`
- Omar runtime tar SHA-256:
  `5B9AA6D7F2625206EE7827C1362A55236EE00CD256B0EABC18E693B507196C5B`

## DELIVERED — shared application

- The VA flow, Admin/VA navigation split, all-pending review queue, compact
  locale status rows, configurable channel groups, per-user recording defaults,
  API credential controls, weekly content calendar, and 30/day/channel default.
- Manual/procedural thumbnails with one to four independently editable headline
  hitboxes, a hard four-word total approval limit, per-hitbox maximum-size fitting,
  draggable/resizable layers, shadows, mirroring, optional logo backing circle,
  independent logo-art scale, light/dark contrast rules, and a missing-logo
  replacement marker.
- Four reference-driven layouts now enforce the simple composition: large host,
  large text, large product logo, quiet background, and an arrow that targets the
  logo. Procedural worker output uses the same structure and samples the text
  region to choose yellow on light backgrounds or white on dark backgrounds.
- Manual, AI, or both thumbnail mode per channel profile. AI selection/fan-out
  and quality/retry contracts are implemented, but activation remains an
  environment-specific declaration below.
- Approval/revision fencing, exact artifact revisions, bounded localization
  backfill, delivery downloads, emergency admission pause, and configurable
  audience/monetization/visibility fields.
- Live browser acceptance previously verified one-to-four line controls, a
  three-line four-word composition without clipping, the dynamic two-language
  matrix, and embedded Keyword Admin access.
- Tutorial Studio now exposes both the Keyword Tool VA board and, for Admin or
  Manager roles only, its existing Admin Console inside the Software & topics
  page. The signed iframe handshake is configured and passed live browser use.
- Software & topics now also provides a native `CSV & manual intake` path that
  does not depend on the separate Keyword Tool. It supports an editable preview,
  a downloadable template, per-row or default channel assignment, complete
  batch validation before mutation, row-level errors, and a 200-row limit.
  `keyword` is required; `channel`, `steps`, `reference_url`, `mode`, and
  `source_mode` are optional. Native references cannot be sent back to the
  Keyword Tool status webhook.
- Thumbnail copy now removes the represented product name and generic product
  qualifiers when a product logo supplies that context. Connector-only words
  such as `&`, `+`, `and`, and `or` are removed rather than left dangling.
  Default text sizing maximises each line inside its own safe
  hitbox up to 220 px; choosing a manual font size disables auto-fit for that
  layer.
- Candidate 21 Hub type-check and production image builds passed. The complete
  regression runs passed 712 Hub tests, 530 worker tests, and 37 database tests.
  Git whitespace validation also passed.

## DELIVERED — Omar / tutorials.axtrelis.com

- Candidate 21 is live from
  `/opt/tutorial-review-omar-20260909-final-c21/app`.
- `tutorial-web`, `tutorial-worker`, and `tutorial-drive-uploader` are online.
  The existing `tutorial-uploader-exchange` remained on PID 461644 and was not
  replaced by the release.
- The pre-candidate-21 database backup is
  `/var/backups/tutorial-omar-pre-candidate21-20260909/database.dump` with SHA-256
  `680680d3ce2709a7f5db90d75dc2792cc82c817dfd8a5784c7f7bf921779b381`.
- Public `/api/health` reports healthy database, Redis, queues, workers, and
  disk checks.
- AI thumbnail generation is explicitly disabled. Procedural generation remains
  enabled.
- Omar has English as the source language and German, French, Italian, and
  Swedish as active translation destinations. Dutch remains disabled.
- Omar's Drive root remains `1dq1J2su1zNWS34hkKLXywf-lIrfBxPDS`.
- The Drive uploader and dedicated uploader exchange are online. Existing
  exchange logs contain successful published bundle and ingested receipt passes.
- The account merge is complete: 18 duplicate/unwanted records were removed
  after backup and 8 intended users remain. Existing password hashes were
  preserved. The deleted records are recoverable from
  `/var/backups/tutorial-omar-user-merge-20260909/tutorial_studio.dump`.
- The thumbnail reset is complete. Forty-seven old thumbnail artifacts were
  deleted from Drive, 1,502 unreferenced thumbnail rows were removed, and 16
  rows referenced by uploader receipts were retained only as audit evidence.
  The exact pre-reset database and thumbnail tree remain recoverable under
  `/var/backups/tutorial-omar-thumbnail-reset-20260909-c20`.
- Clean regeneration produced 913 selected thumbnails: 369 English and 136 each
  for German, French, Italian, and Swedish. It completed with zero failures.
  All 1,910 tutorials are unapproved.
- Regenerated thumbnail artifacts are intentionally local/pending while every
  tutorial is unapproved. The Drive approval fence has not been bypassed; the
  existing 1,752 uploaded final-video artifacts were left unchanged.
- Live browser acceptance on the final production hostname verified persistent
  navigation, EN/FR/IT/DE/SV selection, six layouts, Shapes, expanded comparison
  and headline panels, per-user settings, channel/language settings, per-channel
  template/background controls and bulk asset intake. No tutorial was saved,
  approved, or queued by this check.

## DELIVERED — VPS2 / Schreiner staging

- Candidate 21 is deployed as
  `tutorial-recovery:20260909-candidate21` and healthy on
  `127.0.0.1:3118`.
- The web container is the only Tutorial Studio application process enabled.
  PostgreSQL and Redis stay on the internal Docker network.
- The pre-candidate-21 database backup is
  `/opt/tutorial-recovery-staging/snapshots/pre-candidate21-20260909/database.dump`
  with SHA-256
  `e3e6d9277a724b6cc8d9badfa4844b22a2bae0a7157ca073b29faf1b556b3f63`.
- Drive access, YouTube/publication workers, automatic delivery, retention, and
  VeoForge image generation are explicitly disabled until tenant-specific
  destinations and provider health are verified.
- Caddy has a validated route for `tutorials.schreinercontentsystems.com` and is
  attached to the web access network.

## NOT DELIVERED / NOT CLAIMED

- The VPS2 hostname is not public yet. Its authoritative nameserver currently
  returns `65.108.6.149`, not VPS2 `167.233.145.218`. The record must be changed
  at the actual DomainRegistry/Northwest Business Identity DNS authority; the
  Vercel DNS record is inert because Vercel is not authoritative.
- Scheduled YouTube publication is not declared operational. The present direct
  uploader supports private/unlisted delivery, but exact schedule-to-public is
  gated until the connector returns provider readback for channel, video,
  visibility, and publication time.
- No fresh YouTube canary was dispatched during this release because seven prior
  dispatches are in an uncertain state. Blind retry could duplicate videos.
- Omar's Google Drive credentials still resolve from the existing environment
  fallback. The Admin credential UI can accept/test replacements, but migrating
  these live secrets into it is not claimed as complete.
- VPS2 Drive, channel, uploader, and VeoForge credentials were not copied from
  Omar. This is intentional tenant isolation, not a missing deployment step.
- The recovered Keyword Tool candidate has safer screening-cache rules and hides
  unscreened research by default, but that separate service candidate is not yet
  deployed to VPS2 and commercial keyword quality is not declared solved. No
  paid rescreen or manually-labelled recommendation acceptance set was run. The
  current live Admin Console is now accessible inside Tutorial Studio for that
  supervision.
