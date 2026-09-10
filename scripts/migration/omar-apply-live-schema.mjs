// Applies only the fifteen migrations already rehearsed against Omar's restored clone.
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const releaseRoot = '/opt/tutorial-review-omar-20260909-X9mWtF';
const migrationRoot = `${releaseRoot}/app/packages/db/src/migrations`;
const database = 'tutorial_studio';
if (process.argv[2] !== '--apply-live-after-rehearsal') throw Error('Explicit live migration confirmation required');
const files = readdirSync(migrationRoot)
  .filter((name) => /^(0089|009[0-9]|010[0-3])_.*\.sql$/.test(name))
  .sort();
if (files.length !== 15) throw Error('Expected exactly fifteen reviewed migrations');

for (const file of files) {
  const sql = `SET ROLE tutorial; SET lock_timeout='5s'; SET statement_timeout='60s';\n${readFileSync(`${migrationRoot}/${file}`, 'utf8')}`;
  const result = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-d', database],
    { input: sql, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(`${file}: failed`);
    console.error(result.stderr);
    process.exit(1);
  }
  console.log(`${file}: applied`);
}
console.log('Live schema migration complete.');
