-- rebind-channel-thumbnail-archetypes-v2.sql
--
-- WHY
-- ---
-- `resolveArchetypeCandidates` (packages/db/src/repositories/thumbnail-repository.ts:203)
-- returns EARLY on a non-empty curated set:
--
--     if (curated.length > 0) return { candidates: curated, source: "curated" };
--
-- Every one of the four channels below was curated onto the SAME seven v1
-- generic archetypes ("Comparison Battle Style", "Dramatic Bold Style", ...).
-- That curation shadowed the 44 hand-picked v2 archetypes imported from the
-- Thumbnail Tool (`source_key = 'thumbnail-tool:…'`), which are bound to
-- nothing and were therefore UNREACHABLE for every channel-scoped generation.
--
-- This script replaces the v1 curation on the three live tutorial channels
-- with a DISTINCT, tutorial-appropriate subset of the v2 library each, so the
-- three channels stop producing interchangeable thumbnails.
--
-- Archetypes are addressed by `source_key`, not by name or id: source_key is
-- the stable import identity. Names are duplicated across v1/v2 ("Admin
-- Modern Productivity Style" vs "Modern Productivity Style") and ids differ
-- per environment.
--
-- DELIBERATELY LEFT UNBOUND (still reachable via the global pool for
-- channel-less jobs, just not curated onto a channel):
--   test2, "ONLY FOR TESTING, NOT AT ALL OPTIMAL"  — junk/test rows
--   "Charles 1", "Forehead Funny"                  — person-specific
--   Tutorial #8/#9/#10/#11, Phone #1/#2/#3         — held in reserve
--
-- NOT TOUCHED: Ecom Notebook (f663157d-4ed6-4361-a365-333e2d201a49) still
-- carries the v1 seven. It was out of scope for this pass; rebind it the same
-- way when its editorial direction is decided.
--
-- Idempotent: safe to re-run. Wrapped in a transaction with a post-condition
-- check that ABORTS if any source_key failed to resolve, so a partial rebind
-- can never be committed.

BEGIN;

CREATE TEMP TABLE _binding (channel_id uuid, source_key text) ON COMMIT DROP;

INSERT INTO _binding (channel_id, source_key) VALUES
  -- ── Your VirtualFD ──────────────────────────────────────────────────────
  -- Software walkthroughs (Expensify et al): clean, procedural, friendly.
  ('7908448d-d67b-4bfd-a1cd-ebdd72e0c30f', 'thumbnail-tool:cmo78zza9000vgvb0sgk2fly6'), -- Normal Tutorial Style
  ('7908448d-d67b-4bfd-a1cd-ebdd72e0c30f', 'thumbnail-tool:cmo7de6vg001pefe050l5lgy6'), -- Tutorial #1 Best Archetype
  ('7908448d-d67b-4bfd-a1cd-ebdd72e0c30f', 'thumbnail-tool:cmo7de6uu0013efe06wudueje'), -- Tutorial #12 simple
  ('7908448d-d67b-4bfd-a1cd-ebdd72e0c30f', 'thumbnail-tool:cmo7de6ui000refe034zfvooc'), -- Tutorial #13
  ('7908448d-d67b-4bfd-a1cd-ebdd72e0c30f', 'thumbnail-tool:cmo7de6v6001fefe0tcvsvwzl'), -- Walktrough #1
  ('7908448d-d67b-4bfd-a1cd-ebdd72e0c30f', 'thumbnail-tool:cmo7de6vt0021efe0gamorl4d'), -- Walktrough #2
  ('7908448d-d67b-4bfd-a1cd-ebdd72e0c30f', 'thumbnail-tool:cmo7de6uc000lefe04za2brhg'), -- Bad Software / Walktrough for Hard
  ('7908448d-d67b-4bfd-a1cd-ebdd72e0c30f', 'thumbnail-tool:cmo78zza0000hgvb03exdkidk'), -- Admin Educational Friendly Style
  ('7908448d-d67b-4bfd-a1cd-ebdd72e0c30f', 'thumbnail-tool:cmo78zz9u0009gvb0yptvmtfc'), -- Admin Modern Productivity Style
  ('7908448d-d67b-4bfd-a1cd-ebdd72e0c30f', 'thumbnail-tool:cmo7de6vc001lefe094vx97qz'), -- Design 1
  ('7908448d-d67b-4bfd-a1cd-ebdd72e0c30f', 'thumbnail-tool:cmo7de6v4001defe0t0364nh9'), -- Design 2

  -- ── Blink Blueprint ─────────────────────────────────────────────────────
  -- Design/visual-forward: feature spotlights, tips, composed layouts.
  ('3906701a-61ce-4022-91e6-1268d27ef2d7', 'thumbnail-tool:cmo7de6vn001vefe05pvumfna'), -- Design 3
  ('3906701a-61ce-4022-91e6-1268d27ef2d7', 'thumbnail-tool:cmo7de6vx0025efe0vkjlrcpv'), -- Design 4
  ('3906701a-61ce-4022-91e6-1268d27ef2d7', 'thumbnail-tool:cmo7de6vv0023efe03iu0mobm'), -- Design 5
  ('3906701a-61ce-4022-91e6-1268d27ef2d7', 'thumbnail-tool:cmo7de6v8001hefe071qo0ljx'), -- Tutorial #3
  ('3906701a-61ce-4022-91e6-1268d27ef2d7', 'thumbnail-tool:cmo7de6vz0027efe0uf3vr4he'), -- Tutorial #4
  ('3906701a-61ce-4022-91e6-1268d27ef2d7', 'thumbnail-tool:cmo7de6w10029efe0qud8mg07'), -- Tutorial #5
  ('3906701a-61ce-4022-91e6-1268d27ef2d7', 'thumbnail-tool:cmo7de6ue000nefe0f7mu1nmu'), -- Cool Feature #1
  ('3906701a-61ce-4022-91e6-1268d27ef2d7', 'thumbnail-tool:cmo7de6v2001befe0kqbkwqnj'), -- Tipps & Tricks/Lifehacks #1
  ('3906701a-61ce-4022-91e6-1268d27ef2d7', 'thumbnail-tool:cmo7de6u3000defe00ukbqecn'), -- Combination/Connection #1
  ('3906701a-61ce-4022-91e6-1268d27ef2d7', 'thumbnail-tool:cmo78zza2000lgvb0neh5bazl'), -- Admin Energetic Tech Style
  ('3906701a-61ce-4022-91e6-1268d27ef2d7', 'thumbnail-tool:cmo78zzac000zgvb0hxifyez0'), -- Casual Tech Style

  -- ── Entrepreneurs Skool ─────────────────────────────────────────────────
  -- Business/opinion: bold, high-contrast, comparison and news framing.
  ('eed2625d-5295-4b96-9ac3-8f4b8cdb1307', 'thumbnail-tool:cmo78zz9x000dgvb0l9sarkwi'), -- Admin Dramatic Bold Style
  ('eed2625d-5295-4b96-9ac3-8f4b8cdb1307', 'thumbnail-tool:cmo78zz9p0005gvb0qg95wm4f'), -- Admin Striking Warning Style
  ('eed2625d-5295-4b96-9ac3-8f4b8cdb1307', 'thumbnail-tool:cmo78zza5000pgvb09bj8iz1l'), -- Admin Comparison Battle Style
  ('eed2625d-5295-4b96-9ac3-8f4b8cdb1307', 'thumbnail-tool:cmo7de6ua000jefe0yise7bl5'), -- Admin Comparison 2 #1
  ('eed2625d-5295-4b96-9ac3-8f4b8cdb1307', 'thumbnail-tool:cmo7de6uw0015efe0t2pyos6x'), -- Comparison #1 3 Phones
  ('eed2625d-5295-4b96-9ac3-8f4b8cdb1307', 'thumbnail-tool:cmo7de6u1000befe0r8ss8fiq'), -- Comparison #2 Really Clean
  ('eed2625d-5295-4b96-9ac3-8f4b8cdb1307', 'thumbnail-tool:cmo7de6u7000hefe0q8aktieq'), -- Comparison #3 Alternatives
  ('eed2625d-5295-4b96-9ac3-8f4b8cdb1307', 'thumbnail-tool:cmo7de6u5000fefe0g8b643rg'), -- News #1
  ('eed2625d-5295-4b96-9ac3-8f4b8cdb1307', 'thumbnail-tool:cmo7de6uy0017efe0s3bmslar'), -- Humor #1
  ('eed2625d-5295-4b96-9ac3-8f4b8cdb1307', 'thumbnail-tool:cmo7de6uk000tefe0sx21gxft'), -- Tutorial #6
  ('eed2625d-5295-4b96-9ac3-8f4b8cdb1307', 'thumbnail-tool:cmo7de6um000vefe0e570za1r'); -- Tutorial #7

-- Fail loudly if any source_key does not resolve to an archetype. Binding a
-- channel to a partial set would silently narrow its rotation.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(b.source_key, ', ')
    INTO missing
    FROM _binding b
    LEFT JOIN thumbnail_archetypes a ON a.source_key = b.source_key
   WHERE a.id IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Unresolved archetype source_key(s): %', missing;
  END IF;
END $$;

-- Drop the v1 curation ONLY for the three channels being rebound.
DELETE FROM channel_thumbnail_archetypes
 WHERE channel_id IN (SELECT DISTINCT channel_id FROM _binding);

INSERT INTO channel_thumbnail_archetypes (channel_id, archetype_id)
SELECT b.channel_id, a.id
  FROM _binding b
  JOIN thumbnail_archetypes a ON a.source_key = b.source_key
ON CONFLICT (channel_id, archetype_id) DO NOTHING;

-- Post-condition: every channel got exactly what was declared for it.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s: expected %s got %s', channel_id, want, got), '; ')
    INTO bad
    FROM (
      SELECT b.channel_id,
             count(*) AS want,
             (SELECT count(*) FROM channel_thumbnail_archetypes c
               WHERE c.channel_id = b.channel_id) AS got
        FROM _binding b GROUP BY b.channel_id
    ) t
   WHERE want <> got;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Binding count mismatch — %', bad;
  END IF;
END $$;

COMMIT;
