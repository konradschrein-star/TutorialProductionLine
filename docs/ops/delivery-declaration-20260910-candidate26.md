# Candidate 26 explicit delivery declaration

Delivered on 2026-09-10. This declaration separates the immutable runtime, the two deployments, the one authorized thumbnail mutation, and source-only work that landed after the image freeze.

## Immutable runtime delivered

- Image: `tutorial-recovery:20260910-candidate26`
- Image ID/digest: `sha256:a15f34f762ac137672b11709d3d6697acacfd344cc2b1c74936ba37132f7b90e`
- Platform/user: `linux/amd64`, `node`
- Docker archive: `.release/candidate26/candidate26.tar`, 772,167,168 bytes, SHA-256 `0e5f0a2fd904e092b6651bc9426e25bbf947e288ae53e4ca816d32281d7172c2`
- Omar runtime archive: `.release/candidate26/runtime-app-candidate26.tgz`, 510,348,761 bytes, SHA-256 `070f92705f7197ec1b2f792eec77d735721cdb679159d7b522e87762ee9e8f0e`
- Git provenance: branch `codex/tutorial-recovery`, HEAD `637f42af1926996bf0c85d739e22d23d943e7157`; the working tree was dirty, so the archive/image hashes above are authoritative.

The deployed runtime contains matching local/remote SHA-256 identities for the exact-job allowlist fence, responsive settings grid, visible/saved 30-per-day channel schedule clamp, and responsive channel-group grid. See `.release/candidate26/manifest.json` for those five source hashes.

## Verification delivered

- Clean Docker workspace build: passed.
- Worker exact-job allowlist unit gate: 8/8 passed.
- Database tutorial 30-per-day cap gate: 5/5 passed.
- Worker build: passed.
- Hub build: passed with only the existing optional `@valkey/valkey-glide` resolution warning.
- Candidate26 helper syntax: all three Node helpers passed `node --check`; both database rehearsal scripts passed `bash -n`.

## VPS2 private canary delivered

- Pre-deploy backup: `/var/backups/tutorial-vps2-pre-candidate26-20260910T013330Z/tutorial_staging_cf_20260908.dump`, SHA-256 `432290b2e3b6d9c73d5aa5e0d7b6cffe5bfcbf21692a5e17d2aa171b8e3925b3`.
- Full restore rehearsal: passed with 2,016 jobs, 9 users, and 3 channels.
- Migration: none; Candidate26 has no schema change after Candidate25.
- Deployed exact image ID `sha256:a15f34f...` to the web service only.
- Ingress remains private at `127.0.0.1:3118`.
- Staging service set remains web + PostgreSQL + Redis. No worker, Drive uploader, AI process, writer, publisher, retention, or cleanup process was started.
- Flags verified off: Drive, tutorial publication recovery, automatic delivery recovery, retention, AI thumbnails, and VeoForge images.
- Health: healthy database, Redis, queues, workers view, and disk; login 200; protected Tutorial Studio/settings routes 307; 12/12 login static assets 200.
- Data invariant remained exactly 2,016 jobs, max `updated_at` `2026-09-08 14:12:48.501+00`, 9 users, 3 channels.
- Rollback image: `tutorial-recovery:20260910-candidate25`.

## Omar production delivered

