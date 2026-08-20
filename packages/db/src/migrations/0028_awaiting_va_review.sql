-- Add AWAITING_VA_REVIEW to the job_status enum.
-- ALTER TYPE ... ADD VALUE is additive and safe to run on production
-- (cannot be wrapped in a transaction with other DDL, but Drizzle's
-- migration runner handles each statement separately). Mirrors 0017.
ALTER TYPE "job_status" ADD VALUE IF NOT EXISTS 'AWAITING_VA_REVIEW';
