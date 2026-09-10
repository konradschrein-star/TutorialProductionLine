# Tutorial recovery execution ledger

## Authority and release boundary

The execution mandate dated 2026-09-08 supersedes the earlier audit proposal.
Work on `codex/tutorial-recovery`, preserving existing work and upstream fixes.
Standalone Studio and Keyword Tool remain independent. Uploader is an optional
generic integration; Content Forge and live production remain untouched.
Latest user authorization adds safe VPS2 deployment and verified Content Forge
team migration, followed separately by Omar's team with its branding preserved.
This is not permission for unverified/destructive cutover or arbitrary public
test uploads. No paid-provider generation or public publication has been performed.
User clarified Drive is durable video/thumbnail storage and VPS files are cache;
verify real remote copies and consumer restoration before any eviction.

Confirmed: final approval reserves the next slot on the upstream-assigned channel;
default 30 publications/day/individual locale channel. Dispatch assets in advance
with the future publication timestamp, not only when due. Verify publication from
external evidence. Completed approved locales may proceed independently. Emergency
pause stops new dispatches, not already scheduled external publications.

## Work checklist

- [x] Read execution mandate and latest detailed workflow notes.
- [x] Preserve audit artifacts; create development branch; fast-forward to upstream main 637f42a.
- [x] Stable Keyword Tool identities, claims, discard reasons and history on refresh (local regression tests).
- [ ] Reproduce ingestion/cookie issues; fix confirmed defects with tests.
- [ ] Recoverable review rework and approval gates.
- [ ] Thumbnail packs independent of localized video readiness; idempotent localization.
- [ ] Deterministic export, logo library propagation and locale overrides.
- [ ] Clear VA workspace, software batches, review and production records.
- [ ] Predetermined channel scheduling, revisions, emergency pause and generic delivery contract.
- [ ] Optional integration outbox and independently recoverable locale failures.
- [ ] Server-side ownership/settings isolation and secret handling.
- [ ] Productivity timeline and actionable automation delays.
- [ ] Builds, regression suites, controlled browser walkthrough and repair.
- [ ] Deployment/rollback instructions and VA/Admin SOPs.

## Current continuation evidence (8 September, evening)

These results supersede older point-in-time notes below, not the definition of done.

- Source VPS2 capacity checked: about86GB free; no VPS2 deployment or source
  account/media migration performed yet. Source CF dirty checkout preserved.
- All3994 recorded finished-video/thumbnail Drive objects checked through current
  GoogleAPI metadata:2844videos+1150thumbnails match recorded size/checksum and
  are nottrashed. Historical1196completedjobs lack confirmedvideoarchive; only5
  finals remain at recordedlocalpaths.508knownfolders have novideo;688no recorded
  folder. See datedDriveaudit. No filesdeleted; notallhistoryverified.
- Keyword Tool candidate now derives from actual live f16949a source snapshot,
  preserving its uncommitted SSO/manager/screening implementation. Old unrelated
  recovery branch mustnotreplace that source.66Pythonregressions+frontendbuild
  passed. Durable frozencreationintents, boundedbackgroundrecovery, ordered
  authenticatedmilestones and release/reassignmentfences implemented.
- Browser pilot with syntheticKT/Studiosimulation exercised lostacknowledgement,
  same-requestretry->Queued, and boundclaimrelease refusal. RealStudiointegration
  pilot remains distinct; simulation is not provider/delivery proof.
- Current full suites passed:Hub370/64skipped,worker438/1skipped,contracts466.
  New manual-download approvalgate adds6passingtests. Retention safetyfence6pass.
  Sharedstorage revisionfixes148tests pass. Further changes need finalcombinedrun.
- RealDB keywordintake:12concurrentrequests->onejob; differentowner/channelblocked.
  Durable transactionalKToutbox survivesrollback/outage, preservesperjobordering
  and idempotentreceipts without blocking otherjobs.
