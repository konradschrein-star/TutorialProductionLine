// Creates a root-only PM2 definition for the rehearsed live release.
// It preserves Omar's effective environment while explicitly disabling AI thumbnails.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const source = '/opt/tutorial-studio';
const releaseRoot = '/opt/tutorial-review-omar-20260909-X9mWtF';
const app = `${releaseRoot}/app`;
if (process.argv[2] !== '--prepare-live-config') throw Error('Explicit live-config mode required');

const require = createRequire(`${app}/apps/hub-web/package.json`);
const dotenv = require('dotenv');
const fileEnv = dotenv.parse(fs.readFileSync(`${source}/.env`));
const pm = spawnSync('pm2', ['jlist'], { encoding: 'utf8' });
if (pm.status !== 0) throw Error('Cannot inspect PM2');
const processes = JSON.parse(pm.stdout);
const oldWeb = processes.find((p) => p.name === 'tutorial-web');
const oldWorker = processes.find((p) => p.name === 'tutorial-worker');
if (oldWeb?.pm2_env?.pm_cwd !== `${source}/apps/hub-web`) throw Error('Unexpected live web');
if (oldWorker?.pm2_env?.pm_cwd !== `${source}/apps/worker-orchestrator`) throw Error('Unexpected live worker');

function effective(oldProcess) {
  const env = { ...fileEnv };
  for (const key of Object.keys(fileEnv)) {
    if (typeof oldProcess.pm2_env[key] === 'string') env[key] = oldProcess.pm2_env[key];
  }
  env.NODE_ENV = 'production';
  env.VEOFORGE_IMAGES_ENABLED = '0';
  env.TUTORIAL_AI_THUMBNAIL_FANOUT_ENABLED = 'false';
  env.TUTORIAL_LOCALIZATION_RECOVERY_ENABLED = 'false';
  env.TUTORIAL_PUBLICATION_RECOVERY_ENABLED = 'false';
  env.TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED = 'false';
  env.TUTORIAL_RETENTION_ENABLED = 'false';
  return env;
}

const webEnv = effective(oldWeb);
webEnv.PORT = '3000';
const workerEnv = effective(oldWorker);
const database = new URL(webEnv.DATABASE_URL);
if (database.pathname !== '/tutorial_studio') throw Error('Unexpected live database');
if (new URL(workerEnv.DATABASE_URL).pathname !== '/tutorial_studio') throw Error('Worker database mismatch');
if (webEnv.REDIS_URL !== workerEnv.REDIS_URL) throw Error('Web/worker Redis mismatch');
if (!fs.existsSync(`${app}/apps/hub-web/.next/BUILD_ID`)) throw Error('Missing web build');
if (!fs.existsSync(`${app}/apps/worker-orchestrator/dist/index.js`)) throw Error('Missing worker build');

const common = {
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_restarts: 10,
  restart_delay: 5000,
  exp_backoff_restart_delay: 2000,
};
const config = {
  apps: [
    {
      ...common,
      name: 'tutorial-web',
      cwd: `${app}/apps/hub-web`,
      script: 'src/server/index.ts',
      interpreter: 'node',
      node_args: ['--import', 'tsx'],
      max_memory_restart: '1500M',
      env: webEnv,
    },
    {
      ...common,
      name: 'tutorial-worker',
      cwd: `${app}/apps/worker-orchestrator`,
      script: 'dist/index.js',
      max_memory_restart: '2000M',
      env: workerEnv,
    },
  ],
};

const target = `${releaseRoot}/live.json`;
fs.writeFileSync(target, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ prepared: true, target, aiThumbnails: false, database: database.pathname, secrets: 'preserved server-side' }));
