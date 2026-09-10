#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:?release directory required}"
config_path="${release_dir}/live.json"
backup_dir="/var/backups/tutorial-omar-localization-20260909"
primary_id="2c95bd71-e753-451e-aec1-f3fb2b603f37"
german_id="096f7862-4bd6-4ea2-bb1c-a5ce33efbb2b"
disabled_ids="2184afea-dec0-41bc-ae25-a8e9be9918d1,ede03e43-b899-41a3-935f-6802601aaeaa,db586e35-cbe2-44c8-8c23-9fe1d63d3675,915bb447-d397-4733-bcfc-1415a293ea2e"

test -f "$config_path"
tutorial_db_url="$(node -e 'const x=require(process.argv[1]); process.stdout.write(x.apps[0].env.DATABASE_URL)' "$config_path")"
install -d -m 700 "$backup_dir"
if [[ ! -f "$backup_dir/channels-before.dump" ]]; then
  pg_dump "$tutorial_db_url" --format=custom --table=channels --file="$backup_dir/channels-before.dump"
  chmod 600 "$backup_dir/channels-before.dump"
fi

psql "$tutorial_db_url" -X -v ON_ERROR_STOP=1 <<SQL
BEGIN;
UPDATE channels
SET accepts_tutorials = true,
    metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{tutorialChannelProfile}',
      coalesce(metadata->'tutorialChannelProfile', '{}'::jsonb) || jsonb_build_object(
        'version', 1,
        'primaryChannelId', '$primary_id',
        'translationEnabled', true,
        'translationMethod', 'voiceover',
        'thumbnailMode', 'procedural'
      ),
      true
    ),
    updated_at = now()
WHERE id = '$german_id';

UPDATE channels
SET accepts_tutorials = false,
    metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{tutorialChannelProfile}',
      coalesce(metadata->'tutorialChannelProfile', '{}'::jsonb) || jsonb_build_object(
        'version', 1,
        'primaryChannelId', '$primary_id',
        'translationEnabled', false,
        'translationMethod', 'none',
        'thumbnailMode', 'procedural'
      ),
      true
    ),
    updated_at = now()
WHERE id = ANY (string_to_array('$disabled_ids', ',')::uuid[]);

DO \$\$
DECLARE active_targets integer;
BEGIN
  SELECT count(*) INTO active_targets
  FROM channels
  WHERE id <> '$primary_id'
    AND accepts_tutorials
    AND coalesce((metadata->'tutorialChannelProfile'->>'translationEnabled')::boolean, false);
  IF active_targets <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active localization, found %', active_targets;
  END IF;
END \$\$;
COMMIT;
SQL

psql "$tutorial_db_url" -X -v ON_ERROR_STOP=1 -P pager=off -F $'\t' -Atc \
  "select name,language,accepts_tutorials,coalesce((metadata->'tutorialChannelProfile'->>'translationEnabled')::boolean,false) from channels where id = '$primary_id' or metadata->'tutorialChannelProfile'->>'primaryChannelId' = '$primary_id' order by is_primary desc,name;"
