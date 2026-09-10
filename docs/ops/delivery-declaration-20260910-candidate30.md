# Candidate 30 delivery declaration — 10 September 2026

## Scope delivered locally

- Tutorial Studio now separates the embedded research board from direct intake.
- Direct intake has distinct manual and CSV workflows, exact column documentation, a downloadable template, RFC 4180 parsing, editable preview, row-linked errors, server-side validation, channel authorization and retry-stable row identities.
- Keyword integration exposes an Admin-only health/reconciliation endpoint and classifies permanent identity/auth failures separately from retryable outages.
- Procedural thumbnail preparation crops opaque black edge bars baked into source logos, preserves transparency, and adds broader 1–4 word and locale canaries.
- Uploader exchange admission no longer emits PostgreSQL's invalid `NO WAIT` token pair.
- Late-locale approval recovery now returns per-job failure evidence instead of only an opaque outstanding count.
- Recovery probes were updated to the explicit channel-group model and current persisted thumbnail-layout contract.

## Keyword Tool candidate

The GitHub-based Keyword Tool candidate is being reconciled separately. The completed local implementation includes evidence-gated scoring, conservative intent deduplication, stable keyword identity across refreshes, source provenance, actionable scraper failures, durable creation intents, ordered callbacks, restart recovery and exact reconciliation. It is not part of this Studio deployment artifact until its GitHub-line reconciliation and live-database audit pass.

## Verification evidence

- Hub Web: 101 test files passed, 4 skipped; 728 tests passed, 64 skipped.
- Worker Orchestrator: 50 test files passed, 2 skipped; 573 tests passed, 3 skipped.
- Hub Web TypeScript: passed.
- Worker Orchestrator TypeScript/build: passed.
- Hub Web production build: passed. BullMQ still emits the existing optional `@valkey/valkey-glide` warning; the build completes.
- Procedural thumbnail canaries: 17/17 passed at score 100.
- Isolated browser check: Admin login, Software & topics, manual intake and CSV intake rendered successfully after applying the missing test-only user-preferences migration.
- Isolated recovery contracts passed: stable concurrent intake; explicit five-language draft allocation; cross-VA denial; stale thumbnail/source fences; queue-outage recovery; immutable approval snapshots; Admin-only scheduling; capacity and slot collision checks; late-locale isolation; owner-scoped history; dispatch pause; single claim; exact asset hashes; idempotent/conflicting/uncertain receipt handling.
- Keyword Tool VPS-derived candidate: 85 tests passed, backend compilation and imports passed.

## Explicit environment declarations

- Production database changed by this candidate: **no**.
- Production media, thumbnails, approvals or schedules changed by this candidate: **no**.
- Omar or VPS2 services redeployed by this candidate: **no, pending final candidate seal**.
- AI thumbnails enabled on Omar: **no**.
- Production tutorials approved or scheduled to bypass human review: **no**.
- Local isolated recovery database changed: **yes** — migration `0104_user_tutorial_preferences.sql` only, after the browser test identified the missing column.
- Candidate implementation committed: **yes — `e71ec20`**.
- Candidate branch pushed: **pending at declaration commit time**.

## Gates before production enablement

1. Reconcile Keyword Tool changes onto the GitHub `origin/main` history and repeat its test/import suite.
2. Run migrations and the read-only quality audit against a copy of the live Keyword Tool database.
3. Verify one cookie-backed competitor scrape and manually review a small KEEP/REVIEW/REJECT sample.
4. Deploy the Keyword Tool integration contract disabled; deploy Studio; configure dedicated shared secrets in both directions.
5. Enable one explicit channel and claim one new keyword. Verify one creation intent, one Studio job, ordered callbacks and the same keyword/channel/producer identity on both health endpoints.
6. Do not bulk-create, approve, schedule or upload until that single-item canary passes.
