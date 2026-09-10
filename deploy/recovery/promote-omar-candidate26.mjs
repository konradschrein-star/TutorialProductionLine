// Promote Candidate 26's reviewed Tutorial Studio services on Omar.
// The independently authenticated uploader exchange is never controlled here.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const current = "/opt/tutorial-review-omar-20260910-final-c25";
const target = "/opt/tutorial-review-omar-20260910-final-c26";
const archive = "/opt/runtime-app-candidate26.tgz";
const expectedArchiveSha256 = "070f92705f7197ec1b2f792eec77d735721cdb679159d7b522e87762ee9e8f0e";
const expectedDriveRoot = "1dq1J2su1zNWS34hkKLXywf-lIrfBxPDS";
const controlledNames = ["tutorial-drive-uploader", "tutorial-web", "tutorial-worker"];
const mode = process.argv[2];
if (!["--check", "--promote"].includes(mode)) throw new Error("Explicit --check or --promote mode required");

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed without changing the release contract`);
  return result.stdout;
};
const healthy = (port) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (spawnSync("curl", ["-fsS", "--max-time", "4", `http://127.0.0.1:${port}/api/health`]).status === 0) return true;
    spawnSync("sleep", ["1"]);
  }
  return false;
};
const processList = () => JSON.parse(run("pm2", ["jlist"]));
const verifyProcesses = (list, root, exchangePid) => {
  const selected = list.filter((process) => controlledNames.includes(process.name));
  if (selected.length !== 3 || selected.some((process) => process.pm2_env?.status !== "online" || !String(process.pm2_env?.pm_cwd).startsWith(`${root}/app/`))) {
    throw new Error("Reviewed Tutorial Studio process set/cwd verification failed");
  }
  if (list.find((process) => process.name === "tutorial-uploader-exchange")?.pid !== exchangePid) {
    throw new Error("Uploader exchange changed");
  }
  return selected;
};

if (!fs.statSync(current).isDirectory() || !fs.statSync(archive).isFile()) throw new Error("Candidate 25 runtime or Candidate 26 archive is missing");
const archiveSha256 = run("sha256sum", [archive]).trim().split(/\s+/)[0];
if (archiveSha256 !== expectedArchiveSha256) throw new Error("Candidate 26 archive checksum mismatch");
const targetExists = fs.existsSync(target);
if (targetExists && !fs.statSync(`${target}/app`).isDirectory()) throw new Error("Candidate 26 retry target is incomplete");

const before = processList();
const exchange = before.find((process) => process.name === "tutorial-uploader-exchange");
if (!exchange?.pid || exchange.pm2_env?.status !== "online") throw new Error("Uploader exchange is not online");
const exchangePid = exchange.pid;
verifyProcesses(before, current, exchangePid);

const rewrite = (name) => {
  const source = JSON.parse(fs.readFileSync(`${current}/${name}`, "utf8"));
  for (const app of source.apps ?? []) if (typeof app.cwd === "string") app.cwd = app.cwd.replace(`${current}/app`, `${target}/app`);
  return source;
};
const live = rewrite("live.json");
const drive = rewrite("drive-live.json");
const apps = [...(live.apps ?? []), ...(drive.apps ?? [])];
if (apps.map((app) => app.name).sort().join(",") !== controlledNames.join(",")) throw new Error("Unexpected Candidate 26 process set");
if (apps.some((app) => app.name === "tutorial-uploader-exchange")) throw new Error("Release must not control uploader exchange");
if (apps.some((app) => app.env?.GOOGLE_DRIVE_ROOT_FOLDER_ID !== expectedDriveRoot)) throw new Error("Unexpected Omar Drive root");
if (apps.some((app) => (app.env?.TUTORIAL_AI_THUMBNAILS_ENABLED != null && app.env.TUTORIAL_AI_THUMBNAILS_ENABLED !== "false") || (app.env?.VEOFORGE_IMAGES_ENABLED != null && app.env.VEOFORGE_IMAGES_ENABLED !== "0"))) throw new Error("Omar AI thumbnail generation must remain off");
const port = String(live.apps?.find((app) => app.name === "tutorial-web")?.env?.PORT || "3000");
if (mode === "--check") {
  console.log(JSON.stringify({ checked: true, current, target, archiveSha256, targetExists, uploaderExchangePid: exchangePid, controlledProcesses: apps.map((app) => app.name) }));
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
    if (fs.readFileSync(path, "utf8") !== wanted) throw new Error(`Candidate 26 ${name} differs from the verified retry configuration`);
  } else fs.writeFileSync(path, wanted, { mode: 0o600, flag: "wx" });
}

try {
  run("pm2", ["delete", ...controlledNames]);
  run("pm2", ["start", `${target}/live.json`, "--only", "tutorial-web,tutorial-worker", "--update-env"]);
  run("pm2", ["start", `${target}/drive-live.json`, "--only", "tutorial-drive-uploader", "--update-env"]);
  if (!healthy(port)) throw new Error("Candidate 26 health check did not become ready");
  const selected = verifyProcesses(processList(), target, exchangePid);
  run("pm2", ["save"]);
  console.log(JSON.stringify({ promoted: true, target, archiveSha256, processes: selected.map((process) => ({ name: process.name, pid: process.pid, status: process.pm2_env.status })), uploaderExchangePid: exchangePid }));
} catch (error) {
  spawnSync("pm2", ["delete", ...controlledNames]);
  run("pm2", ["start", `${current}/live.json`, "--only", "tutorial-web,tutorial-worker", "--update-env"]);
  run("pm2", ["start", `${current}/drive-live.json`, "--only", "tutorial-drive-uploader", "--update-env"]);
  if (!healthy(port)) throw new AggregateError([error], "Candidate 26 promotion failed and rollback health failed");
  verifyProcesses(processList(), current, exchangePid);
  run("pm2", ["save"]);
  throw error;
}
