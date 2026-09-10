# Candidate28 explicit delivery declaration

Candidate28 was built and deployed on 2026-09-10 to VPS2 private staging and Omar production.

## Delivered behavior

For a selected flattened thumbnail, the thumbnail-bundle now returns the stored selected thumbnail's non-empty `headline_text` lines. The Composer uses those selected lines as the review headline fields whenever the selected flattened image is the review truth. It no longer substitutes the stale tutorial-job copy, silently seeds the legacy layout, or marks the untouched review as unsaved.

## Immutable release

- Image ID: `sha256:f9c772fb27f1fd219cba7b051fa06797509f8dae289210c591a7a8482d7923ec` (`linux/amd64`, user `node`).
- Docker archive: 772,256,256 bytes, SHA-256 `b8aeb7e71756e10a50e71343eb89a577e7170d055ab8e3a354c4f84af00a301b`.
- Omar runtime archive: 510,441,429 bytes, SHA-256 `9d230ae136d9ef3eb66cc62be85e0f78812b6ba4dedbfc17b8a6d3ad1b4836aa`.
- Git provenance: branch `codex/tutorial-recovery`, HEAD `637f42af1926996bf0c85d739e22d23d943e7157`; the dirty-tree runtime is identified by the immutable artifact and source hashes in `.release/candidate28/manifest.json`.
- Verification: Hub 714 passed / 64 skipped; Hub typecheck and production build passed; clean 13-project Linux build passed. The existing optional `@valkey/valkey-glide` warning remains non-fatal.

## VPS2 delivery

- Backup: `/var/backups/tutorial-vps2-pre-candidate28-20260910T024547Z/tutorial_staging_cf_20260908.dump`, SHA-256 `86b256636a3a94685e16961800617236d85abed9d09e204a648851535c0f1d74`.
- Full restore rehearsal passed: 2,016 jobs, 9 users, 3 channels. Migration: none.
- Exact Candidate28 image is live on `127.0.0.1:3118` only; only web, PostgreSQL, and Redis run.
- Drive, publication, automatic delivery, retention, AI thumbnail, and VeoForge image flags are off.
- Health is healthy; login 200; protected route 307; 16/16 referenced assets returned 200.
- DB remained 2,016 jobs, max update `2026-09-08 14:12:48.501+00`, 9 users, 3 channels, 2,045 thumbnails, and 17,562 storage artifacts.
- Media remained 1,098,330,158 bytes / 66 files. Rollback: `tutorial-recovery:20260910-candidate27`.

## Omar delivery

- Backup: `/var/backups/tutorial-omar-pre-candidate28-20260910T025054Z/tutorial_studio.dump`, SHA-256 `64b0a5bcfac40d8246aeae6084230df9b4582d50948b223d28c88420bf0e2b9b`.
- Full restore rehearsal passed: 1,910 jobs, 8 users, 6 channels. Migration: none.
- Release: `/opt/tutorial-review-omar-20260910-final-c28/app`.
- Processes: web PID 1172853, worker PID 1172854, Drive uploader PID 1172886. Independent uploader exchange remained PID 461644 from `/opt/tutorial-studio`.
- AI thumbnail generation remains off and Drive root `1dq1J2su1zNWS34hkKLXywf-lIrfBxPDS` is preserved.
- Internal/public health is healthy; login 200; protected route 307; 17/17 referenced assets returned 200.
- DB before/after remained 1,910 jobs, max update `2026-09-09 19:31:41.765967+00`, 8 users, 6 channels, 913 thumbnails, and 8,805 storage artifacts.
- Dispatch/receipts before/after remained 1 `applied_reported`, 8 `succeeded`, 7 `uncertain`, and 72 receipts.
- Media before/after remained 26,711,973,226 bytes / 5,039 files.
- Target job remained selected thumbnail `d38201cc-852a-4e3e-a3dd-7814ee345018`, stored headline `ADD A\nWITNESS` (3 words), `not_reviewed`, flattened (`promptIsLayout=false`), 0 drafts, unchanged thumbnail timestamp, and PNG SHA-256 `1c1b637fc77a8a506e7c52c7c40122461df5421e18c12acf6791a1974e348423`.
- Deployed source hashes exactly match the local manifest. Rollback: `/opt/tutorial-review-omar-20260910-final-c27`.

## UI validation and exclusions

The final authenticated CUA inspection could not run because the CUA runtime exposed no browser surface (`browsers=[]`; in-app browser unavailable). No credential workaround was attempted. Server-side selected-thumbnail truth, the deployed API/Composer source identity, the exact selected PNG, and the no-draft/no-layout conditions all passed; the visual claim of exact fields and no unsaved banner remains explicitly unconfirmed until an authenticated browser surface is available.

No thumbnail approval, scheduling, dispatch, reconciliation, translation, uploader action, YouTube upload, file deletion, or tutorial/user/channel/media record mutation was performed.
