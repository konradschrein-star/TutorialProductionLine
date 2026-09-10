// Read-only database snapshot on the existing Content Forge host. No app edits.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
try {
 const require=createRequire('/opt/content-forge/package.json');
 require('dotenv').config({path:'/opt/content-forge/.env',quiet:true});
 const source=process.env.DATABASE_URL;
 if(!source || decodeURIComponent(new URL(source).pathname.slice(1))!=='content_forge')throw new Error('Source mismatch');
 const directory='/var/tmp/tutorial-migration-20260908-recovery';
 const child=spawnSync(process.execPath,[`${directory}/migration-cli-assets-v2.mjs`,'--mode','export','--confirm-source-db','content_forge','--source-system','content-forge-main','--bundle',`${directory}/content-forge-source-assets-v2.json`],{env:{...process.env,SOURCE_DATABASE_URL:source},stdio:'inherit'});
 process.exitCode=child.status??1;
} catch {console.error('SOURCE_SNAPSHOT_FAILED: private configuration withheld');process.exitCode=1;}
