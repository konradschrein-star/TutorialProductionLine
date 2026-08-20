-- 0049 — Clip Forge layout-key repair + debug-flag scrub
--
-- Two production data defects, both silent, both burned into deliverables:
--
--   1. Snake_case `layout_kind` instead of camelCase `layoutKind` in
--      cf_finishing_variants.layout_options. The render runner
--      (cf-render-variant.mjs) dispatches the V2 layout on `layoutKind` only;
--      the snake key made the check evaluate false and the composition
--      SILENTLY fell through to the legacy fullscreen layout (wrong crop +
--      hardcoded MARCK x FINANZAMTLER / FOLGE FUER MEHR brand bands). 4 of 7
--      production variants shipped the wrong layout this way.
--
--   2. `showHitboxes: true` in layout_options — a debug affordance meant to be
--      a UI-only SVG overlay ("Not baked into the MP4") that burned green
--      "FACE 0.90" boxes and yellow guide lines into the MP4. Unpostable.
--
-- The runner is also patched to THROW on a v2-* template with no layout kind
-- and to hardcode showHitboxes=false, so this can never recur. This migration
-- repairs the rows already written under the bug. Hand-written SQL
-- (drizzle-kit generate is broken in this repo).

BEGIN;

-- 1. Promote snake_case layout_kind -> camelCase layoutKind where the camel key
--    is absent, then drop the stale snake key.
UPDATE cf_finishing_variants
SET layout_options =
      (layout_options - 'layout_kind')
      || jsonb_build_object('layoutKind', layout_options->>'layout_kind')
WHERE layout_options ? 'layout_kind'
  AND NOT (layout_options ? 'layoutKind');

-- 2. If both keys somehow coexist, drop the stale snake key (camel wins).
UPDATE cf_finishing_variants
SET layout_options = layout_options - 'layout_kind'
WHERE layout_options ? 'layout_kind';

-- 3. Scrub the debug overlay flag from every row. The runner no longer reads
--    it, but stored data must not carry a flag that once reached an MP4.
UPDATE cf_finishing_variants
SET layout_options = layout_options - 'showHitboxes'
WHERE layout_options ? 'showHitboxes';

COMMIT;
