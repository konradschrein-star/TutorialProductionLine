# Candidate 25 delivery declaration — 2026-09-10

## Delivered release

- Source form: composed recovery working tree at Git base
  `637f42af1926996bf0c85d739e22d23d943e7157`.
- Linux/amd64 image:
  `tutorial-recovery:20260910-candidate25`.
- Image identity:
  `sha256:683adbd0e8c267fbc701e388298a5d7ce58d5a322bf7689f469fb7a9406a14ac`.
- OCI/Docker transport SHA-256:
  `EE853E54196E6A04129E87831BFC5542E8E9C118772D9981C417718C3B9B17B8`.
- Omar runtime transport SHA-256:
  `18CBE55D4264F884A486FA5CD473911722CFDD70A55A9903B24919B3F90B6087`.

The image was built from the current allowlisted Docker context in a clean
Linux build. It is distinct from every Candidate 24 artifact and hash.

## Verification inherited by the release

- Monorepo test tasks: 25/25 passed.
- Hub: 714 passed, 64 skipped.
- Worker: 561 passed, 3 skipped.
- Media core: 1,044 passed, 3 skipped.
- Build tasks: 15/15 passed.
- Visual canaries: 16/16 passed at score 100.
- Clean container build passed. The only warning was BullMQ's already-known
  optional `@valkey/valkey-glide` import.

## VPS2 private canary

Candidate 25 was loaded and deployed first on VPS2. The first disposable
database-clone restore exposed that `tutorial_archive_payload_safe(jsonb)`
recursively resolved its unqualified name under `pg_restore`'s empty search
path. The gate stopped before live migration or web replacement. The rehearsal
helper was corrected to restore pre-data first, pin that function's search
path only inside the disposable clone, then restore data and post-data. The
second full rehearsal passed without weakening the gate.

- Successful pre-release database backup:
  `/var/backups/tutorial-vps2-pre-candidate25-20260910T005200Z/tutorial_staging_cf_20260908.dump`.
- Backup SHA-256:
  `982fe6f4cfff7f8af902177ff66d7c702d1c564d9d85e22f5071910f33db6ae8`.
- Exact additive migration 0104 passed on the restored clone and applied
  idempotently to live.
- Running image identity exactly matches Candidate 25.
- Web is bound only to `127.0.0.1:3118`.
- Running services are exactly `web`, `postgres`, and `redis`; no worker or
  uploader was started.
- Drive retrieval, AI thumbnails, live image generation, publication,
  automatic delivery, and retention are all disabled.
- `/api/health` returned healthy with database, Redis, queues, workers, and
  disk checks green.
- `/login` returned 200.
- `/thumbnails`, `/tutorial-studio`, and
  `/api/me/tutorial-preferences` returned 307 to `/login` when unauthenticated.
- All 12 JavaScript/CSS assets discovered from the login page returned 200.
- Tutorial invariant before/after: 2,016 rows; maximum `updated_at`
  `2026-09-08 14:12:48.501+00`.
- Users/channels remained 9/3.

Candidate 21 remains installed as the explicit VPS2 rollback image and
override.

## Omar production

- Successful pre-release database backup:
  `/var/backups/tutorial-omar-pre-candidate25-20260910T005622Z/tutorial_studio.dump`.
- Backup SHA-256:
  `cf38c29835c853618a1131293c537d0ffa5b2946576b137a92e6dc6ce8bbc01e`.
- Exact additive migration 0104 passed on the restored clone and applied
  idempotently to live.
- Runtime directory:
  `/opt/tutorial-review-omar-20260910-final-c25/app`.
- `tutorial-web`, `tutorial-worker`, and `tutorial-drive-uploader` are online
  from the Candidate 25 runtime.
- The independent `tutorial-uploader-exchange` stayed online at PID 461644
  from `/opt/tutorial-studio`; it was not restarted or controlled by the
  release.
- The existing Drive root remained
  `1dq1J2su1zNWS34hkKLXywf-lIrfBxPDS` for all three release-owned processes.
- AI thumbnail generation stayed disabled (`TUTORIAL_AI_THUMBNAILS_ENABLED=false`
  on web/worker and `VEOFORGE_IMAGES_ENABLED=0` on all three processes).
- Public `https://tutorials.axtrelis.com/api/health` returned healthy with
  database, Redis, queues, workers, and disk checks green.
- `/login` returned 200 with email/password controls.
- `/thumbnails`, `/tutorial-studio`, and
  `/api/me/tutorial-preferences` returned 307 to `/login` when unauthenticated.
- All 12 JavaScript/CSS assets discovered from the login page returned 200.
- External TLS verification succeeded; health and login returned 200 through
  the public Cloudflare address.
- Tutorial invariant before/after: 1,910 rows; maximum `updated_at`
  `2026-09-09 19:31:41.765967+00`.
- Users/channels remained 8/6.
- Seven pre-existing uncertain dispatch records remain seven; this deployment
  did not reconcile or change them.
- Media invariant before/after: 26,711,768,892 bytes across 5,037 files under
  `/opt/tutorial-studio/media`.

Candidate 21 remains at
`/opt/tutorial-review-omar-20260909-final-c21/app` as the automatic rollback
runtime. Migration 0104 is additive/idempotent and is intentionally not
reversed during application rollback.

## Explicit exclusions

This operation did not regenerate or select thumbnails; approve tutorials or
thumbnails; reserve schedules; dispatch or upload videos; reconcile uncertain
uploads; evict media; change users or channel mappings; change Drive roots; or
change public DNS/ingress.
