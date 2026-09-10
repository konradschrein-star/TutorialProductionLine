#!/usr/bin/env bash
set -euo pipefail

release=/opt/tutorial-review-omar-20260909-final-c20
thumbnail_root=/opt/tutorial-studio/media/thumbnails
mode="${1:-reset}"
if [[ "$mode" != reset && "$mode" != --render-only ]]; then
  echo "Use reset or --render-only" >&2
  exit 1
fi

if [[ "$(realpath "$release")" != /opt/tutorial-review-omar-20260909-final-c20 ]]; then
  echo "Unexpected release root" >&2
  exit 1
fi
if [[ "$(realpath "$thumbnail_root")" != /opt/tutorial-studio/media/thumbnails ]]; then
  echo "Unexpected thumbnail root" >&2
  exit 1
fi
if [[ ! -s /var/backups/tutorial-omar-thumbnail-reset-20260909-c20/tutorial_studio.dump ]] ||
   [[ ! -s /var/backups/tutorial-omar-thumbnail-reset-20260909-c20/thumbnails-before.tgz ]]; then
  echo "Verified database and thumbnail backups are required" >&2
  exit 1
fi

run_with_worker_env() {
  local mode="$1"
  shift
  node - "$release/live.json" "$mode" "$@" <<'NODE'
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const [, , configPath, mode, ...args] = process.argv;
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const worker = config.apps.find((app) => app.name === "tutorial-worker");
if (!worker?.env?.DATABASE_URL) throw new Error("Verified worker environment is missing");
const override = mode === "reset"
  ? { OMAR_THUMBNAIL_RESET_CONFIRM: "DELETE_AND_REGENERATE_OMAR_THUMBNAILS_20260909" }
  : { FORCE_RENDER: "1" };
const child = spawnSync(process.execPath, args, {
  cwd: process.cwd(),
  env: { ...worker.env, ...override },
  stdio: "inherit",
});
process.exit(child.status ?? 1);
NODE
}

resume_services() {
  pm2 startOrReload "$release/live.json" --only tutorial-worker --update-env >/dev/null || true
  pm2 startOrReload "$release/drive-live.json" --only tutorial-drive-uploader --update-env >/dev/null || true
}
trap resume_services EXIT

pm2 stop tutorial-worker tutorial-drive-uploader >/dev/null

cd "$release/app"
if [[ "$mode" == reset ]]; then
  run_with_worker_env reset --import tsx scripts/maintenance/reset-omar-thumbnails.ts

  # The recoverable copy is the checksummed archive above. Remove only the
  # verified active thumbnail root; videos and every other media role are outside
  # this exact path.
  find "$thumbnail_root" -mindepth 1 -delete
fi

cd "$release/app/apps/worker-orchestrator"
run_with_worker_env regenerate --import tsx src/scripts/backfill-manual-thumbnails.ts

pm2 startOrReload "$release/live.json" --only tutorial-worker --update-env >/dev/null
pm2 startOrReload "$release/drive-live.json" --only tutorial-drive-uploader --update-env >/dev/null
trap - EXIT
pm2 save >/dev/null

sudo -u postgres psql -X -d tutorial_studio -P pager=off -c \
  "SELECT language, count(*) AS thumbnails, count(*) FILTER (WHERE is_selected) AS selected FROM thumbnails GROUP BY language ORDER BY language;" \
  -c "SELECT va_review_status, count(*) FROM tutorial_jobs GROUP BY va_review_status ORDER BY va_review_status NULLS FIRST;"
