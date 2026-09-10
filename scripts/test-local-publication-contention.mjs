// Local isolated test database only. Own random fixture table is removed afterward.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const container = 'tutorial-recovery-test-postgres-1';
const table = `public.cf_media_contention_${randomUUID().replaceAll('-', '')}`;
const args = ['exec', '-i', container, 'sh', '-c', 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq'];
const query = input => execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
let created = false, holder;
try {
  query(`CREATE TABLE ${table} (id integer PRIMARY KEY); INSERT INTO ${table} VALUES (1);`); created = true;
  holder = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const finished = new Promise((resolve,reject)=>{holder.on('exit',code=>code===0?resolve():reject(new Error('holder_failed')));holder.on('error',reject);});
  const locked = new Promise((resolve,reject)=>{let output='';holder.stdout.on('data',chunk=>{output+=chunk;if(output.includes('locked'))resolve();});holder.on('error',reject);holder.on('exit',()=>{if(!output.includes('locked'))reject(new Error('holder_did_not_lock'));});});
  holder.stdin.end(`BEGIN; SELECT id FROM ${table} WHERE id=1 FOR UPDATE; SELECT 'locked'; SELECT pg_sleep(2); ROLLBACK;`);
  await locked;
  let busy = false;
  const started = Date.now();
  try { query(`\\set VERBOSITY verbose
BEGIN; SELECT id FROM ${table} WHERE id=1 FOR UPDATE NOWAIT; ROLLBACK;`.replace('\\\\set','\\set')); }
  catch(error) { busy = /55P03/.test(String(error.stderr)); }
  const elapsed = Date.now()-started;
  await finished;
  const retried = query(`BEGIN; SELECT id FROM ${table} WHERE id=1 FOR UPDATE NOWAIT; ROLLBACK;`).trim()==='1';
  if (!busy || !retried) throw new Error('contention_regression_failed');
  console.log(JSON.stringify({localOnly:true,nowaitBusyCodeMatched:busy,retryAfterReleaseSucceeded:retried,waitMilliseconds:elapsed,existingRowsChanged:0,providerCalls:0}));
} finally {
  if(holder && holder.exitCode===null) holder.kill();
  if(created)query(`DROP TABLE ${table};`);
}
