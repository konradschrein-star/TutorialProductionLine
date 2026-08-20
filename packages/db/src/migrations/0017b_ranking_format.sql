-- Add RANKING to the content_format enum.
-- ALTER TYPE ... ADD VALUE is additive and safe to run on production
-- (cannot be wrapped in a transaction with other DDL, but Drizzle's
-- migration runner handles each statement separately).
ALTER TYPE "content_format" ADD VALUE IF NOT EXISTS 'RANKING';
