import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = '/opt/tutorial-review-omar-20260909-X9mWtF';
const database = 'tutorial_omar_rehearsal_20260909';
if (process.argv[2] !== '--rehearse-only') throw Error('Rehearsal confirmation required');
const files = readdirSync(root).filter(name => /^(0089|009[0-9]|010[0-3])_.*\.sql$/.test(name)).sort();
if (files.length !== 15) throw Error('Expected exactly fifteen reviewed migrations');
for (const file of files) {
  const sql = `SET ROLE tutorial; SET lock_timeout='5s'; SET statement_timeout='60s';\n${readFileSync(`${root}/${file}`, 'utf8')}`;
  const result = spawnSync('sudo', ['-u','postgres','psql','-X','-v','ON_ERROR_STOP=1','--single-transaction','-d',database], {input:sql, encoding:'utf8'});
  if (result.status !== 0) { console.error(file, result.stderr); process.exit(1); }
  console.log(`${file}: rehearsed`);
}
console.log('Clone only. Live database unchanged.');
