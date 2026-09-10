#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ "$(id -u)" == "0" ]] || { echo "run as root" >&2; exit 1; }
readonly database="tutorial_studio"
readonly rehearsal="tutorial_studio_c25_rehearsal"
readonly migration="/opt/0104_user_tutorial_preferences.sql"
readonly migration_sha="7a63a7baf359566ef1949eb5555dd6b8fc29240327eb9a97e565980d45e0b9e2"
readonly stamp="$(date -u +%Y%m%dT%H%M%SZ)"
readonly backup_dir="/var/backups/tutorial-omar-pre-candidate25-${stamp}"
readonly backup="${backup_dir}/${database}.dump"

printf '%s  %s\n' "$migration_sha" "$migration" | sha256sum -c -
if runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname='${rehearsal}'" | grep -qx 1; then
  echo "rehearsal database already exists; refusing to overwrite" >&2
  exit 1
fi

install -d -o postgres -g postgres -m 0700 "$backup_dir"
runuser -u postgres -- pg_dump -Fc -f "${backup}.partial" "$database"
runuser -u postgres -- mv "${backup}.partial" "$backup"
sha256sum "$backup"

rehearsal_created=0
cleanup() {
  if [[ "$rehearsal_created" == "1" ]]; then
    runuser -u postgres -- dropdb --if-exists "$rehearsal" || true
  fi
}
trap cleanup EXIT
runuser -u postgres -- createdb "$rehearsal"
rehearsal_created=1
runuser -u postgres -- pg_restore --exit-on-error --section=pre-data -d "$rehearsal" "$backup"
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d "$rehearsal" \
  -c "ALTER FUNCTION public.tutorial_archive_payload_safe(jsonb) SET search_path = public, pg_catalog"
runuser -u postgres -- pg_restore --exit-on-error --section=data -d "$rehearsal" "$backup"
runuser -u postgres -- pg_restore --exit-on-error --section=post-data -d "$rehearsal" "$backup"
runuser -u postgres -- psql -X --single-transaction -v ON_ERROR_STOP=1 -d "$rehearsal" \
  -c "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'" -f "$migration"
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d "$rehearsal" -Atqc \
  "SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name IN ('tutorial_record_hotkey','tutorial_playback_speed'))::text || '|' || (SELECT count(*) FROM users WHERE tutorial_record_hotkey='F8' AND tutorial_playback_speed='1')::text || '|' || (SELECT count(*) FROM users)::text" \
  | awk -F'|' '$1 == 2 && $2 == $3 && $3 > 0 { ok=1 } END { exit !ok }'
runuser -u postgres -- dropdb "$rehearsal"
rehearsal_created=0

runuser -u postgres -- psql -X --single-transaction -v ON_ERROR_STOP=1 -d "$database" \
  -c "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'" -f "$migration"
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d "$database" -Atqc \
  "SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name IN ('tutorial_record_hotkey','tutorial_playback_speed'))::text || '|' || (SELECT count(*) FROM users WHERE tutorial_record_hotkey='F8' AND tutorial_playback_speed='1')::text || '|' || (SELECT count(*) FROM users)::text" \
  | awk -F'|' '$1 == 2 && $2 == $3 && $3 > 0 { ok=1 } END { exit !ok }'

printf '{"migration":"0104","rehearsed":true,"applied":true,"backup":"%s"}\n' "$backup"
