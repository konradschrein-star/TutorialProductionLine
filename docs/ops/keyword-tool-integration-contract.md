# Keyword Tool ↔ Tutorial Studio lifecycle contract

The Keyword Tool remains a separately deployable service. Tutorial Studio owns
production/rendering and sends ordered milestones back. Loading the embedded
board proves SSO only; it does not prove lifecycle synchronization.

## Stable identities and ownership

- `kt_keywords.id` is serialized as `tutorial_jobs.keyword_ref` and never inferred
  from a title.
- The Keyword Tool claim owner is sent as `claimed_by_email`, including when a
  manager presses Produce on the VA's behalf.
- `channel_id` is selected before production and is never randomized by either
  bridge.
- Every create is saved locally before HTTP with a UUID `intent_id`. That same
  ID is the Studio `Idempotency-Key` for every retry.
- Studio provider, prompt and voice settings are not accepted from Keyword Tool;
  they remain tenant/channel configuration in Studio.

## Exact milestones

Studio writes a durable outbox row for each relevant tutorial status change.
Each row has a per-job increasing `event_sequence` and stable `dedup_key`.
Keyword Tool applies a callback only when:

1. bearer authentication succeeds;
2. `forge_job_id` is already bound to exactly one keyword;
3. `keyword_ref` matches that bound keyword;
4. the sequence is newer than the stored checkpoint; and
5. the Studio status is recognized.

Duplicates receive an idempotent verified receipt. Older events are retained as
audit observations and cannot regress the board. Unordered legacy events are
audit-only and explicitly require reconciliation. Workflow completion never
copies a supplied `youtube_url`; publication remains a separate verified action.

## Failure and reconciliation policy

- A timeout/5xx leaves the frozen create intent `uncertain`; a bounded recovery
  worker retries the exact same body and idempotency key.
- Parallel Produce clicks share a lease, so only one network send is admitted.
- After eight uncertain attempts, automatic retries pause without deleting the
  request.
- A 409 or mismatched acknowledgement is not treated as success. A manager may
  reconcile only after Studio's read endpoint proves the exact keyword, producer
  and channel identity.
- Generic release/reassignment/delete paths are fenced for bound or possibly
  accepted work. Rework stays attached to the existing Studio job.
- Callback 4xx/identity errors remain in the Studio outbox and back off for an
  hour with a non-secret operational category. Temporary failures retry with
  exponential backoff.

## Configuration

Studio:

```text
KT_EMBED_URL=<Keyword Tool browser origin>
KT_API_URL=<Keyword Tool API origin>
KT_EMBED_SECRET=<shared SSO secret>
KT_STATUS_WEBHOOK_URL=<Keyword Tool /api/integration/forge/job-status>
KT_WEBHOOK_SECRET=<dedicated callback bearer secret>
KT_INGEST_TOKEN=<dedicated Keyword Tool -> Studio identity-v2 bearer token>
KT_EXTERNAL_SOURCE=<stable lowercase source namespace, e.g. keyword-tool.omar>
```

Keyword Tool:

```text
CONTENT_FORGE_ENABLED=true
CONTENT_FORGE_API_URL=<Studio server origin>
CONTENT_FORGE_PUBLIC_URL=<Studio browser origin>
CONTENT_FORGE_KT_PUBLIC_URL=<Keyword Tool browser origin>
CONTENT_FORGE_SHARED_SECRET=<same value as Studio KT_INGEST_TOKEN>
CONTENT_FORGE_INTENT_RECOVERY_ENABLED=true
KT_EMBED_SECRET=<same SSO secret>
KT_WEBHOOK_SECRET=<same value as Studio KT_WEBHOOK_SECRET>
```

Never reuse a user password or browser cookie for either machine direction.

## Identity v2 admission and callback

An identity-v2 create carries `external_source`, `request_id`,
`production_run_id`, `opportunity_id`, `family_id`, `evidence_id`, and
`route_decision_id` inside `identity`. UUIDs are canonical lowercase values and
`Idempotency-Key` equals `request_id`. Studio binds the asserted source to
`KT_INGEST_TOKEN`/`KT_EXTERNAL_SOURCE`, freezes channel, language, and format,
and atomically creates a PostgreSQL generation-dispatch intent with the job.

The create receipt includes `jobId`, `requestId`, `productionRunId`, and
`dispatchDurable: true`. An exact retry returns the existing job even if the VA
or channel configuration changed after admission. Reuse of either request or
run identity for different work returns HTTP 409 and requires reconciliation.

V2 callbacks include the complete identity plus the frozen route. A verified
receipt must echo every identity field as well as the job, keyword, sequence,
and deduplication key. `DRIVE_VERIFIED` means the durable Drive artifact exists;
it never asserts that YouTube publication occurred. Legacy jobs retain the v1
callback envelope and `UPLOADED` milestone unchanged.

## Safe rollout and historical divergence

1. Deploy the additive Keyword Tool tables/routes first with integration disabled.
2. Deploy Studio's outbox migration and worker.
3. Configure dedicated secrets and enable both directions.
4. Use one newly claimed synthetic keyword with an explicit channel. Confirm one
   creation intent, one Studio job, exact binding, and ordered callbacks.
5. Compare Keyword Tool `/api/integration/forge/status` with Studio
   `/api/production/keywords/integration-status` before enabling normal work.

The observed estate currently has about 1,910 Studio jobs while Keyword Tool
reports 259 claimed, one recording and zero done. Do not fabricate a backfill by
matching titles: duplicates, translations and historical renames make that unsafe.
Only numeric `keyword_ref` rows are automatic reconciliation candidates. Rows
without an exact reference remain a named manual-audit population in the Studio
status endpoint.
