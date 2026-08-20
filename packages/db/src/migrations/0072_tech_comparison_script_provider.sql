-- 0072 — TECH_COMPARISON declares its script provider, like RANKING does.
--
-- WHY: TECH_COMPARISON has never produced a video. Not "rarely" — zero rows in
-- content_jobs on production, ever, despite a complete pipeline (ingest →
-- script-from-research → tech-footage-collection → asset-collection → scene
-- analysis → QMS → render) and a registered Remotion composition
-- (`ComparisonMasterTimeline` in worker-render/src/remotion/Root.tsx).
--
-- An end-to-end injection on 2026-08-06 died in seconds:
--
--   status FAILED_GENERAL
--   401 {"type":"error","error":{"type":"authentication_error",
--        "message":"API key is invalid."}}
--
-- The template declares no `script_provider`, so resolution fell through to env
-- LLM_PROVIDER, which is "anthropic" on the VPS, whose key returns 401 (verified
-- directly against api.anthropic.com the same day). The job never wrote a line
-- of script.
--
-- The code half of this fix is in ai-generation.ts: the script-from-research
-- handler never loaded its template at all, so even a declared provider would
-- have been ignored. Both script call sites now share one resolver. This
-- migration supplies the value that resolver reads.
--
-- WHY deepseek: it is the provider that demonstrably works here — the tutorial
-- pipeline and the RANKING template both run on it in production daily, and
-- RANKING's row is the precedent this copies. claude_pool (:8092) answered 404
-- on the same check; gemini_pool is dead.
--
-- NOTE for whoever reads this next: 19 OTHER templates also declare no
-- script_provider and therefore also resolve to the dead "anthropic" default —
-- EXPLAINER, CASUALLY_EXPLAINED, LONG_FORM_DRAMA, VIDEO_ESSAY's siblings and
-- the rest. They have not been failing only because nothing has been running
-- them; the two formats in active production are TUTORIAL_STUDIO (its own
-- pipeline) and RANKING (declares deepseek). Fixing those is a deliberate
-- decision about each format, not a blanket UPDATE, which is why this migration
-- touches exactly one row.
--
-- DATA MIGRATION, not DDL. Safe to re-run. Rollback at the bottom.

UPDATE content_templates
SET metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{pipeline_config,script_provider}',
      '"deepseek"'::jsonb,
      true
    ),
    updated_at = now()
WHERE format::text = 'TECH_COMPARISON';

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- UPDATE content_templates
-- SET metadata = metadata #- '{pipeline_config,script_provider}',
--     updated_at = now()
-- WHERE format::text = 'TECH_COMPARISON';
