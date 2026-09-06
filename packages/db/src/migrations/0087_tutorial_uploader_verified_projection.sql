-- Keep Tutorial Studio's channel identities and legacy upload projection in
-- sync with the proof-gated direct uploader exchange.

UPDATE channels
SET youtube_channel_id = CASE language
      WHEN 'en' THEN 'UC7rwqoNmW4EthwQegKTlwfQ'
      WHEN 'de' THEN 'UC8KUoPeQ8rCWOmRobKe9CJg'
      WHEN 'fr' THEN 'UCWlIF9Y9-cQUt102uTeeOLg'
      WHEN 'it' THEN 'UCjIPDmte0JEUzQsUa0IyJTA'
      WHEN 'sv' THEN 'UCw9ll3oNGTkhzkdOrw5K_Yw'
      ELSE youtube_channel_id
    END,
    uploader_channel_key = CASE language
      WHEN 'en' THEN 'tutorial_usa'
      WHEN 'de' THEN 'tutorial_german'
      WHEN 'fr' THEN 'tutorial_french'
      WHEN 'it' THEN 'tutorial_italian'
      WHEN 'sv' THEN 'tutorial_swedish'
      ELSE uploader_channel_key
    END,
    updated_at = now()
WHERE name IN (
  'USA Tutorials', 'German Tutorials', 'French Tutorials',
  'Italian Tutorials', 'Swedish Tutorials'
)
AND language IN ('en', 'de', 'fr', 'it', 'sv');

-- Dutch remains a Studio/archive channel but is intentionally not connected
-- to automated upload dispatch.
UPDATE channels
SET uploader_channel_key = NULL,
    updated_at = now()
WHERE name = 'Dutch Tutorials' AND language = 'nl';

-- Receipts written before the verified projection was added are already
-- immutable proof. Reconcile only complete terminal successes; never infer a
-- success from a partial, failed, rejected, or uncertain exchange.
UPDATE tutorial_jobs AS job
SET uploader_status = 'uploaded',
    youtube_visibility = dispatch.attributes->>'visibility',
    scheduled_for = NULL,
    is_uploaded = true,
    uploaded_at = COALESCE(dispatch.terminal_at, dispatch.updated_at),
    youtube_published_at = NULL,
    uploaded_by = 'tutorial-uploader',
    youtube_upload_url = dispatch.youtube_video_url,
    uploader_job_id = dispatch.exchange_job_id::text,
    uploader_last_callback_at = COALESCE(dispatch.terminal_at, dispatch.updated_at),
    upload_verified_at = COALESCE(
      job.upload_verified_at,
      dispatch.terminal_at,
      dispatch.updated_at
    ),
    updated_at = now()
FROM tutorial_upload_dispatches AS dispatch
WHERE dispatch.tutorial_job_id = job.id
  AND dispatch.state = 'succeeded'
  AND dispatch.latest_sequence > 0
  AND dispatch.youtube_video_id IS NOT NULL
  AND dispatch.youtube_video_url IS NOT NULL
  AND dispatch.proof_ref IS NOT NULL
  AND dispatch.attributes->>'visibility' IN ('private', 'unlisted');
