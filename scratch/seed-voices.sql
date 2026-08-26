BEGIN;

-- Native Fish voices, one per language (provider stored lowercase 'fish' so the
-- worker's channelVoiceFor() match and normalizeTtsProviderId() both resolve it).
INSERT INTO tts_voices (name, provider, voice_id, language, gender, is_default, is_active)
SELECT * FROM (VALUES
  ('Fish — German (Native)',      'fish', '90042f762dbf49baa2e7776d011eee6b', 'de', 'neutral', true, true),
  ('Fish — Spanish (Goku)',       'fish', '9f850ee9ada24b20a6866825eaefd3f8', 'es', 'neutral', true, true),
  ('Fish — French (Native)',      'fish', '6d3a8a05a287483ab32da9891d7f7fc9', 'fr', 'neutral', true, true),
  ('Fish — Portuguese (Native)',  'fish', '7fe10a00249247aabb495bae57ac80e1', 'pt', 'neutral', true, true),
  ('Fish — Russian (Native)',     'fish', '0a690dbeb3984a9f88cd39353880775f', 'ru', 'neutral', true, true),
  ('Fish — Polish (Native)',      'fish', '2532d01f4c59446d9e2144803b73e9da', 'pl', 'neutral', true, true),
  ('Fish — Czech (Native)',       'fish', 'c70c6c20aee74d8c98b01dab6743e02e', 'cs', 'neutral', true, true),
  ('Fish — Swedish (Native)',     'fish', '301d0c4865bd4b88ac84c07b3636b9cf', 'sv', 'neutral', true, true),
  ('Fish — Norwegian (Native)',   'fish', '1acd5ba72ab2480885bc3a4a8e7c6d93', 'no', 'neutral', true, true),
  ('Fish — Danish (Native)',      'fish', '869ada003346451e84a4b5db9fbc67fb', 'da', 'neutral', true, true),
  ('Fish — Arabic (Native)',      'fish', 'b8a16ccac9ad4bc78f5f3f5dd46dc6b5', 'ar', 'neutral', true, true),
  ('Fish — Chinese (Native)',     'fish', 'b4bdf5dc66004241a21ff2df165bf442', 'zh', 'neutral', true, true),
  ('Fish — Japanese (Native)',    'fish', '92c556e1a13e4ac7add3d1a8665c3cb8', 'ja', 'neutral', true, true),
  ('Fish — Korean (Native)',      'fish', 'a9574d6184714eac96a0a892b719289f', 'ko', 'neutral', true, true),
  ('Fish — Indonesian (Native)',  'fish', 'b08758ba1ffd4bca9afb72caeea3eff7', 'id', 'neutral', true, true)
) AS v(name, provider, voice_id, language, gender, is_default, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM tts_voices t WHERE t.provider = v.provider AND t.language = v.language AND t.voice_id = v.voice_id
);

-- Default narration provider = Fish.
UPDATE tutorial_settings SET default_tts_provider = 'fish_audio', updated_at = now();

-- Bind each channel to its language's native default voice (en has no seeded
-- voice → falls back to TUTORIAL_FISH_VOICE env; it/Italian has none yet).
UPDATE channels c
SET voice_id = v.id, updated_at = now()
FROM tts_voices v
WHERE v.provider = 'fish' AND v.is_default = true AND v.language = c.language
  AND c.voice_id IS DISTINCT FROM v.id;

-- Remove the leftover demo channel (0 jobs reference it).
UPDATE users SET default_tutorial_channel_id = NULL
WHERE default_tutorial_channel_id IN (SELECT id FROM channels WHERE name = 'Tutorials (EN)');
DELETE FROM channels WHERE name = 'Tutorials (EN)';

COMMIT;

\echo '--- voices seeded ---'
SELECT language, name, is_default FROM tts_voices ORDER BY language;
\echo '--- channels + bound voice ---'
SELECT c.name, c.language, (c.voice_id IS NOT NULL) AS has_voice, v.name AS voice
FROM channels c LEFT JOIN tts_voices v ON v.id = c.voice_id ORDER BY c.created_at;
\echo '--- settings ---'
SELECT default_script_provider, default_tts_provider FROM tutorial_settings LIMIT 1;
