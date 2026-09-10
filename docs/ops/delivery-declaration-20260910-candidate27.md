# Candidate27 explicit delivery declaration

Candidate27 was built and deployed on 2026-09-10 to VPS2 private staging and Omar production.

## Delivered behavior

The Thumbnail Studio now treats a selected flattened rendered thumbnail as the review truth whenever no saved layout or replacement draft exists. The canvas and language previews display the exact selected image, including before approval. Editable starter elements are created only after the operator explicitly chooses **Create editable replacement**; the legacy starter layout is never silently seeded over a flattened render.

The three deployed source files match the SHA-256 identities in `.release/candidate27/manifest.json` on Omar.

## Immutable release

- Image ID: `sha256:d04aea2906f39c072b255f5f754f8ea5f4c0d6b7a3daabe51f70e57902fcd236` (`linux/amd64`, user `node`).
- Docker archive: 772,236,288 bytes, SHA-256 `f1432017b8ebe611a43160f110939e89cfc390224eaef7ba0625a6081a5da401`.
- Omar runtime archive: 510,390,573 bytes, SHA-256 `1ea9ec8f7b798d241f335e1147b667f6dd9bd2791510a16ef77fbd4c7e8213f8`.
- Git provenance: branch `codex/tutorial-recovery`, HEAD `637f42af1926996bf0c85d739e22d23d943e7157`; the dirty-tree runtime is identified by the immutable artifact hashes.
- Verification: Hub 714 passed / 64 skipped; Hub typecheck passed; clean 13-project Linux build passed. The only build warning was the existing optional `@valkey/valkey-glide` resolution warning.

## VPS2 delivery

- Backup: `/var/backups/tutorial-vps2-pre-candidate27-20260910T021655Z/tutorial_staging_cf_20260908.dump`, SHA-256 `d612cf70f400f6f6c296ce1db25a2ac61e441b116f55c233d5c1810a670cd205`.
- Full restore rehearsal passed: 2,016 jobs, 9 users, 3 channels. Migration: none.
- Exact Candidate27 image is live on `127.0.0.1:3118` only.
- Only web, PostgreSQL, and Redis run in the staging project. Drive, publication, automatic delivery, retention, AI thumbnail, and VeoForge image flags are off.
- Health is healthy; login 200; Tutorial Studio/settings 307; 12/12 referenced assets 200.
- DB inventory remained 2,016 jobs, max job update `2026-09-08 14:12:48.501+00`, 9 users, 3 channels, 2,045 thumbnails, and 17,562 storage artifacts.
- The same staging media bind remains mounted. Post-deploy inventory is 1,098,330,158 bytes / 66 files; no writer process was started.
- Rollback: `tutorial-recovery:20260910-candidate26`.

## Omar delivery

- Backup: `/var/backups/tutorial-omar-pre-candidate27-20260910T022110Z/tutorial_studio.dump`, SHA-256 `9d9132726a5bab5c57d0690ca89ee6f824446799bd3cbf21c6daba9aa21d9acf`.
- Full restore rehearsal passed: 1,910 jobs, 8 users, 6 channels. Migration: none.
- Release: `/opt/tutorial-review-omar-20260910-final-c27/app`.
- Processes: web PID 1166204, worker PID 1166205, Drive uploader PID 1166236.
- Independent uploader exchange remained PID 461644 from `/opt/tutorial-studio`.
- AI thumbnail generation remains off and the existing Drive root is preserved.
- Internal/public health is healthy; login 200; protected routes 307; 12/12 referenced assets 200.
- DB inventory before/after: 1,910 tutorial jobs, max job update `2026-09-09 19:31:41.765967+00`, 8 users, 6 channels, 913 thumbnails, 8,805 storage artifacts.
- Dispatch/receipt inventory before/after: 1 `applied_reported`, 8 `succeeded`, 7 `uncertain`, 72 receipts.
- Media inventory before/after: 26,711,973,226 bytes / 5,039 files.
- Rollback: `/opt/tutorial-review-omar-20260910-final-c26`.

## Excluded operations

No thumbnail approval, scheduling, dispatch, reconciliation, translation, uploader action, YouTube upload, file deletion, or tutorial/user/channel record mutation was performed. The prior Candidate26 thumbnail Drive-review blocker was left untouched.
