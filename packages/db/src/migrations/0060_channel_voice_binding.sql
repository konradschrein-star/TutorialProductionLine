-- 0060_channel_voice_binding.sql
--
-- 1. Register three new Fish Audio voices (owner-supplied fish.audio model ids).
-- 2. Give `channels` a `voice_id` FK so "this channel speaks with this voice"
--    is a fact in the database instead of tribal knowledge.
--
-- WHY THIS EXISTS
-- ---------------
-- Nothing tied a voice to a channel. A tutorial's voice came from
-- `tutorial_jobs.tts_voice`, a free-text box in the create form
-- (tutorial-studio/_components/create.tsx:1153) that defaults to
-- `tutorial_settings.default_tts_voice`. In production that setting held
-- 'minimax_209533299589190' — an AI33/Minimax id, not a Fish reference — while
-- the provider is fish_audio. resolveVoiceForProvider() in
-- processors/tutorial/generate.ts only accepts a 32-hex Fish model id, so every
-- single tutorial job fell through to the hardcoded Alok voice
-- (b7204d4e40ef4a548c7c8547b7f73492), whatever channel it was for.
--
-- With this migration the resolution order for a fish_audio tutorial becomes:
--   job's own tts_voice (if a real Fish id)  →  the channel's bound voice
--   →  TUTORIAL_FISH_VOICE env  →  hardcoded Alok.
--
-- NOT UNIQUE ON PURPOSE: one voice serves several channels — Entrepreneurs
-- Skool and Your VirtualFD share fb17e0eb53b042c18b22d9c14ddc4f6e. A unique
-- constraint tying a voice to exactly one channel would be wrong.
--
-- Hand-written on purpose: drizzle-kit generate is broken for this repo and
-- production has NO migration tracking, so this is applied to prod BY HAND and
-- committing it does not apply it.

-- === 1. The column ===============================================

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS voice_id uuid REFERENCES tts_voices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS channels_voice_id_idx ON channels(voice_id);

-- === 2. The voices ===============================================
-- provider 'Fish' matches the existing Fish rows in tts_voices.
-- All three model ids were verified live against POST https://api.fish.audio/v1/tts
-- on 2026-08-03 (HTTP 200, real mp3 audio). An unknown id returns
-- 400 {"message":"Reference not found"} — it fails loudly, it does not fall back.

INSERT INTO tts_voices (name, provider, voice_id, language, gender, style, description, is_default, is_active)
SELECT * FROM (VALUES
  (
    'Fish — Analytical Male',
    'Fish',
    'fb17e0eb53b042c18b22d9c14ddc4f6e',
    'en',
    'male',
    'professional',
    'Fish title "Analytical Male Voice". Clear, measured, authoritative middle-aged male narrator. Channel voice for Entrepreneurs Skool AND Your VirtualFD.',
    false,
    true
  ),
  (
    'Female Tutorial',
    'Fish',
    '933563129e564b19a115bedd57b7406a',
    'en',
    'female',
    'conversational',
    'Fish title "Sarah". Young, soft, conversational female narrator. Library entry — no channel binding requested.',
    false,
    true
  ),
  (
    'Fish — Blink Blueprint Narrator',
    'Fish',
    '395ba76e58c04fd49467755b8182384e',
    'en',
    'male',
    'educational',
    'Clear, informative middle-aged male voice. Channel voice for Blink Blueprint.',
    false,
    true
  )
) AS v(name, provider, voice_id, language, gender, style, description, is_default, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM tts_voices t WHERE t.voice_id = v.voice_id AND t.provider = 'Fish'
);

-- === 3. The bindings =============================================

UPDATE channels SET voice_id = (
  SELECT id FROM tts_voices
  WHERE voice_id = 'fb17e0eb53b042c18b22d9c14ddc4f6e' AND provider = 'Fish' LIMIT 1
)
WHERE id IN (
  'eed2625d-5295-4b96-9ac3-8f4b8cdb1307',  -- Entrepreneurs Skool
  '7908448d-d67b-4bfd-a1cd-ebdd72e0c30f'   -- Your VirtualFD
);

UPDATE channels SET voice_id = (
  SELECT id FROM tts_voices
  WHERE voice_id = '395ba76e58c04fd49467755b8182384e' AND provider = 'Fish' LIMIT 1
)
WHERE id = '3906701a-61ce-4022-91e6-1268d27ef2d7';  -- Blink Blueprint
