#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 ]] || { echo "expected release root argument" >&2; exit 1; }
readonly expected_root="$1"
readonly expected_drive_root="1dq1J2su1zNWS34hkKLXywf-lIrfBxPDS"
readonly target_job="7d6cdc5d-23b8-4b51-8bf6-7224e26aa876"
readonly internal="http://127.0.0.1:3000"
readonly public="https://tutorials.axtrelis.com"
pm2_json="$(mktemp)"; html="$(mktemp)"; trap 'rm -f "$pm2_json" "$html"' EXIT
pm2 jlist > "$pm2_json"
process_inventory="$(node -e '
const fs = require("fs");
const [path, root, driveRoot] = process.argv.slice(1);
const rows = JSON.parse(fs.readFileSync(path, "utf8"));
const owned = ["tutorial-web", "tutorial-worker", "tutorial-drive-uploader"];
const selected = rows.filter((row) => owned.includes(row.name));
if (selected.length !== 3 || selected.some((row) => row.pm2_env?.status !== "online" || !String(row.pm2_env?.pm_cwd).startsWith(`${root}/app/`))) throw new Error("owned process/cwd gate failed");
const exchange = rows.find((row) => row.name === "tutorial-uploader-exchange");
if (!exchange?.pid || exchange.pm2_env?.status !== "online" || String(exchange.pm2_env?.pm_cwd).startsWith(root)) throw new Error("independent uploader exchange gate failed");
for (const row of selected) {
  const env = row.pm2_env ?? {};
  if (env.GOOGLE_DRIVE_ROOT_FOLDER_ID !== driveRoot) throw new Error("Drive root changed");
  if (env.TUTORIAL_AI_THUMBNAILS_ENABLED != null && env.TUTORIAL_AI_THUMBNAILS_ENABLED !== "false") throw new Error("AI thumbnail flag enabled");
  if (env.VEOFORGE_IMAGES_ENABLED != null && env.VEOFORGE_IMAGES_ENABLED !== "0") throw new Error("VeoForge image flag enabled");
}
console.log(JSON.stringify({owned: selected.map((row) => ({name: row.name, pid: row.pid, cwd: row.pm2_env.pm_cwd})), exchange: {pid: exchange.pid, cwd: exchange.pm2_env.pm_cwd}}));
' "$pm2_json" "$expected_root" "$expected_drive_root")"
media_root="$(node -e '
const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const web = rows.find((row) => row.name === "tutorial-web");
const root = web?.pm2_env?.LOCAL_MEDIA_ROOT;
if (!root || !root.startsWith("/opt/") || root.includes("..")) throw new Error("unsafe media root");
console.log(root);
' "$pm2_json")"
internal_health="$(curl -fsS "$internal/api/health")"
public_health="$(curl -fsS "$public/api/health")"
login_status="$(curl -sS -o /dev/null -w '%{http_code}' "$public/login")"
protected_status="$(curl -sS -o /dev/null -w '%{http_code}' "$public/thumbnails")"
[[ "$login_status" == "200" && "$protected_status" == "307" ]] || { echo "public route status gate failed" >&2; exit 1; }
curl -fsS "$public/login" > "$html"
mapfile -t assets < <(grep -oE '/_next/static/[^" ]+' "$html" | sed 's/&amp;/\&/g' | sort -u)
for asset in "${assets[@]}"; do curl -fsS -o /dev/null "$public$asset"; done
db_inventory="$(runuser -u postgres -- psql -X -d tutorial_studio -Atqc "SELECT (SELECT count(*) FROM tutorial_jobs)::text || '|' || (SELECT max(updated_at) FROM tutorial_jobs)::text || '|' || (SELECT count(*) FROM users)::text || '|' || (SELECT count(*) FROM channels)::text || '|' || (SELECT count(*) FROM thumbnails)::text || '|' || (SELECT count(*) FROM storage_artifacts)::text")"
dispatch_inventory="$(runuser -u postgres -- psql -X -d tutorial_studio -Atqc "SELECT coalesce(string_agg(state || ':' || count::text, ',' ORDER BY state), '') FROM (SELECT state, count(*) FROM tutorial_upload_dispatches GROUP BY state) s; SELECT count(*) FROM tutorial_upload_receipts")"
target_inventory="$(runuser -u postgres -- psql -X -d tutorial_studio -Atqc "SELECT json_build_object('jobCopyTop', j.thumbnail_text_top, 'jobCopyBottom', j.thumbnail_text_bottom, 'selectedId', t.id, 'selectedHeadlineText', t.headline_text, 'selectedWordCount', (SELECT count(*) FROM regexp_split_to_table(trim(t.headline_text), '[[:space:]]+') word WHERE word <> ''), 'verdict', t.review_verdict, 'promptIsLayout', left(trim(t.prompt_used), 1) = '{', 'thumbnailUpdatedAt', t.updated_at, 'draftCount', (SELECT count(*) FROM tutorial_thumbnail_drafts d WHERE d.tutorial_job_id = j.id), 'outputPath', t.output_path) FROM tutorial_jobs j JOIN LATERAL (SELECT * FROM thumbnails WHERE subject_kind = 'tutorial_job' AND subject_id = j.id AND is_selected = true ORDER BY created_at DESC LIMIT 1) t ON true WHERE j.id = '$target_job'")"
media_inventory="$(find "$media_root" -type f -printf '%s\n' | awk '{bytes += $1; files += 1} END {printf "%.0f|%d", bytes, files}')"
printf 'processes=%s\ninternal=%s\npublic=%s\nlogin=%s\nprotected=%s\nassets=%d\ndb=%s\ndispatch=%s\ntarget=%s\nmediaRoot=%s\nmedia=%s\n' "$process_inventory" "$internal_health" "$public_health" "$login_status" "$protected_status" "${#assets[@]}" "$db_inventory" "$dispatch_inventory" "$target_inventory" "$media_root" "$media_inventory"
