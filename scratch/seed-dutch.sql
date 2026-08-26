BEGIN;

-- Dutch native Fish voice.
INSERT INTO tts_voices (name, provider, voice_id, language, gender, is_default, is_active)
SELECT 'Fish — Dutch (Native)', 'fish', '476dfde8297c4f6eb9bdca9dade98cee', 'nl', 'neutral', true, true
WHERE NOT EXISTS (
  SELECT 1 FROM tts_voices t WHERE t.provider='fish' AND t.language='nl'
    AND t.voice_id='476dfde8297c4f6eb9bdca9dade98cee'
);

-- Dutch channel (unlinked until YouTube creds are added), bound to the Dutch voice.
INSERT INTO channels (youtube_channel_id, name, language, accepts_tutorials, voice_id)
SELECT 'pending-' || gen_random_uuid(), 'Dutch Tutorials', 'nl', true,
       (SELECT id FROM tts_voices WHERE provider='fish' AND language='nl' AND is_default LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name='Dutch Tutorials');

-- Re-bind any channel whose language now has a native default voice but isn't bound.
UPDATE channels c
SET voice_id = v.id, updated_at = now()
FROM tts_voices v
WHERE v.provider='fish' AND v.is_default=true AND v.language=c.language
  AND c.voice_id IS DISTINCT FROM v.id;

COMMIT;

\echo '--- channels ---'
SELECT c.name, c.language, (c.voice_id IS NOT NULL) AS has_voice, v.name AS voice
FROM channels c LEFT JOIN tts_voices v ON v.id=c.voice_id ORDER BY c.created_at;
\echo '--- languages with a seeded voice ---'
SELECT string_agg(language, ', ' ORDER BY language) FROM tts_voices WHERE is_active;
