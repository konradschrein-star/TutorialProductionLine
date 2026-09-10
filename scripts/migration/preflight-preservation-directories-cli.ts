/** Exact five manifest paths; only the separately approved three empty directories may be created. */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {readPrivatePreservationContext} from './preflight-preservation-receipts-cli';
try{
  const apply=process.argv.length===3&&process.argv[2]==='--create-reviewed-three';
  if(!(process.argv.length===2||apply))throw Error('invalid_mode');
  const context=readPrivatePreservationContext();
  const module=readFileSync('scripts/migration/prepare-media-directories.mjs','utf8');
  const source=`const {lstat}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
if(process.platform!=='linux'||process.getuid()!==1000)throw Error('uid');
for(const p of ['/opt','/opt/content-forge','/opt/content-forge/media']){const s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw Error('root');}
const m=await import('data:text/javascript;base64,${Buffer.from(module).toString('base64')}');
const p=await m.planDirectories(${JSON.stringify(context.manifest.entries.map(e=>e.path))});
const hash=createHash('sha256').update(JSON.stringify(p)).digest('hex');let created=0;
if(${apply}){
const expected=['tutorial/2071be5e-9956-42be-9803-04b7d418848b','tutorial/409f215a-c13d-4937-9dee-3c6aafd995a2','tutorial/48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6'];
if(hash!=='fa7024e09520cdf1aa43cbff44c0e92809bfe0f094b732dfda07a400cd5f2909'||p.safePaths!==5||p.unsafe.length||Object.keys(p.blocked).length||JSON.stringify(p.create.map(x=>x.slice(m.MEDIA_ROOT.length+1)))!==JSON.stringify(expected))throw Error('reviewed_plan_changed');
created=await m.applyDirectories(p);
for(const path of p.create){const s=await lstat(path);if(s.uid!==1000||(s.mode&0o777)!==0o700||s.isSymbolicLink()||!s.isDirectory())throw Error('created_directory_check');}
}
const after=await m.planDirectories(${JSON.stringify(context.manifest.entries.map(e=>e.path))});
process.stdout.write(JSON.stringify({mode:${JSON.stringify(apply?'create-reviewed-three':'dry-run')},safePaths:p.safePaths,existingDirectories:p.existing,plannedDirectories:p.create.length,relativeDirectories:p.create.map(x=>x.slice(m.MEDIA_ROOT.length+1)),blockedDirectories:p.unsafe.length,blockedPaths:p.blocked,planHash:hash,createdDirectories:created,afterPlannedDirectories:after.create.length,mediaFilesWritten:0,databaseWrites:0}));`;
  const output=execFileSync('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','vps2','docker exec -i --user 1000:1000 tutorial-recovery-staging-web-1 node --input-type=module'],{input:source,encoding:'utf8',timeout:45000,maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']});
  console.log(JSON.stringify(JSON.parse(output)));
}catch{console.log(JSON.stringify({mode:process.argv.includes('--create-reviewed-three')?'create-reviewed-three':'dry-run',stopped:true,detailsWithheld:true,createdDirectories:process.argv.includes('--create-reviewed-three')?null:0,mediaFilesWritten:0,databaseWrites:0}));process.exitCode=1;}
