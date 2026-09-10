# CDP uploader integration audit — 9 September 2026

## Scope and evidence

Read-only comparison; no uploader files, credentials, services, browser automation or upload state changed. No provider calls or live canary were performed. Source compatibility is not deployment acceptance.

Uploader checkout: `C:/Users/konra/OneDrive/Projekte/20260908 Uploader/cdp-uploader`, a separate nested repository for `the-faster-uploader`, clean at `5cfd2df780849ecc08fee3c9f0c9400e74dbce64` when inspected. The outer repository's Fleet and Windows OS uploader are not this integration target. Current Studio working-tree source was inspected; this document does not assert an immutable Studio release ID.

Paths prefixed **CDP** below are relative to that nested checkout; **Studio** paths are relative to this repository.

## Existing compatible private-upload seam

- **CDP** `packages/core-contracts/src/uploader_contracts/exchange.py:30` and **Studio** `packages/contracts/src/tutorial-uploader-exchange.ts:3` use `tutorial-uploader-job/1` and `tutorial-uploader-receipt/1`.
- The Studio upload is a valid subset of CDP's broader upload/update contract: job UUID, revision, stable idempotency key, UTC creation time, explicit channel key, video and thumbnail basenames, sizes and SHA-256, plus explicit metadata/audience/visibility declarations. Studio does not use CDP's extra update attributes.
- Both canonicalize JSON with sorted object keys and UTF-8. Studio normalizes zero-millisecond timestamps to Python's representation. This inspection did not rerun the cross-language corpus.
- **CDP** `apps/tutorial-studio-scheduler/src/tutorial_studio_scheduler/connectors/google_drive.py:455` discovers one `job.json` inside each inbox child folder. Assets are published first; `job.json` is the readiness marker, not a separate ready file. **Studio** `apps/worker-orchestrator/src/storage/tutorial-uploader-exchange.ts:695` treats a ready folder as immutable.
- Both receipt schemas bind job/revision/idempotency/hash and sequence. Both use `<job>.r<revision>.<hash-prefix>.s<sequence-six-digits>.<state>.json`. Studio rejects gaps, filename/identity mismatches and an inexact success attribute set (`tutorial-uploader-exchange.ts:870`).
- **CDP** `apps/tutorial-studio-scheduler/src/tutorial_studio_scheduler/direct_connector_executor.py:1271` binds saved readback proof to job, revision, manifest hash, logical channel, configured YouTube channel and exact video ID. Its success receipt reports requested attributes plus thumbnail, matching Studio's requested subset.

## Private upload is not scheduled publication

The existing exchange rejects public visibility. A successful receipt proves private/unlisted upload, not YouTube scheduling or public publication. Studio's projection explicitly sets `uploader_status=uploaded`, keeps frozen private/unlisted visibility, sets `is_uploaded=true`, clears `youtube_published_at`, and preserves the independent Studio reservation (**Studio** `apps/worker-orchestrator/src/storage/tutorial-uploader-exchange.ts:104`).

Studio has a separate, currently unmatched protocol:

- **Studio** `apps/hub-web/src/app/api/production/delivery/claim/route.ts`: discovery is non-executable; POST requires durable `dispatchId` and `claimId`.
- **Studio** `apps/hub-web/src/lib/uploader/scheduled-delivery.ts:86`: claimed request is `tutorial-scheduled-delivery/1`, operation `upload_and_schedule`, with approval revision, request hash, channel key, reserved `publishAt`, and authenticated asset URLs.
- **Studio** `apps/hub-web/src/app/api/production/delivery/receipts/route.ts` and `packages/contracts/src/tutorial-scheduled-delivery.ts`: receipts require the matching claim/request/approval identity and provider readback evidence; scheduled time must match the reservation.

No consumer of those HTTP endpoints or this version was found in CDP's scheduler integration source. Its existing Drive receipt must not be relabeled or translated into scheduled/published evidence. A compatible scheduling connector and actual provider readback are required before automatic scheduled delivery is accepted.

## Archive identity and emergency-stop boundaries

CDP has two source layouts: `job_exchange` and `tutorial_archive` (**CDP** `direct_connector_executor.py:305`, under the scheduler source directory above). The archive adapter (`connectors/tutorial_archive.py`) synthesizes a job from `<channel>/<month>/<tutorial>/final_video.mp4`, `metadata.json` and one thumbnail. That is not automatically the same frozen dispatch identity/hash as Studio's explicit exchange. Do not feed the same tutorial through both routes or discard the existing uploader state ledger. Archive receipts cannot be assumed to bind a Studio dispatch merely because the video originated there.

Studio's emergency pause prevents new admission/handoff. It does not revoke immutable bundles already visible in the CDP inbox or cancel an external YouTube schedule. The CDP worker must be paused independently for downstream stop, followed by reconciliation of any already-started operation. Do not interpret the Studio button as remote cancellation. The scheduling connector must eventually provide a documented coordinated admission/stop boundary.

## Configuration for a controlled private pilot

Shared folder IDs:

- `TUTORIAL_EXCHANGE_DRIVE_INBOX_ID`
- `TUTORIAL_EXCHANGE_DRIVE_RECEIPT_FOLDER_ID`
- Compatible `TUTORIAL_EXCHANGE_MAX_JOB_BYTES`

