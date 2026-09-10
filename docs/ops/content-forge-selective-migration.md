# Content Forge → isolated Tutorial Studio migration readiness

Read-only inspection during the current recovery session.
Source access used the existing `cf-vps-deploy` SSH profile with strict host-key
checking, then read-only metadata/aggregate SQL in `content-forge-postgres` /
`content_forge`. No source files, database rows, processes or credentials changed.
No actual password hash, email, credential value, database dump or source row was
exported. Source production remained active, so counts are a moving observation,
not a consistent final migration snapshot.

## Critical findings

- Source accounts: 14 bcrypt-format hashes; active roles include 5 TUTORIAL_VA,
  3 ADMIN and 6 accounts across MANAGER, VIEWER, DRAMA_OPERATOR, INVESTOR and
  TUTORIAL_VISITOR. Preserve roles and UUIDs; do not promote the other roles.
- 2,285 tutorial rows had no channel. Do not route historical output using a VA's
  current default. Completed/cancelled unmapped output stays read-only history;
  active unmapped work needs an explicit Admin routing worklist.
- Source languages mix `English`, `en`, and NULL. Normalize the known alias
  `English` → `en`; NULL stays unknown until explicitly resolved.
- 458 jobs reference `parent_job_id`; 35 carry stitch references. Those are old
  segment/stitch workflows, not new localized children. Preserve them as archive
  data rather than pretending they are supported current production stages.
- Source localization uses `tutorial_derivatives`, not `tutorial_jobs.source_job_id`.
  It contains completed/failed/rendering rows in ja/zh/ko/no/de. Its shape lacks
  new destination assignment, metadata and approval provenance. Archive the raw
  derivative and its exact source relationship before any future transformation.
- All three tutorial-enabled source channels have valid existing voice FKs.
  Preserve those voice rows and identifiers. Source defaults are `deepseek` and
  `fish_audio`; preserve them rather than replacing them with target defaults.
- Source settings enable Drive auto-upload. Staging must override execution
  controls to disabled while preserving the original configuration in protected
  migration audit data. Existing delivery flags do not prove public publication.
- Source has 34 provider registry rows and provider capability-link configuration.
  Provider credentials live in environment configuration, not a usable source
  `encrypted_secrets` export. Copying only database settings cannot preserve them.

## Concrete schema mapping

