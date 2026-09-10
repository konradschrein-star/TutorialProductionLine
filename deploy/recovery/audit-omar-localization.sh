#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:?release directory required}"
config_path="${release_dir}/live.json"
test -f "$config_path"
tutorial_db_url="$(node -e 'const x=require(process.argv[1]); process.stdout.write(x.apps[0].env.DATABASE_URL)' "$config_path")"

psql "$tutorial_db_url" -X -v ON_ERROR_STOP=1 -P pager=off -F $'\t' -Atc \
  "select id,name,coalesce(language,''),accepts_tutorials,is_primary,coalesce(metadata->'tutorialChannelProfile','{}'::jsonb)::text from channels order by name;"
printf '%s\n' 'INFLIGHT'
psql "$tutorial_db_url" -X -v ON_ERROR_STOP=1 -P pager=off -F $'\t' -Atc \
  "select language,status,count(*) from tutorial_jobs where source_job_id is not null and status::text not in ('COMPLETED','FAILED_SCRIPT','FAILED_AUDIO','FAILED_SPLICE','CANCELLED') group by language,status order by language,status;"
