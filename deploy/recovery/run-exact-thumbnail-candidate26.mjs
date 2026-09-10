// Run exactly one reviewed procedural thumbnail render on Omar Candidate 26.
// This helper never prints the inherited live worker environment.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const target = "/opt/tutorial-review-omar-20260910-final-c26";
const jobId = "7d6cdc5d-23b8-4b51-8bf6-7224e26aa876";
const mode = process.argv[2];
if (mode !== "--render-exact-allowlisted-job") {
  throw new Error("Explicit --render-exact-allowlisted-job mode required");
}

const livePath = `${target}/live.json`;
const appRoot = `${target}/app`;
if (!fs.statSync(appRoot).isDirectory() || !fs.statSync(livePath).isFile()) {
  throw new Error("Candidate 26 runtime or live configuration is missing");
}
const live = JSON.parse(fs.readFileSync(livePath, "utf8"));
const worker = (live.apps ?? []).find((app) => app.name === "tutorial-worker");
if (!worker?.env?.DATABASE_URL) throw new Error("Verified worker database environment is missing");
if (
  (worker.env.TUTORIAL_AI_THUMBNAILS_ENABLED != null && worker.env.TUTORIAL_AI_THUMBNAILS_ENABLED !== "false") ||
  (worker.env.VEOFORGE_IMAGES_ENABLED != null && worker.env.VEOFORGE_IMAGES_ENABLED !== "0")
) {
  throw new Error("Omar AI thumbnail generation must remain off");
}

const before = JSON.parse(
  spawnSync("pm2", ["jlist"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).stdout,
);
const exchange = before.find((process) => process.name === "tutorial-uploader-exchange");
const controlled = before.filter((process) =>
  ["tutorial-web", "tutorial-worker", "tutorial-drive-uploader"].includes(process.name),
);
if (!exchange?.pid || exchange.pm2_env?.status !== "online") throw new Error("Uploader exchange is not online");
if (
  controlled.length !== 3 ||
  controlled.some(
    (process) =>
      process.pm2_env?.status !== "online" ||
      !String(process.pm2_env?.pm_cwd).startsWith(`${appRoot}/`),
  )
) {
  throw new Error("Candidate 26 services are not the verified live process set");
}
const exchangePid = exchange.pid;

const result = spawnSync(
  "pnpm",
  ["--filter", "@repo/worker-orchestrator", "backfill:manual-thumbnails"],
  {
    cwd: appRoot,
    env: {
      ...process.env,
      ...worker.env,
      TUTORIAL_THUMBNAIL_JOB_ALLOWLIST: jobId,
      FORCE_RENDER: "1",
    },
    stdio: "inherit",
  },
);
if (result.status !== 0) throw new Error("Exact allowlisted render failed");

const after = JSON.parse(
  spawnSync("pm2", ["jlist"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).stdout,
);
if (after.find((process) => process.name === "tutorial-uploader-exchange")?.pid !== exchangePid) {
  throw new Error("Uploader exchange changed during exact render");
}
console.log(JSON.stringify({ rendered: true, jobId, forceRender: true, uploaderExchangePid: exchangePid }));
