#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$(id -u)" == "0" ]] || { echo "run as root" >&2; exit 1; }
readonly database="tutorial_studio"
readonly rehearsal="tutorial_studio_c29_rehearsal"
readonly stamp="$(date -u +%Y%m%dT%H%M%SZ)"
readonly backup_dir="/var/backups/tutorial-omar-pre-candidate29-${stamp}"
readonly backup="${backup_dir}/${database}.dump"
if runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname='${rehearsal}'" | grep -qx 1; then echo "rehearsal database exists" >&2; exit 1; fi
install -d -o postgres -g postgres -m 0700 "$backup_dir"
runuser -u postgres -- pg_dump -Fc -f "${backup}.partial" "$database"
runuser -u postgres -- mv "${backup}.partial" "$backup"
sha256sum "$backup"
created=0
cleanup(){ if [[ "$created" == "1" ]]; then runuser -u postgres -- dropdb --if-exists "$rehearsal" || true; fi; }
trap cleanup EXIT
runuser -u postgres -- createdb "$rehearsal"; created=1
runuser -u postgres -- pg_restore --exit-on-error --section=pre-data -d "$rehearsal" "$backup"
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d "$rehearsal" -c "ALTER FUNCTION public.tutorial_archive_payload_safe(jsonb) SET search_path = public, pg_catalog"
runuser -u postgres -- pg_restore --exit-on-error --section=data -d "$rehearsal" "$backup"
runuser -u postgres -- pg_restore --exit-on-error --section=post-data -d "$rehearsal" "$backup"
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d "$rehearsal" -Atqc "SELECT (SELECT count(*) FROM tutorial_jobs)::text || '|' || (SELECT count(*) FROM users)::text || '|' || (SELECT count(*) FROM channels)::text"
runuser -u postgres -- dropdb "$rehearsal"; created=0
printf '{"rehearsed":true,"migration":"none","backup":"%s"}\n' "$backup"