- Adminperchannel producer/uploaderassignments, live-accountrole revalidation,
  Admin-only shareddefaults and optional perchannelautomaticdelivery implemented.
  Realscheduleddelivery tests cover4concurrentqueues->1request, pause, lostclaims,
  duplicate/out-of-orderreceipts, exactrevisionchanges and automaticrecovery.
- Browser manual-uploader role landsDelivery, cannotseeKeywords/Admincontrols,
  manualmode no longerpolls/showsfalseintegrationerrors. FollowupUI makescalendar
  optional andfinalreviewrequirementsvisible; latestUIchangesawaitrebuild.
- SearchableActivityRecords with localehistory/voice/provider andrealstageevents
  implemented; recentwork bounded6rows. No invented historicalactivity.
- 0098protectedlegacyarchive+Adminroutingworklist implemented/tested withsynthetic
  data, wiredMywork. Actualsourceimport remains undone. Unmappedhistorynevergets
  inventedchannel, approval, oruploadreceipt. Sourceintro/derivative/stitch shapes
  preserved asarchive, not silentlyrepresented as supportednewworkflows.
- CleanLinuximage builds and nonrootnetwork-isolatedimports/FFmpegsmoke passed.
  `tutorial-recovery:20260908-allowlisted` is an intermediate verifiedbuild, NOT
  the latest complete release; laterstorage/archive/UIchangesrequire rebuilding.
- 0097immutableDriveversions preventblinduploaded-state reuse, same-size false
  matches and delete-before-replacement. OldDrivebytesretained. Hydration/leases
  stillunderdevelopment; legacyretentionforcedcandidates-only evenifenabled.

Remaining release gates: complete verifiedrestore/cacheconsumerwiring, secure
sourceaccount/config/dependency import rehearsal, actualintegratedrecording and
providerpilot, finalbuild/browserregression, stagingdeployment, source-delta
cutover/rollback and teammigration. Publichostname asked; Omar remainsuntouched.

## Verification evidence

Local implementation evidence (2026-09-08; not a production release):

- Keyword Tool recovery worktree: refresh uses UPSERT and preserves operator
  fields even when a claim arrives during scoring. Cookie export validation,
  bounded scraper execution and actionable authentication/rate-limit errors.
  Nine Python tests pass; frontend build passed. Live scraping not verified.
- Studio review rejects incomplete English assets before approval. Rework
  preserves files, records a reason and returns the original to recording.
  Browser pilot verified missing-thumbnail approval refusal and rework; direct
  PostgreSQL/filesystem checks confirmed retained video and recording references.
- Final review reserves slots on assigned channels under sorted channel locks.
  Real isolated PostgreSQL probe: 35 concurrent approvals, 35 unique slots,
  30/day then five next day, repeated approval preserves its reservation.
  Missing locale assets remain outstanding rather than being scheduled.
- Thumbnail editing readiness is separate from publication readiness. New
  `AWAITING_THUMBNAILS` locale drafts are created before video localization.
  Eight concurrent HTTP requests created exactly four stable drafts; another VA
  was forbidden and unapproved localization was blocked. No provider calls.
- Composer submits edited headline text and preserves saved locale text when
  switching/exporting. Pack save requests localization after approval; failure
  is also recovered by a worker scan of persisted approved packs and waiting
  drafts. Queue-outage recovery and duplicate suppression passed a real-DB /
  simulated-queue probe. Failed work is not automatically resubmitted forever.
- Worker retains a draft's assigned channel and headline copy; standard-language
  jobs require an approved locale thumbnail before spending provider quota.
- Readable neutral surfaces, simplified tab labels, My work queue, Admin-only
  team analytics, and server-side owner scoping on affected routes.
- Latest hub tests: 315 passed / 64 skipped. Contracts: 452 passed, including the
  splice payload extension. Hub type check passes. Worker build passes;
  438 worker tests passed / one skipped. Three source-revision tests pass.
  Hub production build passed with TypeScript validation enabled after stopping
  the dev server (concurrent dev/build had corrupted `.next`). Latest approval
  binding changes still require a new production build. CSS import-order
  warning fixed; optional BullMQ Valkey module warning remains. Keyword Tool's
  nine recovery tests and frontend production build were rerun and passed.
