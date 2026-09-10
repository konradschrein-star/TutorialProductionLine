// Promote Candidate28's three owned Tutorial Studio processes on Omar.
// The independent tutorial-uploader-exchange is never controlled here.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const current = "/opt/tutorial-review-omar-20260910-final-c27";
const target = "/opt/tutorial-review-omar-20260910-final-c28";
const archive = "/opt/runtime-app-candidate28.tgz";
const expectedArchiveSha256 = "9d230ae136d9ef3eb66cc62be85e0f78812b6ba4dedbfc17b8a6d3ad1b4836aa";
const expectedDriveRoot = "1dq1J2su1zNWS34hkKLXywf-lIrfBxPDS";
const names = ["tutorial-drive-uploader", "tutorial-web", "tutorial-worker"];
const mode = process.argv[2];
if (!["--check", "--promote"].includes(mode)) throw new Error("Explicit mode required");
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed under guarded promotion`);
  return result.stdout;
};
const list = () => JSON.parse(run("pm2", ["jlist"]));
const healthy = (port) => {
  for (let i = 0; i < 20; i += 1) {
    if (spawnSync("curl", ["-fsS", "--max-time", "4", `http://127.0.0.1:${port}/api/health`]).status === 0) return true;
    spawnSync("sleep", ["1"]);
  }
  return false;
};
const verify = (processes, root, exchangePid) => {
  const selected = processes.filter((process) => names.includes(process.name));
  if (selected.length !== 3 || selected.some((process) => process.pm2_env?.status !== "online" || !String(process.pm2_env?.pm_cwd).startsWith(`${root}/app/`))) throw new Error("Owned process/cwd gate failed");
  if (processes.find((process) => process.name === "tutorial-uploader-exchange")?.pid !== exchangePid) throw new Error("Uploader exchange changed");
  return selected;
};
if (!fs.statSync(current).isDirectory() || !fs.statSync(archive).isFile()) throw new Error("Candidate27 runtime or Candidate28 archive missing");
const archiveSha256 = run("sha256sum", [archive]).trim().split(/\s+/)[0];
if (archiveSha256 !== expectedArchiveSha256) throw new Error("Candidate28 archive checksum mismatch");
const targetExists = fs.existsSync(target);
if (targetExists && !fs.statSync(`${target}/app`).isDirectory()) throw new Error("Incomplete retry target");
const before = list();
const exchange = before.find((process) => process.name === "tutorial-uploader-exchange");
if (!exchange?.pid || exchange.pm2_env?.status !== "online") throw new Error("Uploader exchange offline");
const exchangePid = exchange.pid;
verify(before, current, exchangePid);
const rewrite = (name) => {
  const source = JSON.parse(fs.readFileSync(`${current}/${name}`, "utf8"));
  for (const app of source.apps ?? []) if (typeof app.cwd === "string") app.cwd = app.cwd.replace(`${current}/app`, `${target}/app`);
  return source;
};
const live = rewrite("live.json");
const drive = rewrite("drive-live.json");
const apps = [...(live.apps ?? []), ...(drive.apps ?? [])];
if (apps.map((app) => app.name).sort().join(",") !== names.join(",") || apps.some((app) => app.name === "tutorial-uploader-exchange")) throw new Error("Unexpected controlled process set");
if (apps.some((app) => app.env?.GOOGLE_DRIVE_ROOT_FOLDER_ID !== expectedDriveRoot)) throw new Error("Drive root changed");
if (apps.some((app) => (app.env?.TUTORIAL_AI_THUMBNAILS_ENABLED != null && app.env.TUTORIAL_AI_THUMBNAILS_ENABLED !== "false") || (app.env?.VEOFORGE_IMAGES_ENABLED != null && app.env.VEOFORGE_IMAGES_ENABLED !== "0"))) throw new Error("AI thumbnail generation must remain off");
const port = String(live.apps?.find((app) => app.name === "tutorial-web")?.env?.PORT || "3000");
if (mode === "--check") {
  console.log(JSON.stringify({ checked: true, current, target, targetExists, archiveSha256, uploaderExchangePid: exchangePid, controlledProcesses: apps.map((app) => app.name) }));
  process.exit(0);
}
if (!targetExists) { fs.mkdirSync(target, { mode: 0o755 }); run("tar", ["-xzf", archive, "-C", target]); }
for (const [name, value] of [["live.json", live], ["drive-live.json", drive]]) {
  const path = `${target}/${name}`;
  const wanted = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(path)) { if (fs.readFileSync(path, "utf8") !== wanted) throw new Error(`Conflicting ${name}`); }
  else fs.writeFileSync(path, wanted, { mode: 0o600, flag: "wx" });
}
try {
  run("pm2", ["delete", ...names]);
  run("pm2", ["start", `${target}/live.json`, "--only", "tutorial-web,tutorial-worker", "--update-env"]);
  run("pm2", ["start", `${target}/drive-live.json`, "--only", "tutorial-drive-uploader", "--update-env"]);
  if (!healthy(port)) throw new Error("Candidate28 health gate failed");
  const selected = verify(list(), target, exchangePid);
  run("pm2", ["save"]);
  console.log(JSON.stringify({ promoted: true, target, archiveSha256, processes: selected.map((process) => ({ name: process.name, pid: process.pid, status: process.pm2_env.status })), uploaderExchangePid: exchangePid }));
} catch (error) {
  spawnSync("pm2", ["delete", ...names]);
  run("pm2", ["start", `${current}/live.json`, "--only", "tutorial-web,tutorial-worker", "--update-env"]);
  run("pm2", ["start", `${current}/drive-live.json`, "--only", "tutorial-drive-uploader", "--update-env"]);
  if (!healthy(port)) throw new AggregateError([error], "Candidate28 failed and Candidate27 rollback health failed");
  verify(list(), current, exchangePid);
  run("pm2", ["save"]);
  throw error;
}