| Table / source feature | Target difference | Safe handling |
| --- | --- | --- |
| `users` | Target adds `last_seen_at`, `online_seconds_total`; drops `youtube_cookies_*` columns | Copy explicit identity/account columns and exact bcrypt bytes; initialize presence normally, never fabricate activity. Do not repurpose cookie ciphertext as provider keys. |
| `channels` | Source lacks `is_primary`, `uploader_channel_key` | Admin-confirm which tutorial English channels are primary; preserve UUID, language, metadata and voice FK. Uploader keys stay NULL until explicitly mapped. |
| `channels.clip_library_id` | Source has a FK to the wider CF clip library; target schema does not enforce the same dependency | Keep the original pointer in audit data. Do not import unrelated library/media trees merely to make a pointer appear resolved. |
| `tutorial_settings` | Target adds thumbnail generation mode/background rotation/persona rotation | Preserve existing voice/model/speed/hotkey/default_voice_settings. Choose procedural defaults explicitly for the new system, not as proof that source had procedural assets. |
| Source settings `silence_cap_enabled`, `silence_cap_max_ms`, `silence_cap_threshold_db`, `derivative_config` | Not implemented in current target settings | Preserve raw source values in protected audit; mark unsupported behavior for explicit acceptance. Do not silently claim feature parity. Source silence-cap is currently disabled. |
| `tutorial_jobs` | Target adds `source_job_id`, short thumbnail copy, manual/upload lifecycle fields, `publication_approval`, `localization_source_revision` | Source jobs remain originals/legacy segments as actually recorded. New approval/provenance, reservations and verification fields stay NULL. `is_uploaded=false` is unknown/unverified, not a statement that no historical upload ever happened. |
| Source jobs `intro_enabled`, `intro_mode`, `intro_config`, `intro_hook_text`, `intro_audio_path`, `intro_video_path`, `intro_status`, `intro_error` | Absent from target job table | Archive source rows losslessly before projection. Final videos keep their baked-in intros; regeneration parity is not implemented. |
| `tutorial_derivatives` | No corresponding target table / different localization model | Archive unchanged with source UUID and status. Do not invent source revision, destination, voice, metadata or final-review approval. |
| `tts_voices` | Shared shape, provider names include Fish/Minimax/ElevenLabs/Edge aliases | Preserve UUID, provider, provider voice ID, language and settings exactly; validate runtime adapter resolution, not just existence. |
| `providers`, `provider_capability_links` | Separate from runtime credential values | Preserve relevant provider key, capabilities, base URL and ordering only after schema comparison. Transfer required secret values through a protected server-to-server channel, never stdout or synced directories. |
| `tutorial_prompt_presets` | Shared shape; creator FK | Preserve UUID, full prompt, category and default flag. Validate each job's referenced preset. |
| `thumbnails` | Depends on channel/archetype/bookmark/parent; subject references are polymorphic | Import only tutorial-related thumbnails and transitive dependencies. Preserve rendered paths and reviews as historical evidence; no synthetic exact-byte publication approval. |
| `channel_thumbnail_profiles`, `channel_thumbnail_archetypes`, `thumbnail_archetypes`, `thumbnail_bookmarks` | Shared CF branding systems | Include the selected channels' dependency closure and referenced media. Preserve originals, logos, reference imagery and associations. Do not import unrelated formats wholesale. |
| `storage_artifacts` | `owner_kind` separates tutorials/content jobs; source has Drive verification fields | Restrict to migrated tutorial IDs. Preserve Drive IDs, byte counts/checksums and verification timestamps. Do not replay resumable session URIs blindly or import unrelated content-job artifacts. |

## Import order and dependency checks

1. Provision a **fresh isolated target database** at the verified application
   schema. Do not restore the entire CF schema over the new application. Stop all
   target workers, archive scanners, uploaders, automatic recovery and outbox
   dispatch; set global dispatch pause. Keep external ingress limited to staging.
2. Create a protected immutable migration archive containing source system/table,
   UUID, snapshot timestamp/checksum and exact source row. Archive tutorial rows
   and derivatives before projecting them. This archive needs a proper read-only
   history UI and ACL before unmapped histories are considered migrated for VAs.
   The planning module does **not** create this storage or publish an archive API.
3. Import selected/referenced `tts_voices`, then channels, then users, preserving
   IDs. Users reference default channels; channels reference voices. Import every
   creator/reviewer/preset author needed by selected jobs, including inactive or
   non-production historical accounts, without promoting roles.
4. Import tutorial presets and required branding dependency closure. For
   thumbnail parent chains, use topological insertion or a transaction with
   explicitly validated deferred references; never disable all FK checking.
5. Archive then project supported mapped jobs. Insert source/parent jobs before
   dependents. Enforce logical FKs even where the legacy database did not:
   creator, channel, prompt preset, reviewer, parent, selected thumbnail and
   storage owner. Preserve unknown status values only in archive storage; do not
   coerce them into COMPLETED, FAILED or CANCELLED to satisfy an enum.
6. Import tutorial thumbnail and storage rows after their dependencies. Apply
   explicitly approved directory-prefix remaps only, with boundary checks, and
   keep original paths in audit. A remapped DB path is not proof the file exists.
7. Install required provider/environment secrets directly on the target with
   restrictive ownership and permissions. Preserve their values and existing
   voice bindings. Never put actual secrets/hashes into OneDrive, Git, terminal
   output or the migration report. Validate provider readiness without consuming
   generation credits, then run separately authorized bounded provider tests.
