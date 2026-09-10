#!/usr/bin/env bash
set -euo pipefail
readonly web="tutorial-recovery-staging-web-1"
readonly postgres="tutorial-recovery-staging-postgres-1"
readonly expected_image="sha256:f9c772fb27f1fd219cba7b051fa06797509f8dae289210c591a7a8482d7923ec"
readonly base="http://127.0.0.1:3118"
actual_image="$(docker inspect -f '{{.Image}}' "$web")"
[[ "$actual_image" == "$expected_image" ]] || { echo "image mismatch" >&2; exit 1; }
binding="$(docker inspect -f '{{json .HostConfig.PortBindings}}' "$web")"
[[ "$binding" == '{"3000/tcp":[{"HostIp":"127.0.0.1","HostPort":"3118"}]}' ]] || { echo "unsafe binding" >&2; exit 1; }
mapfile -t services < <(docker ps --filter label=com.docker.compose.project=tutorial-recovery-staging --format '{{.Label "com.docker.compose.service"}}' | sort)
[[ "${services[*]}" == "postgres redis web" ]] || { echo "unexpected process topology" >&2; exit 1; }
for pair in \
  STORAGE_DRIVE_ENABLED=false \
  TUTORIAL_PUBLICATION_RECOVERY_ENABLED=false \
  TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED=false \
  TUTORIAL_RETENTION_ENABLED=false \
  TUTORIAL_AI_THUMBNAILS_ENABLED=false \
  VEOFORGE_IMAGES_ENABLED=0; do
  key="${pair%%=*}"; expected="${pair#*=}"
  actual="$(docker inspect -f "{{range .Config.Env}}{{println .}}{{end}}" "$web" | awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}')"
  [[ "$actual" == "$expected" ]] || { echo "unsafe flag: $key" >&2; exit 1; }
done
health="$(curl -fsS "$base/api/health")"
login_status="$(curl -sS -o /dev/null -w '%{http_code}' "$base/login")"
protected_status="$(curl -sS -o /dev/null -w '%{http_code}' "$base/thumbnails")"
[[ "$login_status" == "200" && "$protected_status" == "307" ]] || { echo "route status gate failed" >&2; exit 1; }
html="$(mktemp)"; trap 'rm -f "$html"' EXIT
curl -fsS "$base/login" > "$html"
mapfile -t assets < <(grep -oE '/_next/static/[^" ]+' "$html" | sed 's/&amp;/\&/g' | sort -u)
for asset in "${assets[@]}"; do curl -fsS -o /dev/null "$base$asset"; done
db_inventory="$(docker exec "$postgres" sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT (SELECT count(*) FROM tutorial_jobs)::text || '\''|'\'' || (SELECT max(updated_at) FROM tutorial_jobs)::text || '\''|'\'' || (SELECT count(*) FROM users)::text || '\''|'\'' || (SELECT count(*) FROM channels)::text || '\''|'\'' || (SELECT count(*) FROM thumbnails)::text || '\''|'\'' || (SELECT count(*) FROM storage_artifacts)::text"')"
media_inventory="$(find /opt/tutorial-recovery-staging/media -type f -printf '%s\n' | awk '{bytes += $1; files += 1} END {printf "%d|%d", bytes, files}')"
printf 'image=%s\nservices=%s\nhealth=%s\nlogin=%s\nprotected=%s\nassets=%d\ndb=%s\nmedia=%s\n' "$actual_image" "${services[*]}" "$health" "$login_status" "$protected_status" "${#assets[@]}" "$db_inventory" "$media_inventory"
