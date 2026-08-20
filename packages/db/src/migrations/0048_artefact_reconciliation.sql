-- 0048: artefact reconciliation support
--
-- Makes a job's artefact location AUTHORITATIVE instead of always inferred.
-- Today the job-detail resolver infers where a render landed by probing the
-- media root; inference is the right *fallback*, not the right *source of
-- truth*. These columns let a successful render record where it put the final
-- video, and let the reconciler (packages/db/src/scripts/reconcile-artefacts.ts)
-- record the on-disk verdict without guessing.
--
-- Hand-written (drizzle-kit generate is broken here — journal stale; do NOT
-- attempt to repair the history as a side effect).
-- Owner: Jobs / IA, execution session 2026-07-28.
-- Plan:      docs/sessions/2026-07-28-plans/jobs-and-ia.md  (§2.4 J8, §3)
-- Decision:  docs/sessions/2026-07-28-DECISIONS.md  §3.5, C6
-- Allocation: docs/sessions/2026-07-28-MIGRATION-ALLOCATION.md  (block 0048)
--
-- NOT applied to prod by this session. All statements idempotent.
--
-- Semantics enforced in code, not here:
--   final_video_path        — written by worker-render at render completion.
--                             The resolver PREFERS it when set AND the file
--                             exists; when set and the file is gone it says so
--                             explicitly (never a silent fallback, never hides
--                             the discrepancy).
--   artefacts_verified_at   — written ONLY by the reconciler. NULL = never run.
--   artefacts_missing_count — written ONLY by the reconciler. NULL = unknown
--                             (never shown as 0 to mean "no reconciliation").

ALTER TABLE "content_jobs"
  ADD COLUMN IF NOT EXISTS "final_video_path"        text;

ALTER TABLE "content_jobs"
  ADD COLUMN IF NOT EXISTS "artefacts_verified_at"   timestamptz;

ALTER TABLE "content_jobs"
  ADD COLUMN IF NOT EXISTS "artefacts_missing_count" integer;

COMMENT ON COLUMN "content_jobs"."final_video_path" IS
  'Authoritative on-disk path of the final render, written by worker-render at completion. Resolver prefers it when the file exists; surfaces a discrepancy when set but gone. Never silently falls back.';

COMMENT ON COLUMN "content_jobs"."artefacts_verified_at" IS
  'Last time reconcile-artefacts checked this job against disk. NULL = never reconciled (shown as "never run", not as a zero).';

COMMENT ON COLUMN "content_jobs"."artefacts_missing_count" IS
  'Count of manifest entries whose file was absent at the last reconciliation. NULL = unknown / never run. Written only by the reconciler.';
