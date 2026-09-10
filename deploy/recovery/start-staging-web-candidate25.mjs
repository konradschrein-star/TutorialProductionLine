// Run only on VPS2. Upgrade the reviewed private web candidate; never start a
// worker, writer, AI service, Drive retrieval, uploader, publication, or cleanup.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const root = "/opt/tutorial-recovery-staging";
const image = "tutorial-recovery:20260910-candidate25";
const expectedImageId = "sha256:683adbd0e8c267fbc701e388298a5d7ce58d5a322bf7689f469fb7a9406a14ac";
const previousImage = "tutorial-recovery:20260909-candidate21";
const mode = process.argv[2];
const composePath = process.argv[3];
if (!["--prepare-config", "--check", "--upgrade-verified-web"].includes(mode) || !composePath?.startsWith(root + "/") || !/^[\w/.-]+$/.test(composePath)) {
  throw Error("Explicit mode and verified staging compose path required");
}
const directory = fs.lstatSync(root);
if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0 || (directory.mode & 0o077)) throw Error("Unsafe staging directory");
for (const path of [composePath, root + "/.env", root + "/runtime.ai-20260909.env.candidate"]) {
  const item = fs.lstatSync(path);
  if (!item.isFile() || item.isSymbolicLink() || item.uid !== 0 || (item.mode & 0o077)) throw Error("Unsafe staging configuration");
}
const run = (args) => {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, env: { ...process.env, STUDIO_IMAGE: image } });
  if (result.status !== 0) throw Error("Staging Docker command failed; inspect privately");
  return result.stdout;
};
const installed = JSON.parse(run(["image", "inspect", image]))[0];
if (installed.Id !== expectedImageId || installed.Os !== "linux" || installed.Architecture !== "amd64" || installed.Config.User !== "node") throw Error("Unexpected image identity/platform/user");
const existing = run(["ps", "-aq", "--filter", "label=com.docker.compose.project=tutorial-recovery-staging", "--filter", "label=com.docker.compose.service=web"]).trim();
if (!existing || existing.split("\n").length !== 1) throw Error("Expected exactly one reviewed staging web container");
const current = JSON.parse(run(["inspect", existing]))[0];
if (current.Config.Image !== image && current.Config.Image !== previousImage) throw Error("Do not replace an unreviewed staging image");
const bindings = current.HostConfig.PortBindings;
if (Object.keys(bindings).join(",") !== "3000/tcp" || bindings["3000/tcp"].length !== 1 || bindings["3000/tcp"][0].HostIp !== "127.0.0.1" || bindings["3000/tcp"][0].HostPort !== "3118") throw Error("Existing staging web is not the expected private target");

const overridePath = root + "/candidate25.web-media.override.json";
const override = JSON.stringify({ services: { web: { volumes: [{ type: "bind", source: root + "/media", target: "/opt/content-forge/media" }], networks: ["default", "web_access"], env_file: [root + "/runtime.ai-20260909.env.candidate"], environment: {
  LOCAL_MEDIA_ROOT: "/opt/content-forge/media", THUMBNAIL_MEDIA_DIR: "/opt/content-forge/media/thumbnails",
  STORAGE_DRIVE_ENABLED: "false", TUTORIAL_PUBLICATION_RECOVERY_ENABLED: "false",
  TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED: "false", TUTORIAL_RETENTION_ENABLED: "false",
  VEOFORGE_IMAGES_ENABLED: "0", TUTORIAL_AI_THUMBNAILS_ENABLED: "false", THUMBNAIL_BACKEND: "veoforge",
} } }, networks: { web_access: { driver: "bridge", internal: false } } }, null, 2) + "\n";
if (fs.existsSync(overridePath)) {
  const item = fs.lstatSync(overridePath);
  if (!item.isFile() || item.isSymbolicLink() || item.uid !== 0 || (item.mode & 0o077) || fs.readFileSync(overridePath, "utf8") !== override) throw Error("Conflicting override file");
} else if (mode === "--prepare-config") {
  fs.writeFileSync(overridePath, override, { flag: "wx", mode: 0o600 });
} else {
  throw Error("Candidate 25 override is absent; run --prepare-config explicitly before checking or upgrading");
}

const common = ["compose", "--env-file", root + "/.env", "-f", composePath, "-f", overridePath];
const resolved = JSON.parse(run([...common, "config", "--format", "json"]));
const web = resolved.services.web;
const db = new URL(web.environment.DATABASE_URL);
if (resolved.name !== "tutorial-recovery-staging" || web.image !== image || db.hostname !== "postgres" || db.pathname !== "/tutorial_staging_cf_20260908" || !resolved.networks.default.internal) throw Error("Unexpected staging target");
if (Object.keys(web.networks).sort().join(",") !== "default,web_access" || resolved.networks.web_access.internal) throw Error("Unexpected web access network");
for (const service of ["postgres", "redis"]) if (Object.keys(resolved.services[service].networks).join(",") !== "default") throw Error("Database and queue must stay isolated");
if (web.ports.length !== 1 || web.ports[0].host_ip !== "127.0.0.1" || String(web.ports[0].published) !== "3118" || web.ports[0].target !== 3000) throw Error("Staging port must remain loopback-only");
for (const key of ["TUTORIAL_PUBLICATION_RECOVERY_ENABLED", "TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED", "TUTORIAL_RETENTION_ENABLED", "TUTORIAL_AI_THUMBNAILS_ENABLED", "STORAGE_DRIVE_ENABLED"]) if (String(web.environment[key]) !== "false") throw Error("Unsafe activation flag");
if (web.environment.LOCAL_MEDIA_ROOT !== "/opt/content-forge/media" || !web.volumes.some((volume) => volume.type === "bind" && volume.source === root + "/media" && volume.target === "/opt/content-forge/media" && !volume.read_only)) throw Error("Imported media paths must map to isolated writable storage");
if (String(web.environment.VEOFORGE_IMAGES_ENABLED) !== "0") throw Error("Live images must stay disabled");
if (mode === "--upgrade-verified-web") run([...common, "up", "-d", "--no-deps", "web"]);
console.log(JSON.stringify({ checked: true, configPrepared: mode === "--prepare-config", started: mode === "--upgrade-verified-web", image, previousImage, loopbackPort: 3118, workersStarted: 0, driveEnabled: false, liveImagesEnabled: false, publicationEnabled: false }));
