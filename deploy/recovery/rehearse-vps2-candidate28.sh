#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$(id -u)" == "0" ]] || { echo "run as root" >&2; exit 1; }
readonly container="tutorial-recovery-staging-postgres-1"
readonly database="tutorial_staging_cf_20260908"
readonly rehearsal="tutorial_staging_c28_rehearsal"
readonly stamp="$(date -u +%Y%m%dT%H%M%SZ)"
readonly backup_dir="/var/backups/tutorial-vps2-pre-candidate28-${stamp}"
readonly backup="${backup_dir}/${database}.dump"
[[ "$(docker inspect -f '{{.State.Running}}' "$container")" == "true" ]] || { echo "staging postgres is not running" >&2; exit 1; }
docker exec "$container" sh -lc 'test "$POSTGRES_DB" = tutorial_staging_cf_20260908'
if docker exec "$container" sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT 1 FROM pg_database WHERE datname='"'"'tutorial_staging_c28_rehearsal'"'"'"' | grep -qx 1; then echo "rehearsal database exists" >&2; exit 1; fi
install -d -o root -g root -m 0700 "$backup_dir"
docker exec "$container" sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "${backup}.partial"
mv "${backup}.partial" "$backup"
sha256sum "$backup"
created=0
cleanup(){ if [[ "$created" == "1" ]]; then docker exec "$container" sh -lc 'dropdb -U "$POSTGRES_USER" --if-exists tutorial_staging_c28_rehearsal' || true; fi; }
trap cleanup EXIT
docker exec "$container" sh -lc 'createdb -U "$POSTGRES_USER" tutorial_staging_c28_rehearsal'; created=1
docker exec -i "$container" sh -lc 'pg_restore -U "$POSTGRES_USER" --exit-on-error --section=pre-data -d tutorial_staging_c28_rehearsal' < "$backup"
docker exec "$container" sh -lc 'psql -X -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -d tutorial_staging_c28_rehearsal -c "ALTER FUNCTION public.tutorial_archive_payload_safe(jsonb) SET search_path = public, pg_catalog"'
docker exec -i "$container" sh -lc 'pg_restore -U "$POSTGRES_USER" --exit-on-error --section=data -d tutorial_staging_c28_rehearsal' < "$backup"
docker exec -i "$container" sh -lc 'pg_restore -U "$POSTGRES_USER" --exit-on-error --section=post-data -d tutorial_staging_c28_rehearsal' < "$backup"
docker exec "$container" sh -lc 'psql -X -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -d tutorial_staging_c28_rehearsal -Atqc "SELECT (SELECT count(*) FROM tutorial_jobs)::text || '"'"'|'"'"' || (SELECT count(*) FROM users)::text || '"'"'|'"'"' || (SELECT count(*) FROM channels)::text"'
docker exec "$container" sh -lc 'dropdb -U "$POSTGRES_USER" tutorial_staging_c28_rehearsal'; created=0
printf '{"rehearsed":true,"migration":"none","backup":"%s"}\n' "$backup"
