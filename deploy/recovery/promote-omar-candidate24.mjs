// Promote Candidate 24's three Tutorial Studio processes. The separately
// authenticated uploader exchange is deliberately never included in this release.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const current = "/opt/tutorial-review-omar-20260909-final-c21";
const target = "/opt/tutorial-review-omar-20260910-final-c24";
const archive = "/opt/runtime-app-candidate24.tgz";
const expectedArchiveSha256 = "58d7a5d9e3f4979dcd75f409384327d0f8361195985668f8251db30cc311f434";
const expectedDriveRoot = "1dq1J2su1zNWS34hkKLXywf-lIrfBxPDS";
const mode = process.argv[2];
if (!["--check", "--promote"].includes(mode)) throw new Error("Explicit --check or --promote mode required");

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
};

if (!fs.statSync(current).isDirectory() || !fs.statSync(archive).isFile()) {
  throw new Error("Candidate 21 or Candidate 24 archive is missing");
}
const archiveSha256 = run("sha256sum", [archive]).trim().split(/\s+/)[0];
if (archiveSha256 !== expectedArchiveSha256) throw new Error("Candidate 24 archive checksum mismatch");
const targetExists = fs.existsSync(target);
if (targetExists && !fs.statSync(`${target}/app`).isDirectory()) {
  throw new Error("Candidate 24 target is not an extracted retry target");
}

const before = JSON.parse(run("pm2", ["jlist"]));
const exchange = before.find((process) => process.name === "tutorial-uploader-exchange");
if (!exchange?.pid || exchange.pm2_env?.status !== "online") throw new Error("The existing uploader exchange is not online");
const exchangePid = exchange.pid;

const rewrite = (name) => {
  const source = JSON.parse(fs.readFileSync(`${current}/${name}`, "utf8"));
  for (const app of source.apps ?? []) {
    if (typeof app.cwd === "string") app.cwd = app.cwd.replace(`${current}/app`, `${target}/app`);
  }
  return source;
};
const live = rewrite("live.json");
const drive = rewrite("drive-live.json");
const allApps = [...(live.apps ?? []), ...(drive.apps ?? [])];
const controlledNames = allApps.map((app) => app.name).sort();
if (controlledNames.join(",") !== "tutorial-drive-uploader,tutorial-web,tutorial-worker") throw new Error("Unexpected Candidate 24 process set");
if (allApps.some((app) => app.name === "tutorial-uploader-exchange")) throw new Error("Release must not control uploader exchange");
if (allApps.some((app) => (app.env?.TUTORIAL_AI_THUMBNAILS_ENABLED != null && app.env.TUTORIAL_AI_THUMBNAILS_ENABLED !== "false") || (app.env?.VEOFORGE_IMAGES_ENABLED != null && app.env.VEOFORGE_IMAGES_ENABLED !== "0"))) {
  throw new Error("Omar AI thumbnail generation must remain off");
}
if (allApps.some((app) => app.env?.GOOGLE_DRIVE_ROOT_FOLDER_ID !== expectedDriveRoot)) throw new Error("Unexpected Omar Drive root");
if (mode === "--check") {
  console.log(JSON.stringify({ checked: true, current, target, archiveSha256, targetExists, uploaderExchangePid: exchangePid, controlledProcesses: allApps.map((app) => app.name) }));
  process.exit(0);
}

if (!targetExists) {
  fs.mkdirSync(target, { mode: 0o755 });
  run("tar", ["-xzf", archive, "-C", target]);
}
for (const [name, value] of [["live.json", live], ["drive-live.json", drive]]) {
  const path = `${target}/${name}`;
  const wanted = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(path)) {
    if (fs.readFileSync(path, "utf8") !== wanted) throw new Error(`Candidate 24 ${name} differs from the verified retry configuration`);
  } else {
    fs.writeFileSync(path, wanted, { mode: 0o600, flag: "wx" });
  }
}

try {
  run("pm2", ["delete", "tutorial-web", "tutorial-worker", "tutorial-drive-uploader"]);
  run("pm2", ["start", `${target}/live.json`, "--only", "tutorial-web,tutorial-worker", "--update-env"]);
  run("pm2", ["start", `${target}/drive-live.json`, "--only", "tutorial-drive-uploader", "--update-env"]);
  let healthy = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = String(live.apps?.find((app) => app.name === "tutorial-web")?.env?.PORT || "3000");
    const probe = spawnSync("curl", ["-fsS", "--max-time", "4", `http://127.0.0.1:${port}/api/health`], { encoding: "utf8" });
    if (probe.status === 0) { healthy = true; break; }
    run("sleep", ["1"]);
  }
  if (!healthy) throw new Error("Candidate 24 health check did not become ready");
  const after = JSON.parse(run("pm2", ["jlist"]));
  const selected = after.filter((process) => ["tutorial-web", "tutorial-worker", "tutorial-drive-uploader"].includes(process.name));
  if (selected.length !== 3 || selected.some((process) => process.pm2_env?.status !== "online" || (process.pm2_env?.pm_cwd !== `${target}/app` && !String(process.pm2_env?.pm_cwd).startsWith(`${target}/app/`)))) {
    throw new Error("Candidate 24 process cwd verification failed");
  }
  if (after.find((process) => process.name === "tutorial-uploader-exchange")?.pid !== exchangePid) throw new Error("Uploader exchange changed during promotion");
  run("pm2", ["save"]);
  console.log(JSON.stringify({ promoted: true, target, archiveSha256, processes: selected.map((process) => ({ name: process.name, pid: process.pid, status: process.pm2_env.status })), uploaderExchangePid: exchangePid }));
} catch (error) {
  spawnSync("pm2", ["delete", "tutorial-web", "tutorial-worker", "tutorial-drive-uploader"], { encoding: "utf8" });
  run("pm2", ["start", `${current}/live.json`, "--only", "tutorial-web,tutorial-worker", "--update-env"]);
  run("pm2", ["start", `${current}/drive-live.json`, "--only", "tutorial-drive-uploader", "--update-env"]);
  let rollbackHealthy = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = String(live.apps?.find((app) => app.name === "tutorial-web")?.env?.PORT || "3000");
    const probe = spawnSync("curl", ["-fsS", "--max-time", "4", `http://127.0.0.1:${port}/api/health`], { encoding: "utf8" });
    if (probe.status === 0) { rollbackHealthy = true; break; }
    run("sleep", ["1"]);
  }
  const rolledBack = JSON.parse(run("pm2", ["jlist"]));
  const rollbackApps = rolledBack.filter((process) => ["tutorial-web", "tutorial-worker", "tutorial-drive-uploader"].includes(process.name));
  if (!rollbackHealthy || rollbackApps.length !== 3 || rollbackApps.some((process) => process.pm2_env?.status !== "online" || !String(process.pm2_env?.pm_cwd).startsWith(`${current}/app`)) || rolledBack.find((process) => process.name === "tutorial-uploader-exchange")?.pid !== exchangePid) {
    throw new AggregateError([error], "Candidate 24 promotion failed and automatic rollback could not be verified");
  }
  run("pm2", ["save"]);
  throw error;
}
