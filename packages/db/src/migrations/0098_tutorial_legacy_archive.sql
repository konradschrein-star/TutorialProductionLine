CREATE OR REPLACE FUNCTION tutorial_archive_payload_safe(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry record; child jsonb;
BEGIN
  IF jsonb_typeof(value) = 'object' THEN
    FOR entry IN SELECT * FROM jsonb_each(value) LOOP
      IF entry.key ~* '(password|secret|credential|cookie|api[_-]?key|token|authorization|private[_-]?key)' THEN RETURN false; END IF;
      IF NOT tutorial_archive_payload_safe(entry.value) THEN RETURN false; END IF;
    END LOOP;
  ELSIF jsonb_typeof(value) = 'array' THEN
    FOR child IN SELECT * FROM jsonb_array_elements(value) LOOP
      IF NOT tutorial_archive_payload_safe(child) THEN RETURN false; END IF;
    END LOOP;
  END IF;
  RETURN true;
END $$;

CREATE TABLE IF NOT EXISTS tutorial_legacy_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system varchar(64) NOT NULL,
  source_table varchar(64) NOT NULL CHECK (source_table IN ('tutorial_jobs','tutorial_derivatives')),
  source_id uuid NOT NULL,
  source_parent_id uuid,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source_owner_id uuid,
  source_channel_id uuid,
  title text NOT NULL,
  language text,
  source_status text NOT NULL,
  needs_routing boolean NOT NULL DEFAULT false,
  -- Original JSON bytes remain unchanged; not returned by any application API.
  source_json text NOT NULL CHECK (jsonb_typeof(source_json::jsonb) = 'object' AND tutorial_archive_payload_safe(source_json::jsonb)),
  snapshot_sha256 varchar(64) NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  runtime_job_id uuid REFERENCES tutorial_jobs(id) ON DELETE SET NULL,
  assigned_channel_id uuid REFERENCES channels(id) ON DELETE SET NULL,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_system,source_table,source_id,snapshot_sha256)
);
CREATE INDEX IF NOT EXISTS tutorial_legacy_archive_owner_time ON tutorial_legacy_archive(owner_user_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS tutorial_legacy_archive_routing ON tutorial_legacy_archive(needs_routing,assigned_channel_id);
CREATE OR REPLACE FUNCTION tutorial_archive_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Migration archive source records are immutable'; END IF;
  IF (NEW.source_system,NEW.source_table,NEW.source_id,NEW.source_parent_id,NEW.source_owner_id,NEW.source_channel_id,NEW.title,NEW.language,NEW.source_status,NEW.needs_routing,NEW.source_json,NEW.snapshot_sha256,NEW.created_at)
     IS DISTINCT FROM
     (OLD.source_system,OLD.source_table,OLD.source_id,OLD.source_parent_id,OLD.source_owner_id,OLD.source_channel_id,OLD.title,OLD.language,OLD.source_status,OLD.needs_routing,OLD.source_json,OLD.snapshot_sha256,OLD.created_at) THEN
    RAISE EXCEPTION 'Migration archive source records are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tutorial_legacy_archive_immutable ON tutorial_legacy_archive;
CREATE TRIGGER tutorial_legacy_archive_immutable BEFORE UPDATE OR DELETE ON tutorial_legacy_archive FOR EACH ROW EXECUTE FUNCTION tutorial_archive_immutable();

CREATE TABLE IF NOT EXISTS tutorial_legacy_archive_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 archive_id uuid NOT NULL REFERENCES tutorial_legacy_archive(id),
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 event_type text NOT NULL,
 payload jsonb NOT NULL CHECK (tutorial_archive_payload_safe(payload)),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION tutorial_archive_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Migration archive audit events are append-only'; END $$;
DROP TRIGGER IF EXISTS tutorial_legacy_archive_events_immutable ON tutorial_legacy_archive_events;
CREATE TRIGGER tutorial_legacy_archive_events_immutable BEFORE UPDATE OR DELETE ON tutorial_legacy_archive_events FOR EACH ROW EXECUTE FUNCTION tutorial_archive_event_immutable();