- Invalid runtime configuration no longer silently selects a mock database.
  Only explicit static-build/Vitest evaluation permits placeholders. Four
  regression cases pass; local runtime restarted against intended test storage.
- Final approval captures SHA-256 of video/thumbnail bytes and destination,
  metadata and source revision. Dispatch recomputes and verifies it. Existing
  approvals without hashes are not invented/backfilled. Real HTTP/DB/file probe
  confirms self-review, changed metadata and in-place thumbnail replacement
  rejection, immutable snapshot dispatch and duplicate suppression. Test rows
  are marked `test_only_complete` so the local publisher cannot consume them.
- Publisher compares the snapshot to inspected bytes before any Drive writes
  and checks current review/selected assets/metadata at admission. Post-dispatch
  metadata change is rejected in a real-DB probe. Full live storage E2E is not
  yet verified, and already-admitted external work cannot be silently recalled.
- Delivery walkthrough found legacy cross-producer manual status writes and
  unverified manual reports being labelled public. Manual reporting is now
  ownership-locked, requires a YouTube link/current approval, cannot override a
  dispatcher receipt, and never invents public visibility/publication time.
  Delivery list/calendar are owner-scoped for VAs. UI no longer optimistically
  claims success or calls every incomplete delivery "ready to upload".
- Browser export pilot found and fixed read-only headline inputs, CSS-variable
  font measurement (which had produced clipped text), and presence timestamp
  binding. Saved JPEG was visually inspected: complete CREATE ACCOUNT / QUICK
  SETUP copy. Deliberately overlong copy was refused before persistence.
  PNG, ZIP and approval now share decoded-assets + measured-font export checks.
- Worker automatically requests short headline copy for missing English and
  standard locale lines. Responses validated to 48 characters/line; two queue
  attempts, manual fallback, no concurrent operator edit overwrite. Actual
  paid-provider generation/quality remains unverified. Editor polls for copy.
- Localization queue requests include source-recording and thumbnail revisions;
  worker rejects stale inputs before generation and source changes after LLM.
  This is not yet complete final-delivery revision fencing.

## Known release blockers and next implementation

- A source-row/five-language batch grid is implemented and browser checked at
  1280px. API integration checks pass for owner scoping, malformed cursors,
  cross-VA approval rejection and stale selected-image rejection. Automatic
  short copy still needs an authorized provider-quality pilot.
- Persisted layouts now reopen; validated documents restore geometry/artwork.
  Shared edits now propagate to unapproved non-overridden locales, preserving
  translated copy and hosts. Explicit locale override is saved in the layout.
  Browser regression verified a shared English template edit changes an unapproved
  German draft while preserving a French override and the approved Italian image.
  This found/fixed approved previews incorrectly reconstructed from the edited
  master when historical assets lack layout documents. Approved previews now show
  their actual saved image, with an explicit replacement-draft notice for old assets.
  Tutorial portrait approval is blocked in UI/API to avoid silent 16:9 cropping;
  the real HTTP probe verifies rejection. Cross-batch newly-added-logo propagation
  remains incomplete.
- Localization recovery uses persisted draft state; more worker restart/stale
  artifact tests are needed. Source/thumbnail/cancellation checks now run before
  TTS, after TTS and at splice acceptance (final writes under source lock).
  Real-DB stale-source, replaced-thumbnail and cancelled-locale probes pass.
  Full worker execution, provider calls and restart E2E remain unverified.
