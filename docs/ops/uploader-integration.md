# Tutorial uploader integration

The uploader is a separate deployment. Tutorial Studio prepares and validates bundles, exposes a read-only manifest, and receives lifecycle callbacks. It never drives a browser from the web process.

## Safe bring-up

**Recovery change:** the legacy `uploader-config` and `uploader-jobs` discovery
endpoints are inspection-only. They always return execution denied, including
when legacy settings say live. Their snapshots cannot atomically bind a start to
an approved asset revision or honor a concurrent emergency pause. Do not execute
from them or override this hold in the consumer. The guarded Drive exchange is
separate and currently supports private/unlisted delivery only; the generic
advance-upload/scheduled-publication contract is still outstanding. The older
bring-up notes below are not release authorization and step 8 is not supported
through these discovery endpoints.

Legacy `/api/production/uploader-status` GET is now Admin-only and read-only.
Dashboard success is an observation, not an exact-revision receipt. Its POST
callback records authenticated evidence in tutorial history and returns
`verified: false` (202 on first observation, 200 on identical replay). Reusing an
event ID with different evidence returns 409; the original evidence stays intact.
Neither path updates verified publication fields or the Studio reservation.
Use the revision-bound exchange receipts for verified delivery; these legacy
observations require reconciliation. Coordinate this response change with the
separate uploader before deployment. Receipt ingestion through the guarded
Drive exchange continues during emergency pause.

1. Apply migrations with `pnpm --filter @repo/db migrate:tutorial-ship`.
2. In Settings, generate an uploader connection token.
3. Leave the uploader disabled and in dry-run mode.
4. Configure the uploader dashboard URL and callback URL.
5. Have the uploader read `GET /api/production/uploader-config` and fail closed unless `safety.mayExecute` is true.
6. Read `GET /api/production/uploader-jobs`. Resolve every item in `blockers`; do not infer missing metadata or files.
7. Test callbacks against a disposable job without contacting YouTube.
8. Only after operator review, enable live mode and explicitly release a job.

Every machine request uses `Authorization: Bearer <connection token>`. The token is stored only in the encrypted secrets area.

## Required state handling

- `waiting_to_be_uploaded`: bundle is complete and in Drive.
- `uploading`: resumable transfer started.
- `scheduled`: YouTube accepted the video and returned a future publish time.
- `uploaded`: video is actually public. A scheduled/private/unlisted video is not counted as public.
- `failed`: terminal attempt failed; include diagnostics in uploader operations logs and retry only within configured limits.

Callbacks are idempotent by `eventId`. Preserve YouTube's video ID, visibility, scheduled time, and processing outcome. Use the supported YouTube Data API with OAuth and resumable uploads. Do not add fingerprint spoofing, CAPTCHA bypasses, or behavior intended to conceal automation.
