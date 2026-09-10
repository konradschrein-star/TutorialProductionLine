#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ "$(id -u)" == "0" ]] || { echo "run as root" >&2; exit 1; }
readonly container="tutorial-recovery-staging-postgres-1"
readonly database="tutorial_staging_cf_20260908"
readonly rehearsal="tutorial_staging_c24_rehearsal"
readonly migration="/opt/tutorial-recovery-staging/0104_user_tutorial_preferences.sql"
readonly migration_sha="7a63a7baf359566ef1949eb5555dd6b8fc29240327eb9a97e565980d45e0b9e2"
readonly stamp="$(date -u +%Y%m%dT%H%M%SZ)"
readonly backup_dir="/var/backups/tutorial-vps2-pre-candidate24-${stamp}"
readonly backup="${backup_dir}/${database}.dump"

printf '%s  %s\n' "$migration_sha" "$migration" | sha256sum -c -
[[ "$(docker inspect -f '{{.State.Running}}' "$container")" == "true" ]] || { echo "staging postgres is not running" >&2; exit 1; }
docker exec "$container" sh -lc 'test "$POSTGRES_DB" = tutorial_staging_cf_20260908'
if docker exec "$container" sh -lc 'psql -U "$POSTGRES_USER" -Atqc "SELECT 1 FROM pg_database WHERE datname='"'"'tutorial_staging_c24_rehearsal'"'"'"' | grep -qx 1; then
  echo "rehearsal database already exists; refusing to overwrite" >&2
  exit 1
fi

install -d -o root -g root -m 0700 "$backup_dir"
docker exec "$container" sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "${backup}.partial"
mv "${backup}.partial" "$backup"
sha256sum "$backup"

rehearsal_created=0
cleanup() {
  if [[ "$rehearsal_created" == "1" ]]; then
    docker exec "$container" sh -lc 'dropdb -U "$POSTGRES_USER" --if-exists tutorial_staging_c24_rehearsal' || true
  fi
}
trap cleanup EXIT
docker exec "$container" sh -lc 'createdb -U "$POSTGRES_USER" tutorial_staging_c24_rehearsal'
rehearsal_created=1
docker exec -i "$container" sh -lc 'pg_restore -U "$POSTGRES_USER" --exit-on-error -d tutorial_staging_c24_rehearsal' < "$backup"
docker exec -i "$container" sh -lc 'psql -X -U "$POSTGRES_USER" --single-transaction -v ON_ERROR_STOP=1 -d tutorial_staging_c24_rehearsal' < "$migration"
docker exec "$container" sh -lc 'psql -X -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -d tutorial_staging_c24_rehearsal -Atqc "SELECT count(*) FROM information_schema.columns WHERE table_schema='"'"'public'"'"' AND table_name='"'"'users'"'"' AND column_name IN ('"'"'tutorial_record_hotkey'"'"','"'"'tutorial_playback_speed'"'"')"' | grep -qx 2
docker exec "$container" sh -lc 'dropdb -U "$POSTGRES_USER" tutorial_staging_c24_rehearsal'
rehearsal_created=0

docker exec -i "$container" sh -lc 'psql -X -U "$POSTGRES_USER" --single-transaction -v ON_ERROR_STOP=1 -d tutorial_staging_cf_20260908' < "$migration"
docker exec "$container" sh -lc 'psql -X -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -d tutorial_staging_cf_20260908 -Atqc "SELECT count(*) FROM information_schema.columns WHERE table_schema='"'"'public'"'"' AND table_name='"'"'users'"'"' AND column_name IN ('"'"'tutorial_record_hotkey'"'"','"'"'tutorial_playback_speed'"'"')"' | grep -qx 2

printf '{"migration":"0104","rehearsed":true,"applied":true,"backup":"%s"}\n' "$backup"
