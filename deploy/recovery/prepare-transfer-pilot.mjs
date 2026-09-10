// Source-host only: select one existing small asset, without changing media.
import { readFile, lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const directory='/var/tmp/tutorial-migration-20260908-recovery';
const digest=text=>createHash('sha256').update(text).digest('hex');
try {
 if(process.platform!=='linux'||process.getuid()!==0)throw new Error('Protected source host required');
 const parent=await lstat(directory);
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||(parent.mode&0o777)!==0o700)throw new Error('Private directory required');
 const source=`${directory}/media-manifest-v3.json`;
 const info=await lstat(source);
 if(!info.isFile()||info.isSymbolicLink()||info.uid!==0||info.nlink!==1||(info.mode&0o777)!==0o600)throw new Error('Protected manifest required');
 const text=await readFile(source,'utf8');
 if(digest(text)!=='67d754e9dd6995ccbc4314a0fd186f8049620d3199b8f83b8fcf6ae954b781d6')throw new Error('Manifest changed');
 const manifest=JSON.parse(text);
 const file=manifest.files.find(item=>item.state==='local_verified'&&item.bytes>0&&item.bytes<=1024*1024&&item.reasons.some(reason=>reason.startsWith('branding:')));
 if(!file)throw new Error('No bounded branding pilot');
 const selected=JSON.stringify({...manifest,files:[file],pilot:true,counts:{localFiles:1,localBytes:file.bytes}});
 const target=await open(`${directory}/transfer-pilot-manifest.json`,'wx',0o600);
 try {await target.writeFile(selected);await target.sync();}finally{await target.close();}
 console.log(JSON.stringify({checksum:digest(selected),selectedFiles:1,selectedBytes:file.bytes}));
}catch{console.error('PILOT_SELECTION_FAILED: private data suppressed');process.exitCode=1;}
