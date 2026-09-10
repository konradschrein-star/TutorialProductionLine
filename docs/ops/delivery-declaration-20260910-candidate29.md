# Candidate29 explicit delivery declaration

Candidate29 was built and deployed on 2026-09-10 to VPS2 private staging and Omar production.

## Delivered behavior

The software-logo matcher now removes trailing decorative asset-label suffixes—`logo`, `symbol`, `icon`, `mark`, `badge`, `png`, and `image`—before matching software-name token boundaries. The global `DocuSign-Symbol` asset therefore matches the target DocuSign tutorial without weakening token-boundary or longest-name selection behavior.

## Immutable release

- Image ID: `sha256:a63f96a2c550d32e3a6d4da2d7e4082c34207e87a790c4127c7d4231fabae534` (`linux/amd64`, user `node`).
- Docker archive: 772,222,976 bytes, SHA-256 `53df7fb366052798817e75bef62787ac157e1bf88d7eed7e564ae46de8ec8be8`.
- Omar runtime archive: 510,431,556 bytes, SHA-256 `90a1e64770618fb7c06199d7c6358ad6008d84678f13eba818691e01b53e3fb4`.
- Git provenance: branch `codex/tutorial-recovery`, HEAD `637f42af1926996bf0c85d739e22d23d943e7157`; the dirty-tree runtime is identified by the immutable artifact/source hashes in `.release/candidate29/manifest.json`.
- Verification: focused matcher regression 4/4 passed; Hub typecheck and production build passed; clean 13-project Linux build passed. The existing optional `@valkey/valkey-glide` warning remains non-fatal.

## VPS2 delivery

- Backup: `/var/backups/tutorial-vps2-pre-candidate29-20260910T031309Z/tutorial_staging_cf_20260908.dump`, SHA-256 `028fdbe8fd299ebaa8006b04753beda38497478da66703b54fd9250aac21eee2`.
- Full restore rehearsal passed: 2,016 jobs, 9 users, 3 channels. Migration: none.
- Exact Candidate29 image is live on `127.0.0.1:3118`; only web, PostgreSQL, and Redis run. All writer, Drive, publication, automatic-delivery, retention, AI-thumbnail, and VeoForge-image flags are off.
- The first immediate health read landed during web restart and saw a connection reset; one fresh complete validation passed without relaxing a gate.
- Final health is healthy; login 200; protected route 307; 16/16 referenced assets returned 200.
- DB remained 2,016 jobs, max update `2026-09-08 14:12:48.501+00`, 9 users, 3 channels, 2,045 thumbnails, and 17,562 storage artifacts.
- Media remained 1,098,330,158 bytes / 66 files. Rollback: `tutorial-recovery:20260910-candidate28`.

## Omar delivery

- Backup: `/var/backups/tutorial-omar-pre-candidate29-20260910T031623Z/tutorial_studio.dump`, SHA-256 `6b33072e40bd4faae3c0d654a704d9bf0c6b3421f2ef012a9f1021b29094fae3`.
- Full restore rehearsal passed: 1,910 jobs, 8 users, 6 channels. Migration: none.
- Release: `/opt/tutorial-review-omar-20260910-final-c29/app`.
- Processes: web PID 1178037, worker PID 1178038, Drive uploader PID 1178070. Independent uploader exchange remained PID 461644 from `/opt/tutorial-studio`.
- AI thumbnail generation remains off and Drive root `1dq1J2su1zNWS34hkKLXywf-lIrfBxPDS` is preserved.
- Internal/public health is healthy; login 200; protected route 307; 17/17 referenced assets returned 200.
- DB before/after remained 1,910 jobs, max update `2026-09-09 19:31:41.765967+00`, 8 users, 6 channels, 913 thumbnails, and 8,805 storage artifacts.
- Dispatch/receipts before/after remained 1 `applied_reported`, 8 `succeeded`, 7 `uncertain`, and 72 receipts.
- Media before/after remained 26,711,973,226 bytes / 5,039 files.
- Target job remained selected thumbnail `d38201cc-852a-4e3e-a3dd-7814ee345018`, stored headline `ADD A\nWITNESS` (3 words), `not_reviewed`, flattened, 0 drafts, unchanged thumbnail timestamp, and PNG SHA-256 `1c1b637fc77a8a506e7c52c7c40122461df5421e18c12acf6791a1974e348423`.
- Deployed matcher and regression-test source hashes exactly match the local manifest. Rollback: `/opt/tutorial-review-omar-20260910-final-c28`.

## Authenticated acceptance and exclusions

The authenticated read-only API returned the exact selected thumbnail and PNG hash, `ADD A` / `WITNESS` (3 words), flattened review truth, null draft layout, revision 0, `phantomUnsavedState=false`, and a present `DocuSign-Symbol` URL; the false missing-logo warning condition is therefore false.

The live authenticated browser inspection independently confirmed the exact selected image and 3-word copy, absence of the stale 4-word tutorial copy, absence of `Unsaved: English`, absence of `No matching software logo yet`, the expected replacement/approval controls, and EN/FR/IT/DE/SV variants. Neither replacement nor approval was clicked.

No database or media mutation, thumbnail replacement, approval, scheduling, dispatch, reconciliation, translation, uploader action, YouTube upload, file deletion, or tutorial/user/channel record mutation was performed.
