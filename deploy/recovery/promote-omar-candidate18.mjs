// Promote candidate 21's three Tutorial Studio processes. The separately authenticated
// uploader exchange is deliberately never included in this release.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const current = "/opt/tutorial-review-omar-20260909-final-c20";
const target = "/opt/tutorial-review-omar-20260909-final-c21";
const archive = "/opt/runtime-app-candidate21.tgz";
const expectedDriveRoot = "1dq1J2su1zNWS34hkKLXywf-lIrfBxPDS";

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
};
if (!fs.statSync(current).isDirectory() || !fs.statSync(archive).isFile()) throw new Error("Candidate 20 or candidate 21 archive is missing");
const targetExists = fs.existsSync(target);
if (targetExists && !fs.statSync(`${target}/app`).isDirectory()) throw new Error("Candidate 21 target is not an extracted retry target");

const before = JSON.parse(run("pm2", ["jlist"]));
const exchange = before.find((process) => process.name === "tutorial-uploader-exchange");
if (!exchange?.pid) throw new Error("The existing uploader exchange is not online");
const exchangePid = exchange.pid;

if (!targetExists) {
  fs.mkdirSync(target, { mode: 0o755 });
  run("tar", ["-xzf", archive, "-C", target]);
}
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
if (allApps.some((app) => app.name === "tutorial-uploader-exchange")) throw new Error("Release must not control uploader exchange");
if (allApps.some((app) => (app.env?.TUTORIAL_AI_THUMBNAILS_ENABLED != null && app.env.TUTORIAL_AI_THUMBNAILS_ENABLED !== "false") || (app.env?.VEOFORGE_IMAGES_ENABLED != null && app.env.VEOFORGE_IMAGES_ENABLED !== "0"))) throw new Error("Omar AI thumbnail generation must remain off");
if (allApps.some((app) => app.env?.GOOGLE_DRIVE_ROOT_FOLDER_ID !== expectedDriveRoot)) throw new Error("Unexpected Omar Drive root");
for (const [name, value] of [["live.json", live], ["drive-live.json", drive]]) {
  const path = `${target}/${name}`;
  const wanted = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(path)) {
    if (fs.readFileSync(path, "utf8") !== wanted) throw new Error(`Candidate 21 ${name} differs from the verified retry configuration`);
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
  if (!healthy) throw new Error("Candidate 21 health check did not become ready");
  const after = JSON.parse(run("pm2", ["jlist"]));
  const selected = after.filter((process) => ["tutorial-web", "tutorial-worker", "tutorial-drive-uploader"].includes(process.name));
  if (selected.length !== 3 || selected.some((process) => process.pm2_env?.pm_cwd !== `${target}/app` && !String(process.pm2_env?.pm_cwd).startsWith(`${target}/app/`))) throw new Error("Candidate 21 process cwd verification failed");
  if (after.find((process) => process.name === "tutorial-uploader-exchange")?.pid !== exchangePid) throw new Error("Uploader exchange changed during promotion");
  run("pm2", ["save"]);
  console.log(JSON.stringify({ promoted: true, target, processes: selected.map((process) => ({ name: process.name, pid: process.pid, status: process.pm2_env.status })), uploaderExchangePid: exchangePid }));
} catch (error) {
  spawnSync("pm2", ["delete", "tutorial-web", "tutorial-worker", "tutorial-drive-uploader"], { encoding: "utf8" });
  run("pm2", ["start", `${current}/live.json`, "--only", "tutorial-web,tutorial-worker", "--update-env"]);
  run("pm2", ["start", `${current}/drive-live.json`, "--only", "tutorial-drive-uploader", "--update-env"]);
  throw error;
}