- Final approval/dispatch revision binding is implemented for completed variants.
  Late locales with durable source provenance now inherit unchanged source
  approval and reserve their predetermined channel slot through a recoverable
  worker scan. Four concurrent recovery calls produced one approval/slot in the
  real-DB probe; failed/stale siblings did not block a valid locale. Changed
  English approval was not inherited. Legacy locale outputs without provenance
  still need explicit final review. Safe replacement of an existing dispatch
  revision remains incomplete. Admin channel capacity/timezone/window configuration
  and audited slot overrides are implemented. Real HTTP/DB probes verify four
  simultaneous overrides cause one change/event, VA rejection, collision/capacity
  rejection, owner-scoped history and no override after dispatch. Overrides keep
  the assigned channel and may explicitly go outside its normal time window.
  Generic advance-upload contract remains incomplete. Studio slots do NOT mean
  YouTube scheduled anything. Private/unlisted receipts retain Studio's slot.
- Admin emergency pause is implemented in Studio request admission and the
  existing Drive exchange publisher. Receipt reconciliation remains enabled.
  A shared transaction lock serializes pause changes with worker admission;
  already-admitted work may finish. Isolated API/DB probe verifies Admin-only
  writes, VA read-only state, pending hold, admission recheck and resume.
  `scripts/test-recovery-dispatch-pause.ts` makes zero external calls.
  Legacy `uploader-config`/`uploader-jobs` discovery endpoints are now explicitly
  inspection-only: they previously advertised execution without atomic admission
  or revision binding. Three route tests verify authentication, live-settings
  denial and per-job blocking. This is an intentional compatibility change;
  coordinate the external consumer before rollout. It does not cancel external
  jobs. The guarded private/unlisted Drive exchange remains separate.
  Legacy uploader dashboard GET is now read-only/Admin-only and no longer writes
  verified publication fields from unbound observations. Authenticated legacy
  callbacks are stored as unverified tutorial history, not projected into current
  approval/delivery state. Migration 0094 provides durable event-key uniqueness;
  six concurrent real-HTTP callbacks produced one observation; replaying an older
  event after a newer event remained idempotent, conflicting evidence returned 409,
  and the Studio slot/verified fields remained untouched. Two route tests verify dashboard
  observations cannot mutate jobs and VAs cannot inspect the entire network.
- Keyword Tool live ingestion, newer uncommitted user changes, milestone outbox,
  production records, productivity timeline and full UI pass remain outstanding.
  Migration 0093 begins durable stage-transition history without fabricating past
  events or counting stage duration as VA activity. Reservation history is visible
  to its owner/Admin; full productivity reporting remains unfinished.
  Manual delivery reporting now requires a YouTube URL, owner/Admin permissions
  and current approved asset bytes; it records an unverified report, not public
  visibility or verified publication. Delivery lists are server-side owner-scoped.
  Delivery now searches the full authorized archive (original/locale titles,
  keyword reference and producer), with server-side filters and 60-row keyset pages.
  Precise microsecond cursors avoid losing records at a shared millisecond boundary.
  A 63-record real-DB test returned 60+3 without duplicates/omissions, rejected
  malformed cursors and literalized SQL wildcards. Browser tests verified locale
  search finds an older original and Older results reaches the final three rows.
  Counters are explicitly page-local, not full throughput statistics.
  The local dev server exhausted its default 4 GB heap after extensive hot reloads
  while compiling login; browser checks must resume against a fresh production
  build. A fresh production build subsequently passed and browser login/logout,
  Admin schedule save, server-side reservation search, history and handed-off
  override refusal were verified. Do not interpret this as a proven production
  leak or a fixed development-server defect.
  Latest full suites: Hub 321 passed / 64 skipped, contracts 452 passed,
  worker 438 passed / 1 skipped. Hub production build, Hub type-check and worker
  build passed. Optional BullMQ Valkey import warning and skipped lint remain.
  Keyword Tool's original local checkout is at 2a2d5a3 with additional incomplete
  uncommitted changes referencing absent assign/topic_overrides/kt_statuses modules.
  Its committed history was fetched locally for comparison only, not merged:
  differences include deleted board/admin pages and unrelated prototype assets.
  Do not blanket-merge or overwrite that checkout. Recovery remains at 07904ab.
  Fetching full GitHub history still found no common ancestor with the VPS-derived
  local history. Asked which version serves current VAs before choosing how to
  port changes. Neither checkout was merged, reset, committed or pushed.
