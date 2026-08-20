-- Add DRAMA_OPERATOR to the operator_role Postgres enum so we can
-- insert users with this role. Idempotent: skipped if already present.
ALTER TYPE operator_role ADD VALUE IF NOT EXISTS 'DRAMA_OPERATOR';
