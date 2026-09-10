// Derives the isolated Drive uploader from the already-validated live worker env.
// The config stays root-only because it contains the preserved server environment.
import fs from 'node:fs';

const releaseRoot = '/opt/tutorial-review-omar-20260909-X9mWtF';
const app = `${releaseRoot}/app`;
if (process.argv[2] !== '--prepare-drive-config') throw Error('Explicit Drive-config mode required');
const live = JSON.parse(fs.readFileSync(`${releaseRoot}/live.json`, 'utf8'));
const worker = live.apps?.find((candidate) => candidate.name === 'tutorial-worker');
if (!worker || worker.cwd !== `${app}/apps/worker-orchestrator`) throw Error('Unexpected live worker config');
if (worker.env?.STORAGE_DRIVE_ENABLED !== 'true') throw Error('Drive is not enabled in the preserved server environment');
const config = {
  apps: [{
    name: 'tutorial-drive-uploader',
    cwd: `${app}/apps/worker-orchestrator`,
    script: 'dist/storage/standalone.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    exp_backoff_restart_delay: 2000,
    max_memory_restart: '1000M',
    env: worker.env,
  }],
};
const target = `${releaseRoot}/drive-live.json`;
fs.writeFileSync(target, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ prepared: true, target, database: new URL(worker.env.DATABASE_URL).pathname, secrets: 'preserved server-side' }));