- End-to-end recording/provider/Drive/uploader pilot and final builds remain
  required. Draft pilot, deployment/rollback and VA/Admin recording checklists
  are in `docs/recovery-operations.md`; they are not production clearance.

## Local testing boundary

Isolated compose: `deploy/recovery/docker-compose.test.yml`, PostgreSQL 55438,
Redis 56388, Hub 3108. Only dummy users/fixtures; no workers or delivery credentials.
The callback probe temporarily installs a synthetic local callback credential,
refuses to replace an existing credential, then removes its own credential;
absence was verified and the local Hub restarted to discard cached test auth.
Migrations 0089–0094 are additive and included in the shipping runner;
they have been applied ONLY to the isolated database. On rollback retain the enum
value and draft records; do not delete them or run old workers over new drafts.
Retain the pause column on rollback. Old workers do not honor it: keep dispatch
disabled at the process/configuration level before rolling a publisher back.
Retain publication approval/snapshot columns. Existing unbound dispatches fail
closed in the new publisher; reconcile them before rollout, never synthesize
approval hashes for pre-existing requests.
All implementation is uncommitted on recovery branches; live repos untouched.

Live deployment commit, VPS access, safe upload destination and paid-provider test
authorization remain unverified. Complete independent local work before requiring them.

## UI direction

A calm production workbench: readable neutral surfaces, one accent, one primary
navigation, batch-oriented queues, visible next action and explicit recovery options.
Preserve recording internals and existing component primitives. No decorative imagery.

## 2026-09-08 subsequent recovery evidence (supersedes earlier access blockers)

- Source SSH and VPS2 access verified. Isolated PostgreSQL/Redis staging created;
  live teams, provider configuration and public uploader remain unchanged.
- A private source account/configuration import rehearsal rolled back cleanly:
  9 accounts, 3 channels, 38 voices, 6 prompt presets, 2,016 runtime projections
  and 4,440 original historical records preserved in the plan. No accounts were
  committed. A newer snapshot includes branding and character dependencies.
- Actual local Keyword Tool-to-Studio rewrite HTTP test passed: one job/intent,
  exact transcript and steps retained, Studio default providers/voice preserved,
  duplicate retries returned the same job. No workers or paid calls ran.
- Drive archive metadata audit and one actual verified thumbnail byte restore
  passed; see the dedicated Drive audit. Historical missing-media exceptions
  remain unresolved and are not marked uploaded or safe to delete.
- Clean candidate2 image and isolated runtime smoke passed. It is not final:
  subsequent theme/navigation fixes, migration 0099 and cache-service source
  changes require a new release build. Latest local Hub build passed before
  those UI follow-ups; browser QA caught and prompted light-theme fixes.
- Still required: full media dependency staging, safe provider/OAuth transfer,
  target-side end-to-end production pilot, final image/UI verification, hostname
  and TLS, source write-freeze/delta reconciliation, then team cutover. Omar's
  installation remains separate and untouched.

### Isolated staging import committed after successful rollback rehearsal

The assets-v2 snapshot (SHA-256
`4129016b0c3ebfa3a9e298652c196117748033789dbd3ce176f6cadb404e08e4`)
was subsequently committed to `tutorial_staging_cf_20260908` on VPS2 only.
Readback confirms 9 users, 4,440 archive records, zero scheduled jobs,
dispatch paused, uploader disabled and Drive auto-upload disabled. Import counted
2,125 branding rows, 17,558 storage records and 15,941 immutable Drive-history
rows, with no unsupported asset columns or unapplied asset tables. Media bytes
were NOT transferred or verified by this database operation. Source systems and
team access remain unchanged; future cutover still needs source-delta handling.
