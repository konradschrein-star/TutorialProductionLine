#!/usr/bin/env bash
set -euo pipefail
release=/opt/tutorial-review-omar-20260909-final-c20

run_with_worker_env() {
  node - "$release/live.json" "$@" <<'NODE'
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const [, , configPath, ...args] = process.argv;
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const worker = config.apps.find((app) => app.name === "tutorial-worker");
if (!worker?.env?.DATABASE_URL) throw new Error("Verified worker environment is missing");
const child = spawnSync(process.execPath, args, { cwd: process.cwd(), env: worker.env, stdio: "inherit" });
process.exit(child.status ?? 1);
NODE
}

pm2 stop tutorial-drive-uploader >/dev/null
resume_drive() {
  pm2 startOrReload "$release/drive-live.json" --only tutorial-drive-uploader --update-env >/dev/null || true
}
trap resume_drive EXIT
cd "$release/app/apps/worker-orchestrator"
run_with_worker_env --import tsx src/scripts/backfill-drive-thumbnails.ts
resume_drive
trap - EXIT
pm2 save >/dev/null
