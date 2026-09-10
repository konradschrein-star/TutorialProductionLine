# Delivery declaration — Tutorial intake identity v2

Date: 2026-09-10  
Candidate: `codex/tutorial-recovery-c31`  
Deployment status: **not deployed**  
Live-data status: **not touched**

## Delivered in this candidate

- Canonical UUID intake identity and frozen route snapshot.
- Source-bound Keyword Tool ingestion credential (`KT_INGEST_TOKEN` +
  `KT_EXTERNAL_SOURCE`), independent of the general Content Forge API token.
- Exact replay before mutable producer/channel admission and deterministic 409
  reconciliation for request/run collisions.
- Database all-or-none/root-only identity constraints and source-scoped partial
  uniqueness for request and production-run identifiers.
- Transactional PostgreSQL generation-dispatch outbox with stable BullMQ job
  identifiers and retry leasing.
- Exact legacy v1 milestone envelopes plus identity-complete v2 milestones.
- Strict v2 callback receipt verification and namespaced reconciliation/mapping.
- Integration-health projection for identity-v2 jobs and dispatch-outbox backlog.

## Verification evidence

- Hub focused tests: 4 files, 36 passed.
- Worker focused tests: 2 files, 6 passed.
- Database focused tests: 1 file, 3 passed.
- Hub full suite: 102 files passed, 4 skipped; 739 tests passed, 64 skipped.
- Worker full suite: 51 files passed, 2 skipped; 576 tests passed, 3 skipped.
- Database full suite: 8 files passed, 3 skipped; 45 tests passed, 23 skipped.
- Package checks: Hub type-check passed; Worker, DB, and Config builds passed.
- Hub production build passed. It retains the pre-existing BullMQ warning that
  optional package `@valkey/valkey-glide` is not installed.
- The complete Tutorial Studio migration runner, including migration 0105,
  applied twice successfully to an isolated populated PostgreSQL database.
- Isolated integration probe passed with 20 concurrent requests and confirmed:
  exactly one job, run and request collision rejection, source namespace
  isolation, partial/child identity rejection, durable dispatch, v1 envelope
  preservation, and v2 receipt verification. External calls: zero.

## Explicit non-deliveries / rollout blockers

This candidate is not approved for production rollout until the separate
Keyword Tool deployment provides the matching identity-v2 sender and callback
receiver. It must:

1. persist and retry the exact frozen create request;
2. bind early callbacks by `(external_source, request_id)` or
   `(external_source, production_run_id)`;
3. authenticate callback secrets against the asserted source;
4. echo the complete v2 receipt identity;
5. accept `DRIVE_VERIFIED` without treating it as YouTube publication; and
6. reconcile the Studio read projection by namespaced identity and request hash.

Deploy the Keyword Tool receiver/migrations first, then Studio migration 0105,
web, and worker. Enable normal traffic only after one synthetic end-to-end
canary proves create, durable generation dispatch, early callback binding,
ordered milestones, and exact receipt verification.
