// Preparation only: no live database migration, proxy switch or worker start.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = '/opt/tutorial-review-omar-20260909-X9mWtF';
const source = '/opt/tutorial-studio';
if (process.argv[2] !== '--prepare-rehearsal') throw Error('Explicit rehearsal mode required');
const hash = crypto.createHash('sha256');
for await (const chunk of fs.createReadStream(`${root}/app.tar`)) hash.update(chunk);
if (hash.digest('hex') !== 'e2890efb1c1c44fd714578f2f963ecf638f3655f90467d868c0b90bf22c13dc3') throw Error('Release archive checksum mismatch');
const app = `${root}/app`;
fs.mkdirSync(app, {mode:0o700});
const unpack = spawnSync('tar', ['-xf',`${root}/app.tar`,'-C',app], {encoding:'utf8'});
if (unpack.status !== 0) throw Error('Release extraction failed');
// Preserve Omar's independently deployed nginx authentication endpoint and server.
for (const name of ['index.ts','uploader-ops-auth.ts']) {
  fs.copyFileSync(`${source}/apps/hub-web/src/server/${name}`, `${app}/apps/hub-web/src/server/${name}`);
}
const require = createRequire(`${app}/apps/hub-web/package.json`);
const dotenv = require('dotenv');
const old = dotenv.parse(fs.readFileSync(`${source}/.env`));
const pm = spawnSync('pm2',['jlist'],{encoding:'utf8'});
if (pm.status !== 0) throw Error('Cannot inspect existing web configuration');
const web = JSON.parse(pm.stdout).find(p=>p.name==='tutorial-web');
if (!web || web.pm2_env.pm_cwd !== `${source}/apps/hub-web`) throw Error('Unexpected live web');
const env = {...old};
// Preserve effective PM2 overrides without serializing PM2 bookkeeping.
for (const key of Object.keys(old)) if (typeof web.pm2_env[key] === 'string') env[key]=web.pm2_env[key];
const database = new URL(env.DATABASE_URL);
if (database.pathname !== '/tutorial_studio') throw Error('Unexpected live database');
database.pathname='/tutorial_omar_rehearsal_20260909';
env.DATABASE_URL=database.toString();
env.PORT='3128'; env.BIND_HOST='127.0.0.1'; env.NODE_ENV='production';
env.TUTORIAL_PUBLICATION_RECOVERY_ENABLED='false';
env.TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED='false';
env.TUTORIAL_RETENTION_ENABLED='false'; env.VEOFORGE_IMAGES_ENABLED='0';
env.STORAGE_DRIVE_ENABLED='false';
const redis=new URL(env.REDIS_URL); redis.pathname='/14'; env.REDIS_URL=redis.toString();
const config={apps:[{name:'tutorial-omar-rehearsal',cwd:`${app}/apps/hub-web`,script:'src/server/index.ts',interpreter:'node',node_args:['--import','tsx'],env,autorestart:false}]};
fs.writeFileSync(`${root}/rehearsal.json`,JSON.stringify(config),{flag:'wx',mode:0o600});
console.log(JSON.stringify({prepared:true,port:3128,liveChanged:false,started:false,credentials:'preserved server-side',authHook:'preserved'}));
