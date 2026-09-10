# Tutorial recovery: pilot and operating runbook

Status: local recovery candidate, not cleared for production. See
`recovery-execution.md` for current evidence and unresolved release gates.
Do not retire the embedded Content Forge workflow based on this document.

## Required release gates

- Identify deployed commits, worker versions, storage locations and the owner of
  each active queue. Reconcile the standalone and embedded operations without
  moving or cancelling real work.
- Review the diff and preserve all existing operator changes. Keyword Tool's
  original dirty checkout is separate from the recovery worktree; reconcile it
  deliberately, not by copying over it.
- Verify publication-asset approval binding with the complete worker/storage
  path and finish the generic advance-upload contract. A Studio slot alone is not an externally
  scheduled video; a private upload is not public publication.
- Exercise shared thumbnail edits/overrides, late locale completion, provider
  failure/retry, restart recovery, and the complete representative batch.
- Obtain explicit approval for the pilot destination, provider credit ceiling,
  external scheduling/publication and production deployment. Keep the old
  operation available until results and asset inventories reconcile.

## Local verification commands

Use only the isolated recovery PostgreSQL database on port 55438 and Redis on
56388. The scripts reject other database URLs; never relax these guards to test
production. Fixture credentials are not production credentials.

1. Start the services defined by `deploy/recovery/docker-compose.test.yml`.
2. Run the seed script with the isolated database configuration. Start only the
   Hub on port 3108 with Drive disabled. Do not start all workers with a copied
   production environment.
3. Run `pnpm --filter @repo/hub-web type-check` and
   `pnpm --filter @repo/hub-web test`.
4. Run `pnpm --filter @repo/contracts test`,
   `pnpm --filter @repo/worker-orchestrator test`, and the corresponding builds.
5. Run `scripts/test-recovery-scheduling.ts`,
   `scripts/test-recovery-thumbnail-drafts.ts`, and
   `scripts/test-recovery-dispatch-pause.ts` and
   `scripts/test-recovery-publication-approval.ts` using `pnpm exec tsx` and the isolated
   environment. They retain test records/assets for browser inspection and remove
   their own waiting translation requests. No provider or uploader is exercised.
6. Build the Hub with `pnpm --filter @repo/hub-web build`. This now checks types.
   Lint remains a separate uncompleted release check. Do not build over the same
   `.next` directory while relying on the dev server for final browser evidence;
   restart the local server after the build before the last walkthrough.

## Controlled end-to-end pilot

Use three originals in one software batch: ordinary flow, deliberately long
translated headline, and a recoverable recording mistake. Assign each destination
channel before production. Use test-only records and the approved spending limit.

For each original, verify keyword claim/manual-topic creation, script autosave,
audio, recording, background processing, five thumbnail drafts, copy generation,
saved layout reload, thumbnail approval, localization, English final review and
slot reservation. Continue recording another original while the first processes.

Inject one locale failure and one integration outage. Verify unrelated work
continues, the failure offers a retry, and repeated approval/retry creates no
duplicate production job. Replace a selected thumbnail and source revision during
processing; stale work must not be accepted. The local fence probes are not a
substitute for executing these worker cases.

For delivery, first use a fake receiver, then an explicitly authorized non-public
canary. Match video/thumbnail checksums, channel identity and metadata. Exercise
duplicate/out-of-order callbacks and a timeout after acceptance. An uncertain
outcome requires reconciliation, never a blind second upload. Scheduled/public
publication needs its own separately authorized verification.

## SOP recordings to make for VAs

1. **Start a software batch:** identify the assigned channel, inspect the topic
   and reference, claim it, discard unsuitable topics with a reason, and use
   manual topics when the optional Keyword Tool is unavailable.
2. **Record and continue:** review script/voice, record, confirm submission,
   distinguish processing from a failed submission, and start the next tutorial.
   Do not resubmit repeatedly because an asynchronous stage is waiting.
3. **Approve thumbnail packs:** open Batches, compare EN/DE/FR/IT/SV, correct short
   copy, add real software logos and use the procedural editor. Demonstrate
   shared edits, explicit locale overrides, text-fit errors, saved-layout reload,
   and approved rows leaving the pending view. Check every language before approval.
4. **Final review and rework:** inspect the English video and metadata; view all
   thumbnail/locale indicators. Approve your own completed work or request rework
   with a concrete reason. Rework retains files; it does not cancel external work.
