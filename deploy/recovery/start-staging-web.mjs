// Run only on VPS2. Starts web only, never workers, publication or cleanup.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = '/opt/tutorial-recovery-staging';
const image = 'tutorial-recovery:20260909-candidate21';
const previousImage = 'tutorial-recovery:20260909-candidate20';
const mode = process.argv[2];
const composePath = process.argv[3];
if (!['--check', '--start', '--reconfigure-web-access', '--enable-drive-retrieval', '--upgrade-verified-web'].includes(mode) || !composePath?.startsWith(root + '/') || !/^[\w/.-]+$/.test(composePath)) throw Error('Explicit mode and verified staging compose path required');
// A version upgrade must preserve the safe web-only posture. Drive retrieval is
// a separate, explicit action after a tenant root has been verified.
const enableDrive = mode === '--enable-drive-retrieval';
const directory = fs.lstatSync(root);
if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0 || (directory.mode & 0o077)) throw Error('Unsafe staging directory');
for (const path of [composePath, root + '/.env', root + '/runtime.ai-20260909.env.candidate']) {
  const item = fs.lstatSync(path);
  if (!item.isFile() || item.isSymbolicLink() || item.uid !== 0 || (item.mode & 0o077)) throw Error('Unsafe staging configuration');
}
const run = (args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, STUDIO_IMAGE: image } });
  if (result.status !== 0) throw Error('Staging Docker command failed; inspect privately');
  return result.stdout;
};
const installed = JSON.parse(run(['image', 'inspect', image]))[0];
if (installed.Os !== 'linux' || installed.Architecture !== 'amd64' || installed.Config.User !== 'node') throw Error('Unexpected image platform/user');
const existing = run(['ps', '-aq', '--filter', 'label=com.docker.compose.project=tutorial-recovery-staging', '--filter', 'label=com.docker.compose.service=web']).trim();
if (existing) {
  if (!['--check', '--reconfigure-web-access', '--enable-drive-retrieval', '--upgrade-verified-web'].includes(mode) || existing.split('\n').length !== 1) throw Error('An existing staging web container requires separate review');
  const current = JSON.parse(run(['inspect', existing]))[0];
  if (current.Config.Image !== image && !(['--check', '--upgrade-verified-web'].includes(mode) && current.Config.Image === previousImage)) throw Error('Do not replace an unreviewed staging image');
  if (['--check', '--upgrade-verified-web'].includes(mode)) {
    const bindings = current.HostConfig.PortBindings;
    if (Object.keys(bindings).join(',') !== '3000/tcp' || bindings['3000/tcp'].length !== 1 || bindings['3000/tcp'][0].HostIp !== '127.0.0.1' || bindings['3000/tcp'][0].HostPort !== '3118') throw Error('Existing staging web is not the expected private target');
  }
} else if (['--reconfigure-web-access', '--enable-drive-retrieval', '--upgrade-verified-web'].includes(mode)) throw Error('Expected existing reviewed staging web');
const overridePath = root + (enableDrive ? '/candidate21.web-media-drive.override.json' : '/candidate21.web-media.override.json');
const override = JSON.stringify({ services: { web: { volumes: [{ type: 'bind', source: root + '/media', target: '/opt/content-forge/media' }, ...(enableDrive ? [{ type: 'bind', source: root + '/drive-secrets', target: '/run/secrets/drive', read_only: true }] : [])], networks: ['default', 'web_access'], env_file: [root + '/runtime.ai-20260909.env.candidate'], environment: {
  LOCAL_MEDIA_ROOT: '/opt/content-forge/media', THUMBNAIL_MEDIA_DIR: '/opt/content-forge/media/thumbnails',
  STORAGE_DRIVE_ENABLED: String(enableDrive), TUTORIAL_PUBLICATION_RECOVERY_ENABLED: 'false',
  TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED: 'false', TUTORIAL_RETENTION_ENABLED: 'false',
  VEOFORGE_IMAGES_ENABLED: '0', THUMBNAIL_BACKEND: 'veoforge',
} } }, networks: { web_access: { driver: 'bridge', internal: false } } }, null, 2) + '\n';
if (fs.existsSync(overridePath)) {
  const item = fs.lstatSync(overridePath);
  if (!item.isFile() || item.isSymbolicLink() || item.uid !== 0 || (item.mode & 0o077) || fs.readFileSync(overridePath, 'utf8') !== override) throw Error('Conflicting override file');
} else fs.writeFileSync(overridePath, override, { flag: 'wx', mode: 0o600 });
const common = ['compose', '--env-file', root + '/.env', '-f', composePath, '-f', overridePath];
const resolved = JSON.parse(run([...common, 'config', '--format', 'json']));
const web = resolved.services.web;
const db = new URL(web.environment.DATABASE_URL);
if (resolved.name !== 'tutorial-recovery-staging' || web.image !== image || db.hostname !== 'postgres' || db.pathname !== '/tutorial_staging_cf_20260908' || !resolved.networks.default.internal) throw Error('Unexpected staging target');
if (Object.keys(web.networks).sort().join(',') !== 'default,web_access' || resolved.networks.web_access.internal) throw Error('Unexpected web access network');
for (const service of ['postgres', 'redis']) if (Object.keys(resolved.services[service].networks).join(',') !== 'default') throw Error('Database and queue must stay isolated');
if (web.ports.length !== 1 || web.ports[0].host_ip !== '127.0.0.1' || String(web.ports[0].published) !== '3118' || web.ports[0].target !== 3000) throw Error('Staging port must remain loopback-only');
for (const key of ['TUTORIAL_PUBLICATION_RECOVERY_ENABLED', 'TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED', 'TUTORIAL_RETENTION_ENABLED']) if (String(web.environment[key]) !== 'false') throw Error('Unsafe activation flag');
if (String(web.environment.STORAGE_DRIVE_ENABLED) !== String(enableDrive)) throw Error('Unexpected Drive retrieval mode');
if (enableDrive && !web.volumes.some(volume => volume.type === 'bind' && volume.source === root + '/drive-secrets' && volume.target === '/run/secrets/drive' && volume.read_only === true)) throw Error('Missing read-only Drive credentials mount');
if (web.environment.LOCAL_MEDIA_ROOT !== '/opt/content-forge/media' || !web.volumes.some(volume => volume.type === 'bind' && volume.source === root + '/media' && volume.target === '/opt/content-forge/media' && !volume.read_only)) throw Error('Imported media paths must map to isolated writable storage');
if (String(web.environment.VEOFORGE_IMAGES_ENABLED) !== '0') throw Error('Live images must stay disabled');
if (mode !== '--check') run([...common, 'up', '-d', '--no-deps', 'web']);
console.log(JSON.stringify({ checked: true, started: mode !== '--check', image, loopbackPort: 3118, workersStarted: 0, driveEnabled: enableDrive, liveImagesEnabled: false, publicationEnabled: false }));
