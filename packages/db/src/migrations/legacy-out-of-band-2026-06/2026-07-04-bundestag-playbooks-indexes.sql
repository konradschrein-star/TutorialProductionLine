-- packages/db/src/schema/bundestag-playbooks.ts declares job_id/active/version
-- indexes plus a UNIQUE (job_id, version) constraint, but only the primary
-- key + FK were ever applied to production (confirmed missing from the
-- 2026-07-02 prod schema baseline) — same migration gap as bundestag_clips.
-- Caught live: bundestag-playbook-generation.ts's
-- .onConflictDoUpdate({ target: [job_id, version] }) failed with "there is
-- no unique or exclusion constraint matching the ON CONFLICT specification"
-- because bundestag_playbooks_job_version_unique never existed.
-- Idempotent: skipped if already present.
CREATE INDEX IF NOT EXISTS bundestag_playbooks_job_id_idx ON bundestag_playbooks (job_id);
CREATE INDEX IF NOT EXISTS bundestag_playbooks_active_idx ON bundestag_playbooks (job_id, is_active);
CREATE INDEX IF NOT EXISTS bundestag_playbooks_version_idx ON bundestag_playbooks (job_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS bundestag_playbooks_job_version_unique ON bundestag_playbooks (job_id, version);