8. Compare counts and reference closure using one source transaction snapshot.
   Verify hashes of sampled media and all assets needed by the pilot batch.
   Validate existing-password login using user-entered credentials or a controlled
   test account, not password resets or disclosed source hashes.
9. Stage the routing/resume worklist. Supported assigned READY_TO_RECORD work can
   resume independently; unassigned work cannot block it. QUEUED/GENERATING_*/
   SPLICING source rows require explicit cutover/resume handling, not simultaneous
   processing by source and target workers. No legacy row gains auto-dispatch.

At final cutover, establish a brief source write freeze and consistent snapshot,
reconcile changes since staging, verify target login/recording/pilot, and only
then migrate daily work. Do not remove or modify the dirty `/opt/content-forge`
checkout. Retain source deployment and protected snapshot for rollback. A rollback
must not allow both systems to resume the same production job concurrently.

## Local planning evidence

`scripts/migration/selective-import-plan.ts` is a pure, non-I/O planner. It accepts
explicit target columns, dependency ID sets and approved path mappings. It
preserves exact source rows for a future protected archive, rejects missing
dependencies, preserves bcrypt bytes/roles, and labels routing/unsupported work
without fabricating approvals. It intentionally has no source connection or
import execution mode and cannot write a production database.

`scripts/migration/test-selective-import-plan.ts` exercises only synthetic data:
password/role preservation, exclusion of cookie ciphertext, missing routing,
parent dependency checks, unknown language/status, segment/archive handling,
safe path boundaries, lossless raw row preservation and derivative relationships.

Remaining blockers before a complete historical migration: actual protected archive
import, explicit primary/routing assignments, media availability proof, secure
credential transfer, source-delta/cutover procedure and controlled end-to-end
validation. Account/config staging can be performed separately once these safety
controls are in place; a DB-only copy must not be called a complete migration.

## Protected archive and routing implementation

Migration `0098_tutorial_legacy_archive.sql` now creates the protected archive and
append-only routing audit. Its source table allowlist is limited to
`tutorial_jobs` and `tutorial_derivatives`. It stores original JSON text unchanged,
plus a SHA-256 fingerprint and safe metadata projection. A recursive database
check and the `prepareLegacyTutorialArchive` helper reject password, credential,
cookie, private-key and token field names even inside nested objects/arrays.
User password hashes belong exclusively in the users import, never this archive.
The original source JSON and provenance cannot be updated or deleted through
ordinary SQL; audit events are append-only. Normal operations expose no raw JSON
download endpoint. Only owner-scoped metadata is returned to VAs; Admins see all.

The **Imported history & migration routing** component offers server-side search,
bounded keyset pagination and an Admin-only unrouted-work filter. It displays the
source identity, source parent, original status and migration state, never an
invented approval/publication state. Unknown owners remain Admin-only until their
actual account IDs are imported. There is no fallback owner or promotion.

Admin assignment validates the original active producer's enabled primary-channel
access, locks the archive/linked runtime/channel rows and writes one audit event.
Repeated concurrent identical assignments are idempotent. If a matching unmapped
runtime original already exists, only its channel is assigned: status, approval,
schedule and delivery state remain unchanged. An approved/delivered runtime job,
legacy segment or unsupported workflow is rejected. An archive-only source is
marked **Assigned for migration; not resumed** and no runtime job is created.
Routing performs no queue, provider or uploader call. It cannot erase the source
row's original null channel or original status.

Synthetic-only `scripts/test-recovery-legacy-archive.ts` verifies byte-preserved
JSON, immutable records/audit, recursive credential rejection in both JavaScript
and PostgreSQL, table allowlist, Admin/channel enforcement, four concurrent
assignments producing one audit, no fabricated approval, and archive-only
assignment without creating or enqueueing a job. Six API tests verify owner
scope, authentication, bounded query validation and absence of raw/source secrets
from the selected response projection. Migration 0098 was applied only to the
isolated recovery database for these tests; no actual CF archive data was copied.