5. **Recover one failure:** read the stage/error, verify whether the service is
   unavailable, retry once through the workflow and escalate persistent failures
   with the tutorial ID, language and time—never credentials or raw provider keys.
6. **Understand delivery:** distinguish Studio-reserved slots, queue requests,
   uploaded files, external schedule confirmation and verified publication. Use
   the manual Drive path only after checking for an existing/uncertain uploader
   request to avoid duplicate uploads.

Record against a verified pilot build, not unfinished screens. Keep each SOP
short and show one successful example plus its common recovery path.

## Admin emergency control

Delivery & Uploads contains an Admin-only emergency-pause action. VAs can read
the state but cannot change it. Pause is serialized with new handoff admission;
already admitted work may finish. The existing publisher continues reconciling
receipts. No external cancellation is implied or performed.

Before resuming: inspect outstanding and uncertain requests, reconcile with the
separate uploader, resolve corrections and verify the intended channels. Record
who made the decision and why in the operational incident log. A richer persisted
audit timeline is still required; the current setting records the last updater.

## Deployment and rollback sequence (not yet authorized)

1. Back up the database and inventory media/Drive references. Test restoration.
   Capture queue counts and the versions/configuration of every running service.
2. Pause admission and stop publisher/production workers at a controlled boundary.
   Reconcile in-flight external requests; stopping a worker does not undo them.
3. Apply reviewed additive migrations before deploying code that reads new
   columns/statuses. Recovery additions 0089–0094 are in the tutorial shipping
   runner. Review the entire runner against the actual database first; do not
   blindly rerun unrelated data migrations.
4. Deploy matching contracts, DB package, Hub and worker artifacts. Keep provider
   and delivery execution disabled until the canary gates pass. Verify secrets
   resolve server-side and no development fallback configuration is used.
5. Enable a bounded pilot, review actual artifacts and receipts, then explicitly
   authorize gradual rollout. Maintain the old Content Forge operation untouched.

On rollback, keep new columns, enum values, drafts and retained media. Do not
delete user work or downgrade the database destructively. Old workers may not
understand `AWAITING_THUMBNAILS` and do not honor the new pause control; keep them
stopped or dispatch-disabled until queue compatibility is established. Restore
application artifacts only after reconciling in-flight external work.

Migration 0091 does not backfill approvals. Pre-existing approved tutorials need
reviewed byte snapshots, and existing dispatches without a snapshot need explicit
reconciliation. Do not blindly requeue them: the external uploader may already
have accepted the original request. New late locales with durable source revision
provenance can inherit an unchanged source approval and reserve a Studio slot.
Legacy outputs without that provenance need explicit review. Verify the full
worker path before enabling `TUTORIAL_PUBLICATION_RECOVERY_ENABLED` in production;
it defaults on in the new worker, so explicitly set it false during rollout gates.

## Channel capacity and slot overrides

In Delivery, Admins can configure each channel's timezone, daily capacity and
distribution window. Default is 30/day, 08:00–20:00 UTC. Changing these settings
does not move existing reservations. Under Publication reservations, choose a
tutorial and enter a future UTC ISO timestamp ending in Z plus a reason. An
override retains its assigned channel and enforces its daily capacity; it may
deliberately fall outside the usual window. History records the previous/new
time, actor and reason atomically. Duplicate identical requests create no extra
event. Work with a delivery request cannot be moved here—reconcile the separate
uploader first. This UI never claims to change an external schedule.

The reservation list shows the next 100 undelivered entries. History shows up to
100 recent events recorded since migration 0093, with no fabricated historical
backfill. Stage timestamps measure stage residence, not active VA effort.
Manual upload reports are explicitly unverified and require a YouTube URL; they
must not be counted as verified public releases.

Delivery search covers the full authorized archive, including locale titles,
keyword references and producer names. Use Older results and Newest page for
bounded 60-original pages. Filters refer to the original's upload report, not all
its locales; expand the original to inspect language outcomes. Counters describe
the displayed page, not network-wide production totals.

Legacy uploader callbacks are retained as unverified observations (migration
0094), deduplicated by tutorial/event key. They do not overwrite the Studio slot
or verified publication fields. Conflicting reuse of a key returns 409 and keeps
the first observation. Coordinate the discovery/callback compatibility changes
with the uploader owner before deploying; see `docs/ops/uploader-integration.md`.
