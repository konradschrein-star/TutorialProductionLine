-- Give every active tutorial channel one host character with a rotating pose
-- library. The legacy English.png and Germanese.png images are deliberately
-- excluded: the owner rejected those two undersized portraits.
WITH tutorial_channels AS (
  SELECT id, name, language,
    (substr(md5(id::text || ':tutorial-host'),1,8) || '-' || substr(md5(id::text || ':tutorial-host'),9,4) || '-' || substr(md5(id::text || ':tutorial-host'),13,4) || '-' || substr(md5(id::text || ':tutorial-host'),17,4) || '-' || substr(md5(id::text || ':tutorial-host'),21,12))::uuid AS host_id
  FROM channels WHERE accepts_tutorials = true AND language IN ('en','de','fr','it','nl','sv')
)
INSERT INTO characters (id, name, description, role, notes, is_active)
SELECT host_id, name || ' Host', 'Primary localized tutorial presenter', 'host', 'Seeded from the approved Thumbnail Studio persona library', true
FROM tutorial_channels
ON CONFLICT (id) DO UPDATE SET role='host', is_active=true, updated_at=now();

WITH tutorial_channels AS (
  SELECT id,
    (substr(md5(id::text || ':tutorial-host'),1,8) || '-' || substr(md5(id::text || ':tutorial-host'),9,4) || '-' || substr(md5(id::text || ':tutorial-host'),13,4) || '-' || substr(md5(id::text || ':tutorial-host'),17,4) || '-' || substr(md5(id::text || ':tutorial-host'),21,12))::uuid AS host_id
  FROM channels WHERE accepts_tutorials = true AND language IN ('en','de','fr','it','nl','sv')
)
INSERT INTO character_channels (character_id, channel_id, role, is_primary)
SELECT host_id, id, 'host', true FROM tutorial_channels
ON CONFLICT (character_id, channel_id) DO UPDATE SET role='host', is_primary=true;

WITH persona_files(language, relative_path, pose, sort_order) AS (VALUES
  ('en','English/american-hero.png','smiling',0), ('en','English/american-pointing.png','pointing',1), ('en','English/american-thumbs-up.png','thumbs-up',2), ('en','English/american-explaining.png','explaining',3), ('en','English/american-finger-up.png','pro-tip',4), ('en','English/american-thinking.png','thinking',5), ('en','English/american-stop-palm.png','stop',6), ('en','English/american-celebrate.png','celebrate',7),
  ('de','germanese/german-hero.png','smiling',0), ('de','germanese/german-pointing.png','pointing',1), ('de','germanese/german-thumbs-up.png','thumbs-up',2), ('de','germanese/german-explaining.png','explaining',3), ('de','germanese/german-finger-up.png','pro-tip',4), ('de','germanese/german-thinking.png','thinking',5), ('de','germanese/german-stop-palm.png','stop',6), ('de','germanese/german-celebrate.png','celebrate',7),
  ('fr','French/french-hero.png','smiling',0), ('fr','French/french-pointing.png','pointing',1), ('fr','French/french-thumbs-up.png','thumbs-up',2), ('fr','French/french-explaining.png','explaining',3), ('fr','French/french-finger-up.png','pro-tip',4), ('fr','French/french-thinking.png','thinking',5), ('fr','French/french-stop-palm.png','stop',6), ('fr','French/french-surprised.png','surprised',7),
  ('it','Italy/italian-hero.png','smiling',0), ('it','Italy/italian-pointing.png','pointing',1), ('it','Italy/italian-thumbs-up.png','thumbs-up',2), ('it','Italy/italian-explaining.png','explaining',3), ('it','Italy/italian-finger-up.png','pro-tip',4), ('it','Italy/italian-thinking.png','thinking',5), ('it','Italy/italian-hero-2.png','smiling-2',6), ('it','Italy/italian-thumbs-up-2.png','thumbs-up-2',7),
  ('nl','Dutch/dutch-hero.png','smiling',0), ('nl','Dutch/dutch-pointing.png','pointing',1), ('nl','Dutch/dutch-thumbs-up.png','thumbs-up',2), ('nl','Dutch/dutch-explaining.png','explaining',3), ('nl','Dutch/dutch-finger-up.png','pro-tip',4), ('nl','Dutch/dutch-thinking.png','thinking',5), ('nl','Dutch/dutch-stop-palm.png','stop',6),
  ('sv','Swedish/swedish-hero.png','smiling',0), ('sv','Swedish/swedish-pointing.png','pointing',1), ('sv','Swedish/swedish-thumbs-up.png','thumbs-up',2), ('sv','Swedish/swedish-finger-up.png','pro-tip',3), ('sv','Swedish/swedish-thinking.png','thinking',4), ('sv','Swedish/swedish-stop-palm.png','stop',5), ('sv','Swedish/swedish-surprised.png','surprised',6)
), tutorial_channels AS (
  SELECT id, language,
    (substr(md5(id::text || ':tutorial-host'),1,8) || '-' || substr(md5(id::text || ':tutorial-host'),9,4) || '-' || substr(md5(id::text || ':tutorial-host'),13,4) || '-' || substr(md5(id::text || ':tutorial-host'),17,4) || '-' || substr(md5(id::text || ':tutorial-host'),21,12))::uuid AS host_id
  FROM channels WHERE accepts_tutorials = true
)
INSERT INTO character_images (character_id, image_path, original_path, pose, source_filename, sort_order, is_active)
SELECT tc.host_id,
  '/opt/tutorial-studio/apps/hub-web/public/' || pf.relative_path,
  '/opt/tutorial-studio/apps/hub-web/public/' || pf.relative_path,
  pf.pose, regexp_replace(pf.relative_path, '^.*/', ''), pf.sort_order, true
FROM tutorial_channels tc JOIN persona_files pf ON pf.language=tc.language
ON CONFLICT (character_id, image_path) DO UPDATE SET is_active=true, pose=excluded.pose, sort_order=excluded.sort_order, updated_at=now();
