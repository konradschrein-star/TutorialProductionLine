// Read-only cutover audit. Prints queue counts and payload field names, never values.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const appRoot = process.env.APP_ROOT || '/opt/tutorial-studio';
const require = createRequire(`${appRoot}/apps/worker-orchestrator/package.json`);
const dotenv = require('dotenv');
const { Queue } = require('bullmq');

const env = dotenv.parse(fs.readFileSync(`${appRoot}/.env`));
const redisUrl = new URL(env.REDIS_URL);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: Number(redisUrl.pathname.slice(1) || 0),
};

const names = [
  'queue-tutorial-generate',
  'queue-tutorial-splice',
  'queue-tutorial-stitch',
  'queue-tutorial-translate',
  'queue-tutorial-thumbnail',
  'queue-tutorial-thumbnail-fanout',
  'queue-tutorial-dead-letter',
];

const result = [];
for (const name of names) {
  const queue = new Queue(name, { connection });
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'paused', 'prioritized', 'failed');
  const pending = await queue.getJobs(['waiting', 'active', 'delayed', 'paused', 'prioritized'], 0, 4, true);
  result.push({
    name,
    counts,
    samples: pending.map((job) => ({ state: 'pending', fields: Object.keys(job.data || {}).sort() })),
  });
  await queue.close();
}

console.log(JSON.stringify(result, null, 2));