- Pre-deploy backup: `/var/backups/tutorial-omar-pre-candidate26-20260910T013859Z/tutorial_studio.dump`, SHA-256 `06fe609baaba69577d78f78bb38d23a1ba8a6af2943a44d54c789828d78e738b`.
- Full restore rehearsal: passed with 1,910 jobs, 8 users, and 6 channels.
- Migration: none; Candidate26 has no schema change after Candidate25.
- Release directory: `/opt/tutorial-review-omar-20260910-final-c26/app`.
- Processes: `tutorial-web` PID 1156391, `tutorial-worker` PID 1156392, `tutorial-drive-uploader` PID 1156419, all online from Candidate26.
- Independent `tutorial-uploader-exchange`: unchanged and online at PID 461644 from `/opt/tutorial-studio`; it was not controlled by the release.
- Omar AI thumbnail generation remains off; the configured Drive root remains `1dq1J2su1zNWS34hkKLXywf-lIrfBxPDS`.
- Internal and public `https://tutorials.axtrelis.com/api/health`: healthy; login 200; protected route redirect 307; 12/12 referenced static assets 200.
- Core data invariant remained exactly 1,910 tutorial jobs, max job `updated_at` `2026-09-09 19:31:41.765967+00`, 8 users, 6 channels, 913 thumbnails, and 8,805 storage artifacts.
- Dispatch/receipt invariant remained 1 `applied_reported`, 8 `succeeded`, 7 `uncertain`, and 72 receipts.
- Media invariant before the thumbnail canary remained 26,711,768,892 bytes and 5,037 files.
- Rollback release: `/opt/tutorial-review-omar-20260910-final-c25`.

## Exact thumbnail canary delivered

- Exact job: `7d6cdc5d-23b8-4b51-8bf6-7224e26aa876` only.
- Guarded mode: mandatory `TUTORIAL_THUMBNAIL_JOB_ALLOWLIST` fixed to that UUID, `FORCE_RENDER=1`; resolved total 1, existing row 1, created 0, failed 0.
- Eligibility verified before mutation: English original, `COMPLETED`, no parent/source job, final video present, active tutorial channel `USA Tutorials`.
- Thumbnail row count/selected count: 1/1 before and 1/1 after. Existing row `d38201cc-852a-4e3e-a3dd-7814ee345018` was reused.
- Tutorial job row did not change; global job/thumbnail/storage counts and max job update timestamp did not change.
- PNG changed from SHA-256 `a0ce3512c708a32761f03793dbb8c99b6c3d339b4564e45c1905a0d8475b9d61` to `1c1b637fc77a8a506e7c52c7c40122461df5421e18c12acf6791a1974e348423`; output is 930,690 bytes, 1280×720 RGBA.
- Quality report SHA-256 `a2f3be29e36a98caee1fb935eef76e5030de7cf0cd859121a100e7b34d30d2e3`; `passed=true`, score 100, zero issues/errors.
- Local media changed from 26,711,768,892 bytes / 5,037 files to 26,711,973,226 bytes / 5,039 files. The two new files are the quality sidecar and the renderer's local `ui-frame-en.png` intermediate; the PNG was replaced in place.
- Exactly the resulting PNG and quality JSON were copied to `.release/production-canary-c26/`; no video or UI-frame intermediate was copied.
- No approval, scheduling, dispatch, reconciliation, uploader-exchange action, or YouTube upload was performed. Dispatch and receipt counts remained unchanged.

## Drive outcome and precise blocker

The new Candidate26 PNG is **not yet durably copied to Drive**. Its existing thumbnail row remains `review_verdict=not_reviewed`, and the Drive scanner deliberately admits only selected completed thumbnails with verdict `acceptable` or `strong`. The storage artifact therefore remains `pending` with `drive_file_id=NULL`. This gate was not bypassed because the operation explicitly prohibited approval.

The previous thumbnail revision remains durably recorded in `storage_artifact_versions`: Drive file `1y5OivdWI51H-mmGBKKb97sULdj1aVX8O`, verified `2026-09-09T15:20:22.249Z`, prior SHA-256 `96ff201a67e0d5de97c69968fd67eda10ac25e1cbc48bce7612b3771887101ef`. A later, separately authorized approval is required before the scanner can create and verify the Drive copy for the new bytes.

## Post-freeze source only — not deployed

The guarded Omar weekly-schedule command/policy/test and its `package.json` registration landed after the image freeze. They were not rebuilt, deployed, or executed; their hashes are listed in `.release/candidate26/manifest.json`.

The post-freeze change removing the legacy plaintext production-account seed block from `packages/db/src/seed.ts` was also not deployed, and live users were untouched. It requires a later immutable release. Credential rotation remains required because older Git history and artifacts may still contain those historical values.