CDP additionally requires `TUTORIAL_EXCHANGE_DRIVE_CREDENTIALS` (protected absolute JSON path; authorized-user OAuth and service accounts supported), `TUTORIAL_EXCHANGE_STATE_ROOT` (existing persistent ledger), and optional `TUTORIAL_EXCHANGE_DRIVE_SETUP` fallback. See **CDP** `apps/tutorial-studio-scheduler/src/tutorial_studio_scheduler/connector_cli.py:18` and `connectors/google_drive.py:103`. Studio instead uses its configured ArtifactStore Drive client; do not copy the CDP credentials-path setting into Studio and assume authentication is configured.

Configure CDP `source_layout: job_exchange`, one exact enabled channel mapping, and its existing approved execution configuration. Studio `channels.uploader_channel_key` must equal the CDP logical channel key, which binds its actual YouTube channel. Preserve existing worker state, profiles, credentials and channel records. Verify both identities can read the intended inbox and read/write their required receipt/bundle objects without broadening access unnecessarily.

CDP's example defaults to 60-minute channel spacing; runtime permits 30–1440 minutes (`direct_connector_executor.py:350`). The default is approximately 24/day, not the requested 30/day. Choosing a shorter interval does not prove aggregate throughput; measure serialization, transfer and processing capacity. Several nested scheduler README reference links are absent and the README still describes the old Windows bridge: current CDP source/root README is the relevant implementation evidence.

## Acceptance gates

1. Record deployed release IDs, source layout and protected state-root ownership; confirm no other intake path will publish the same tutorial.
2. Validate one already-approved tutorial and explicit channel mapping. Keep publication private and all unrelated execution paused.
3. Verify frozen video/thumbnail bytes, metadata and manifest hash survive Drive materialization.
4. Obtain a real exact-channel/video saved-page readback and a durable contiguous receipt journal; verify Studio projects **uploaded/private**, not scheduled/published.
5. Replay the same identity and exercise receipt-delivery interruption/recovery without a second upload. An uncertain execution remains reconciliation-only.
6. Check Studio pause versus downstream pause behavior explicitly; document that already external work is not cancelled.
7. Separately accept the scheduled connector only after matching claim/request identities, reserved time, provider schedule readback, later publication evidence and failure/restart cases have passed. No private-success shortcut.

## Studio UI inspection

Inspected **Studio** `apps/hub-web/src/app/(authenticated)/tutorial-studio/_components/uploads.tsx`, `publication-plan.tsx`, and `channel-delivery-policy.tsx`. No direct private-success-to-scheduled/published label promotion was found:

- `uploads.tsx:149`: private success resolves to `Uploaded`; a retained reservation is not enough to label it Scheduled. Scheduled labels require `uploaderStatus === scheduled`; elapsed time becomes “awaiting provider verification,” not Published.
- `uploads.tsx:724`: exchange state `published` is correctly labeled “Handed off to uploader,” while `succeeded` is “Upload verified.” Only `generic_published` is “Verified published.”
- `uploads.tsx:969`: private mode explicitly states publication is not scheduled; scheduled mode warns that a queued request is not provider acceptance.
- `publication-plan.tsx:56`: reservations explicitly described as Studio plans, not YouTube confirmation.
- `channel-delivery-policy.tsx:18`: stop guidance explicitly excludes cancelling externally scheduled videos.

Usability findings from the read-only audit (subsequently addressed in the bounded Studio-only follow-up below):

1. `uploads.tsx:164` renders private and unlisted success simply as “Uploaded,” hiding visibility and the fact that an independent reserved slot still needs publication work. Better: “Uploaded private — publication not scheduled” when applicable. This is ambiguity, not a false published projection.
2. `uploads.tsx:957` offers “Connected uploader — Studio publication schedule” based on dispatch permission, not evidence of a compatible scheduled connector. The later status says “Awaiting scheduled connector,” but the initial label can imply a connected capability that the current CDP does not implement. Prefer explicit unconfigured capability gating/labeling.
3. `uploads.tsx:946` counts `isUploaded` only. Scheduled-protocol uploaded/scheduled receipts do not set that flag until publication, unlike the private exchange. Thus the summary can count a provider-verified private upload awaiting publication as pending; it should distinguish production, transfer and publication metrics.

UI inspection was source-only; no browser launch or screenshot acceptance was performed during this task.

### Studio-only follow-up

### Actual channel binding gate

The September8 21:42UTC read-only dashboard snapshot binds tutorial_usa to
`UC7rwqoNmW4EthwQegKTlwfQ`; its four other keys are tutorial_french,
tutorial_german, tutorial_italian and tutorial_swedish. None of the five saved
YouTube IDs matches any of the three imported Content Forge English channels.
Records contain no explicit source-family/locale mapping. The Studio channel
form's existing tutorial_usa key therefore must not be treated as verified
routing. User confirmation of the intended network is pending; no binding was
changed or uploader activated. config.example.json has different IDs and is not
a live inventory.

Private candidate9 browser verification confirmed the explicit private-upload
and scheduled-connector labels, paused admission notice and disjoint counts.
No upload, resume or publication action was taken.

`apps/hub-web/src/lib/uploader/delivery-status.ts` now owns pure labels and disjoint page-local milestone counts. Private/unlisted transfers explicitly state publication is not scheduled; mere reservations and elapsed time never promote publication. Published display requires verification plus public visibility and a publication timestamp. Manual reports remain unverified. The scheduled method option now says it requires a compatible connector, not that one is connected. Counts separate awaiting confirmation, unverified reports, verified transfers with unconfirmed publication, external schedules and verified publication. Seven focused helper tests pass. Backend protocol semantics and the uploader repository remain unchanged; visual acceptance is still pending.
