// On VPS2 only: isolated migration CLI runner. Password remains server-side.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root='/opt/tutorial-recovery-staging';
const directory='/var/tmp/tutorial-migration-20260908-recovery';
const name='tutorial_staging_cf_20260908';
const match=readFileSync(`${root}/.env`,'utf8').match(/^STAGING_DB_PASSWORD=([a-f0-9]{64})$/m);
if(!match)throw new Error('Private staging database configuration missing');
const mode=process.argv[2];
if(!['export-empty','rehearse','import-source','commit-source-staging'].includes(mode))throw new Error('Explicit migration mode required');
const commitStaging=mode==='commit-source-staging';
if(commitStaging && process.argv[5]!==name)throw new Error('Exact isolated staging database confirmation required');
const databaseUrl=`postgresql://tutorial_staging:${match[1]}@postgres:5432/${name}`;
const environment={...process.env,SOURCE_DATABASE_URL:databaseUrl,TARGET_DATABASE_URL:databaseUrl};
const common=['run','--rm','--memory','768m','--cpus','1','--network','tutorial-recovery-staging_default','--user','0:0','--env','SOURCE_DATABASE_URL','--env','TARGET_DATABASE_URL','--volume',`${directory}:${directory}`,'tutorial-recovery:20260908-allowlisted','node',`${directory}/migration-cli-assets-v2.mjs`];
const argumentsForMode=mode==='export-empty'
 ? ['--mode','export','--confirm-source-db',name,'--source-system','staging-security-check','--bundle',`${directory}/empty-rehearsal.json`]
 : ['--mode','import','--confirm-empty-target',name,'--bundle',`${directory}/${mode==='rehearse'?'empty-rehearsal.json':'content-forge-source-assets-v2.json'}`,'--sha256',process.argv[3]??'','--primary-channel-ids',mode==='rehearse'?'none':(process.argv[4]??''),'--accept-phase-one','yes','--include-assets',mode==='import-source'||commitStaging?'yes':'no','--commit',commitStaging?'yes':'no'];
const child=spawnSync('docker',[...common,...argumentsForMode],{env:environment,stdio:'inherit'});
process.exitCode=child.status??1;
