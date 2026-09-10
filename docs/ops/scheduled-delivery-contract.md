# Optional scheduled delivery and manual VA uploads

## Compatibility boundary

Studio now implements `tutorial-scheduled-delivery/1`, an opt-in HTTP contract.
The separate Uploader must implement this contract before this mode can deliver
anything externally. No changes to the Uploader repository were made. The r1
Drive exchange remains private/unlisted-only and is not reinterpreted as a
publication scheduler. Generic requests use `generic_*` states and never enter
the r1 publisher. Both transports share the unique per-tutorial dispatch record,
so switching tabs or repeating actions cannot create parallel uploads.

Apply additive migration `0095_tutorial_scheduled_delivery.sql`. It adds nullable
JSON request state; no existing jobs are backfilled or dispatched. Keep this
column and dispatch records during rollback. Do not feed generic requests into
older external consumers. It was applied only to the isolated test DB during
development, not to a live production DB by this implementation task.

## Connector contract

All machine endpoints require `Authorization: Bearer <customer connection token>`;
the token is stored as encrypted `UPLOADER_CALLBACK_SECRET`. Use HTTPS in real
deployments. Do not put the token into download URLs, logs or browser storage.

1. A producer or assigned uploader queues a reviewed variant using
   `POST /api/production/jobs/{tutorialId}/scheduled-delivery`, with
   `{ "visibility": "private", "made_for_kids": false, "monetization": "off" }`.
   Monetization `on` additionally requires `ad_suitability_confirmed: true`.
   These are explicit operator declarations, not inferred from tutorial genre.
   The request takes its channel and publication time from Studio, not the caller.
2. `GET /api/production/delivery/claim` lists up to 50 queued request IDs. This
   discovery response is **not execution authorization**.
3. Persist a unique UUID `claimId` in the connector's durable ledger *before*
   `POST /api/production/delivery/claim` with `{ dispatchId, claimId }`.
   Admission requires live enabled settings, current exact-byte approval,
   unchanged channel mapping, future reserved time and no emergency pause.
4. First admission returns `mayStart: true`, a request object and its SHA-256.
   The digest is SHA-256 of UTF-8 compact JSON with recursively ASCII-sorted
   object keys and preserved array order. Echo the returned digest on receipts.
   The wire request includes immutable approval revision, idempotency key,
   channel key, publication timestamp, metadata and two asset descriptors.
   Each descriptor gives an authenticated relative URL, SHA-256 and byte size.
   Resolve URLs against the configured Studio origin. Independently verify
   downloaded bytes before uploading. Do not substitute current files or metadata.
5. Persist the provider upload session/video identity keyed by Studio's
   idempotency key. Use provider-supported resumable uploads and readback.
   Upload in advance as private, then set the exact requested publication time.
   Refuse a past publication time; never silently publish immediately instead.
6. Send `POST /api/production/delivery/receipts` with the receipt shape defined in
   `packages/contracts/src/tutorial-scheduled-delivery.ts`. Bind every receipt
   to `dispatchId`, `claimId`, `approvalRevision`, `requestSha256`, and increasing
   integer `sequence`. Upload/schedule/publication evidence requires an explicit
   `provider_readback` reference and timestamp, plus the video identity and
   visibility. `scheduled` requires the exact Studio timestamp and private
   visibility. `published` requires public visibility and actual publication time.

Response-loss semantics are deliberately conservative: replaying the same claim
returns the original request with `mayStart: false`. It is a recovery lookup, not
another execution grant. Reconcile the durable provider session/video identity;
if the original admission response was lost before any durable start record,
report `uncertain` and investigate. A new claim UUID is refused. Never solve an
unknown outcome by creating a duplicate upload.

Receipts are durable and idempotent by dispatch/sequence. Identical old receipts
remain successful no-ops after newer evidence. Conflicting sequence contents,
unknown older sequences, different video IDs, schedule drift or stale request
hashes return 409. Uncertain/failed states can reconcile to uploaded, scheduled
or published with evidence, but cannot transition back to starting an upload.
Published state does not regress. Receipt ingestion continues during pause.

