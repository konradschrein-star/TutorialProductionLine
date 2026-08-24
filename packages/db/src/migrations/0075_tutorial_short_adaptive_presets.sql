-- Seed a default prompt preset for each new adaptive short mode (0074).
--
-- Without a preset in these categories, the Create form's preset picker is
-- empty for SHORT_MATCH / SHORT_PLUS and the worker throws "No prompt found".
--
-- The persona is copied from the channel's CURRENT default THREE_MIN preset, so
-- the two new modes start from the exact 3-minute prompt that is live in this
-- database (which may have been hand-edited past the seed file), not a possibly
-- stale literal. The Match vs Plus difference is NOT in the persona — it lives
-- in the code-side length line (buildShortAdaptiveLengthLine), the same way
-- THREE_MIN and SIX_MIN share one preset and differ only in target length.
--
-- Runs in its own migration (not 0074) because a newly added enum value cannot
-- be used in the same transaction that adds it. Idempotent via NOT EXISTS —
-- the table has no unique constraint to hang ON CONFLICT on.
INSERT INTO tutorial_prompt_presets (category, name, system_prompt, is_seeded, is_default)
SELECT
  'SHORT_MATCH',
  'Short — Match reference length (default)',
  p.system_prompt,
  true,
  true
FROM tutorial_prompt_presets p
WHERE p.category = 'THREE_MIN'
  AND p.is_default = true
  AND NOT EXISTS (
    SELECT 1 FROM tutorial_prompt_presets x WHERE x.category = 'SHORT_MATCH'
  )
ORDER BY p.updated_at DESC
LIMIT 1;

INSERT INTO tutorial_prompt_presets (category, name, system_prompt, is_seeded, is_default)
SELECT
  'SHORT_PLUS',
  'Short — Plus, reference + examples (default)',
  p.system_prompt,
  true,
  true
FROM tutorial_prompt_presets p
WHERE p.category = 'THREE_MIN'
  AND p.is_default = true
  AND NOT EXISTS (
    SELECT 1 FROM tutorial_prompt_presets x WHERE x.category = 'SHORT_PLUS'
  )
ORDER BY p.updated_at DESC
LIMIT 1;
