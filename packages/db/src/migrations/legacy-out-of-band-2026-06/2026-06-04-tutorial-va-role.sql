-- Add TUTORIAL_VA to the operator_role Postgres enum so we can
-- insert VA users scoped to the Tutorial Production Engine.
-- Idempotent: skipped if already present.
ALTER TYPE operator_role ADD VALUE IF NOT EXISTS 'TUTORIAL_VA';
