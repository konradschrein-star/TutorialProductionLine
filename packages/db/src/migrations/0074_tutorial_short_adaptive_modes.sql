-- Add the adaptive sub-3-minute tutorial modes: SHORT_MATCH, SHORT_PLUS.
--
-- These modes measure the script's target length off the reference video's
-- runtime (instead of the fixed 3 min of THREE_MIN), clamped into a sub-3-min
-- band. SHORT_MATCH mirrors the source length; SHORT_PLUS runs ~15% longer,
-- with the extra spent on worked examples. See
-- apps/worker-orchestrator/src/utils/tutorial/script-prompt.ts.
--
-- tutorial_mode is the job's mode; tutorial_prompt_category is the same value
-- space used to file a job's prompt preset — both need the new values, or the
-- Create form's preset picker is empty for the new modes and the worker throws
-- "No prompt found".
--
-- ALTER TYPE ... ADD VALUE is additive and safe on production, but a newly
-- added enum value cannot be USED in the same transaction that adds it — so the
-- preset rows that reference these categories are inserted in the NEXT
-- migration (0075), not here. Mirrors 0028.
ALTER TYPE "tutorial_mode" ADD VALUE IF NOT EXISTS 'SHORT_MATCH';
ALTER TYPE "tutorial_mode" ADD VALUE IF NOT EXISTS 'SHORT_PLUS';
ALTER TYPE "tutorial_prompt_category" ADD VALUE IF NOT EXISTS 'SHORT_MATCH';
ALTER TYPE "tutorial_prompt_category" ADD VALUE IF NOT EXISTS 'SHORT_PLUS';
