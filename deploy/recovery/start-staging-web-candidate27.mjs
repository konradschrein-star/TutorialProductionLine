// Upgrade only the reviewed private VPS2 web canary to Candidate 27.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const root = "/opt/tutorial-recovery-staging";
const image = "tutorial-recovery:20260910-candidate27";
const expectedImageId = "sha256:d04aea2906f39c072b255f5f754f8ea5f4c0d6b7a3daabe51f70e57902fcd236";
const previousImage = "tutorial-recovery:20260910-candidate26";
const mode = process.argv[2];
const composePath = process.argv[3];
if (!["--prepare-config", "--check", "--upgrade-verified-web"].includes(mode) || !composePath?.startsWith(`${root}/`) || !/^[\w/.-]+$/.test(composePath)) throw new Error("Explicit mode and verified compose path required");
for (const path of [root, composePath, `${root}/.env`, `${root}/runtime.ai-20260909.env.candidate`]) {
  const item = fs.lstatSync(path);
  if (item.isSymbolicLink() || item.uid !== 0 || (item.mode & 0o077) || (path === root ? !item.isDirectory() : !item.isFile())) throw new Error("Unsafe staging path/configuration");
}
const run = (args) => {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, env: { ...process.env, STUDIO_IMAGE: image } });
  if (result.status !== 0) throw new Error("Guarded staging Docker command failed");
  return result.stdout;
};
const installed = JSON.parse(run(["image", "inspect", image]))[0];
if (installed.Id !== expectedImageId || installed.Os !== "linux" || installed.Architecture !== "amd64" || installed.Config.User !== "node") throw new Error("Unexpected image identity/platform/user");
const id = run(["ps", "-aq", "--filter", "label=com.docker.compose.project=tutorial-recovery-staging", "--filter", "label=com.docker.compose.service=web"]).trim();
if (!id || id.split("\n").length !== 1) throw new Error("Expected one reviewed staging web");
const current = JSON.parse(run(["inspect", id]))[0];
if (![image, previousImage].includes(current.Config.Image)) throw new Error("Unreviewed previous image");
const bindings = current.HostConfig.PortBindings;
if (Object.keys(bindings).join(",") !== "3000/tcp" || bindings["3000/tcp"].length !== 1 || bindings["3000/tcp"][0].HostIp !== "127.0.0.1" || bindings["3000/tcp"][0].HostPort !== "3118") throw new Error("Staging ingress is not private target");
const overridePath = `${root}/candidate27.web-media.override.json`;
const override = `${JSON.stringify({ services: { web: { volumes: [{ type: "bind", source: `${root}/media`, target: "/opt/content-forge/media" }], networks: ["default", "web_access"], env_file: [`${root}/runtime.ai-20260909.env.candidate`], environment: {
  LOCAL_MEDIA_ROOT: "/opt/content-forge/media", THUMBNAIL_MEDIA_DIR: "/opt/content-forge/media/thumbnails",
  STORAGE_DRIVE_ENABLED: "false", TUTORIAL_PUBLICATION_RECOVERY_ENABLED: "false", TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED: "false", TUTORIAL_RETENTION_ENABLED: "false",
  VEOFORGE_IMAGES_ENABLED: "0", TUTORIAL_AI_THUMBNAILS_ENABLED: "false", THUMBNAIL_BACKEND: "veoforge",
} } }, networks: { web_access: { driver: "bridge", internal: false } } }, null, 2)}\n`;
if (fs.existsSync(overridePath)) {
  const item = fs.lstatSync(overridePath);
  if (!item.isFile() || item.isSymbolicLink() || item.uid !== 0 || (item.mode & 0o077) || fs.readFileSync(overridePath, "utf8") !== override) throw new Error("Conflicting override");
} else if (mode === "--prepare-config") fs.writeFileSync(overridePath, override, { flag: "wx", mode: 0o600 });
else throw new Error("Candidate27 override absent");
const common = ["compose", "--env-file", `${root}/.env`, "-f", composePath, "-f", overridePath];
const resolved = JSON.parse(run([...common, "config", "--format", "json"]));
const web = resolved.services.web;
const db = new URL(web.environment.DATABASE_URL);
if (resolved.name !== "tutorial-recovery-staging" || web.image !== image || db.hostname !== "postgres" || db.pathname !== "/tutorial_staging_cf_20260908" || !resolved.networks.default.internal) throw new Error("Unexpected staging target");
if (Object.keys(web.networks).sort().join(",") !== "default,web_access" || resolved.networks.web_access.internal) throw new Error("Unsafe web network");
for (const service of ["postgres", "redis"]) if (Object.keys(resolved.services[service].networks).join(",") !== "default") throw new Error("DB/queue isolation changed");
if (web.ports.length !== 1 || web.ports[0].host_ip !== "127.0.0.1" || String(web.ports[0].published) !== "3118" || web.ports[0].target !== 3000) throw new Error("Unsafe published port");
for (const key of ["TUTORIAL_PUBLICATION_RECOVERY_ENABLED", "TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED", "TUTORIAL_RETENTION_ENABLED", "TUTORIAL_AI_THUMBNAILS_ENABLED", "STORAGE_DRIVE_ENABLED"]) if (String(web.environment[key]) !== "false") throw new Error("Unsafe activation flag");
if (String(web.environment.VEOFORGE_IMAGES_ENABLED) !== "0") throw new Error("VeoForge must remain off");
if (web.environment.LOCAL_MEDIA_ROOT !== "/opt/content-forge/media" || !web.volumes.some((v) => v.type === "bind" && v.source === `${root}/media` && v.target === "/opt/content-forge/media" && !v.read_only)) throw new Error("Media mapping changed");
if (mode === "--upgrade-verified-web") run([...common, "up", "-d", "--no-deps", "web"]);
console.log(JSON.stringify({ checked: true, prepared: mode === "--prepare-config", started: mode === "--upgrade-verified-web", image, previousImage, loopbackPort: 3118, workersStarted: 0, driveEnabled: false, publicationEnabled: false, aiEnabled: false }));