Studio never infers public status from elapsed time. A due reservation is shown
as awaiting provider verification. A claimed/uploading request without recent
evidence is marked for reconciliation in the UI after 30 minutes; this is not a
retry lease and does not restart it. Evidence for changed current assets remains
in history and is not projected as verified publication of the replacement.

## Manual VA uploader operation

Delivery defaults to **Manual VA upload — no integration needed**. An assigned
`UPLOADER_VA` lands directly in Delivery rather than production configuration.
Admins use **Admin · VA uploader channel access** in Delivery to assign channels;
assignments are stored in `channels.metadata.tutorialUploaderIds`.
An explicit list, including `[]`, supersedes the legacy saved default channel.
Assign both the primary channel and the locale channels this uploader operates;
the grouped table requires primary-channel access and only includes authorized
locale rows. Producers retain access to their own output, not colleagues' work.

For each row:

1. Ensure final review is complete. Open the assigned channel, not an arbitrary
   channel from the network. Expand locale rows for localized deliverables.
2. Download the video/thumbnail and **Download approved upload metadata**. The
   JSON handoff contains localized copy, assigned channel, Studio slot and exact
   asset hashes. It works without Drive or an uploader. Existing Drive links
   remain available when enabled.
3. Upload and schedule manually using the Studio reservation. Set audience and
   other platform declarations yourself. Do not use a package after corrections;
   obtain the reviewed replacement. Do not manually upload a row already owned
   by a connected uploader.
4. Click **Report manual upload** and paste the HTTPS YouTube watch/share URL.
   Studio records an attributed, unverified report, never a fabricated public
   state or provider verification. Admins must reconcile external uncertainty.

## Automatic requests after approval (opt-in)

In Delivery, **Admin · Automatic delivery after final approval** sets a separate
policy for each language channel. Manual remains the default. Automatic mode
requires explicit not-made-for-kids confirmation, monetization selection, and
ad-suitability confirmation when monetization is on. Saving this policy preserves
all other channel metadata and records the Admin and update timestamp.

The worker's bounded 60-second recovery scan reads durable approved tutorials and
their reserved slots; it does not rely on a browser making a follow-up request.
It includes already-approved pending tutorials with future slots on that channel.
It rechecks source and locale approval against actual video/thumbnail bytes,
assigned language/channel mapping, the latest channel policy, future slot and
emergency pause under transaction locks. Four concurrent scans and restart scans
produce one shared dispatch row. Language variants are independent once approved.
Blocked preparation records an actionable history event and retries on later
passes. No external upload occurs in this scan.

Disable `TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED` to `false` at process startup
to stop this scan, or leave channel policies manual. Disabling a channel policy
also holds its unclaimed automatic requests at connector admission. It does not
cancel requests already admitted or videos already scheduled externally. Changed
automatic declarations hold pre-existing unclaimed requests for reconciliation;
they do not silently rewrite frozen upload metadata.

## Verified locally / remaining release requirements

`scripts/test-recovery-scheduled-delivery.ts` uses only isolated PostgreSQL and
synthetic local assets. It checks concurrent queueing, emergency pause admission,
claim replay, duplicate/conflicting receipts, uncertain outcome reconciliation,
exact schedule matching, changed asset bytes and receipt ingestion during pause.
It makes zero provider calls. `scripts/test-recovery-automatic-delivery.ts` proves
manual defaults, opt-in policy, pause, stale approval rejection, four concurrent
scans and restart idempotency without provider calls. Fourteen contract tests and six channel assignment
unit tests supplement this probe. This is not a live provider acceptance test.

Still required: compatible external connector implementation/acceptance,
end-to-end private safe-destination test, authorization before actual scheduled
publication, operational reconciliation UI for cancelling/replacing an existing
request. Automatic approval-triggered requests now operate only after explicit
channel-level audience and monetization configuration. No automatic dispatch is
enabled by default; manual-mode channels still require an explicit queue click.
