// PM2 process definitions for the standalone Tutorial Studio (single VPS).
//   pm2 start deploy/standalone/ecosystem.config.cjs
//
// Prereqs on the box: Node >=22, pnpm, Postgres 16, Redis 7, ffmpeg/ffprobe,
// a filled `.env` at the repo root, and a completed build:
//   pnpm install && pnpm build && pnpm --filter @repo/db db:push && pnpm --filter @repo/db seed
//
// Each app loads the root `.env` itself (dotenv). Restart policy uses backoff —
// the inherited worker had a documented crash-loop incident, so we cap restarts.
const path = require('path');
const root = path.resolve(__dirname, '..', '..');

// Load the root .env so EVERY process gets DATABASE_URL/REDIS_URL/secrets — the
// drive-uploader (storage/standalone.js) does not dotenv-load itself.
let fileEnv = {};
try {
  fileEnv = require('dotenv').parse(require('fs').readFileSync(path.join(root, '.env')));
} catch {
  /* .env may be absent in some environments */
}

const common = {
  instances: 1,
  exec_mode: 'fork', // custom Next server (tsx) + the workers must run forked, not clustered
  autorestart: true,
  max_restarts: 10,
  restart_delay: 5000,
  exp_backoff_restart_delay: 2000,
  env: { NODE_ENV: 'production', ...fileEnv },
};

module.exports = {
  apps: [
    {
      // Next.js UI + /api/* + SSE. Custom server (tsx src/server/index.ts).
      ...common,
      name: 'tutorial-web',
      cwd: path.join(root, 'apps', 'hub-web'),
      script: 'src/server/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      max_memory_restart: '1500M',
    },
    {
      // Pipeline worker: tutorial-generate -> splice -> stitch + thumbnail queue.
      ...common,
      name: 'tutorial-worker',
      cwd: path.join(root, 'apps', 'worker-orchestrator'),
      script: 'dist/index.js',
      max_memory_restart: '2000M',
    },
    {
      // Google Drive delivery (separate process — isolates multi-GB uploads).
      ...common,
      name: 'tutorial-drive-uploader',
      cwd: path.join(root, 'apps', 'worker-orchestrator'),
      script: 'dist/storage/standalone.js',
      max_memory_restart: '1000M',
    },
  ],
};
