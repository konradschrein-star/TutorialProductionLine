/** One pinned, approved reference-asset preservation. No overwrite or deletion of user bytes. */
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const manifestPath = 'C:/Users/konra/AppData/Local/Temp/tutorial-configured-assets-IKn104/preservation-manifest.json';
const pinned = '10e483a4e7a416119bdbc4c08a30c5f6ad8f015b25fdea780821db4eb9e64cf5';
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const raw = await readFile(manifestPath);
if (hash(raw) !== pinned) throw new Error('Manifest digest differs from approval');
const manifest = JSON.parse(raw.toString());
const sourceRoot = '/opt/content-forge/media';
const targetRoot = '/opt/tutorial-recovery-staging/media';
const files = manifest.files as Array<{path:string;destination:string;size:number;sha256:string}>;
if (files.length !== 40 || new Set(files.map(r=>r.path)).size !== 40 || files.reduce((n,r)=>n+r.size,0)!==16120319) throw new Error('Inventory differs');
for (const r of files) {
  if (!r.path.startsWith(sourceRoot+'/') || posix.normalize(r.path)!==r.path || r.destination!==targetRoot+r.path.slice(sourceRoot.length)
    || !Number.isSafeInteger(r.size)||r.size<=0||r.size>20*1024*1024||!/^[a-f0-9]{64}$/.test(r.sha256)) throw new Error('Invalid manifest entry');
}
function remote(host:string, code:string, input:Buffer, cap:number):Promise<Buffer> {
  return new Promise((resolve,reject)=>{
    const encoded=Buffer.from(code).toString('base64');
    const child=spawn('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes',host,`node --input-type=module -e "eval(Buffer.from('${encoded}','base64').toString())"`],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    const chunks:Buffer[]=[];let bytes=0;let ended=false;
    const timer=setTimeout(()=>{child.kill();reject(new Error('Bounded SSH operation timed out'));},60000);
    child.stdout.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>cap){child.kill();reject(new Error('Remote output exceeded bound'));}else chunks.push(b);});
    child.stderr.resume();
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);ended=true;if(code!==0)reject(new Error('Remote guarded operation rejected'));else resolve(Buffer.concat(chunks));});
    child.stdin.on('error',()=>{if(!ended)child.kill();});child.stdin.end(input);
  });
}
const common = `const fs=await import('node:fs');const fsp=fs.promises;const path=await import('node:path');const crypto=await import('node:crypto');
const hashFile=async p=>{const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(p))h.update(b);return h.digest('hex');};
const root=${JSON.stringify(targetRoot)};if(await fsp.realpath(root)!==root)throw Error('root symlink');
const createdDirectories=[];
const safeParents=async(target,create)=>{if(!target.startsWith(root+'/')||path.normalize(target)!==target)throw Error('target');let p=root;for(const part of path.relative(root,path.dirname(target)).split('/').filter(Boolean)){p=path.join(p,part);try{const s=await fsp.lstat(p);if(!s.isDirectory()||s.isSymbolicLink()||await fsp.realpath(p)!==p)throw Error('parent');}catch(e){if(e.code!=='ENOENT'||!create)throw e;await fsp.mkdir(p,{mode:0o755});if(await fsp.realpath(p)!==p)throw Error('new parent');const s=await fsp.lstat(p);const dir=await fsp.open(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{const actual=await dir.stat();if(actual.ino!==s.ino||actual.dev!==s.dev)throw Error('directory changed');await dir.chown(1000,1000);createdDirectories.push({path:p,inode:s.ino,device:s.dev,uid:1000,gid:1000});}finally{await dir.close();}}}};
const inspect=async r=>{try{const s=await fsp.lstat(r.destination);if(s.isSymbolicLink()||!s.isFile()||s.size!==r.size||await hashFile(r.destination)!==r.sha256)throw Error('conflict');return 'identical';}catch(e){if(e.code==='ENOENT')return 'missing';throw e;}};`;
// All existing targets must be non-conflicting before transferring any bytes.
const preflight=JSON.parse((await remote('vps2',`(async()=>{${common}const states=[];for(const r of ${JSON.stringify(files)}){let p=path.dirname(r.destination);while(!fs.existsSync(p))p=path.dirname(p);if(await fsp.realpath(p)!==p||!(p===root||p.startsWith(root+'/')))throw Error('parent escape');states.push(await inspect(r));}console.log(JSON.stringify(states));})().catch(()=>process.exit(1));`,Buffer.alloc(0),4096)).toString());
const relay=await mkdtemp(join(tmpdir(),'tutorial-reference-relay-'));
const sid=execFileSync('powershell',['-NoProfile','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',windowsHide:true}).trim();
execFileSync('icacls',[relay,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{stdio:'ignore',windowsHide:true});
let copied=0,skipped=0,bytes=0;const receipts=[];
for(let i=0;i<files.length;i++){
  const r=files[i]!;
  if(preflight[i]==='identical'){skipped++;receipts.push({index:i,state:'identical',sha256:r.sha256});continue;}
  const sourceCode=`(async()=>{const fs=await import('node:fs');const crypto=await import('node:crypto');const r=${JSON.stringify(r)};const root=${JSON.stringify(sourceRoot)};if(await fs.promises.realpath(root)!==root||await fs.promises.realpath(r.path)!==r.path)throw Error('source path');const s=await fs.promises.lstat(r.path);if(!s.isFile()||s.isSymbolicLink()||s.size!==r.size)throw Error('source size');const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(r.path))h.update(b);if(h.digest('hex')!==r.sha256)throw Error('source digest');for await(const b of fs.createReadStream(r.path)){if(!process.stdout.write(b))await new Promise(r=>process.stdout.once('drain',r));}})().catch(()=>process.exit(1));`;
  const content=await remote('cf-vps-deploy',sourceCode,Buffer.alloc(0),r.size);
  if(content.length!==r.size||hash(content)!==r.sha256)throw new Error('Relay digest mismatch');
  await writeFile(join(relay,`${String(i).padStart(2,'0')}.bin`),content,{flag:'wx',mode:0o600});
  const receiver=`(async()=>{${common}const r=${JSON.stringify(r)};await safeParents(r.destination,true);if(await inspect(r)==='identical'){console.log(JSON.stringify({state:'identical',sha256:r.sha256,createdDirectories}));return;}const temp=path.join(path.dirname(r.destination),'.preserve-'+crypto.randomUUID()+'.partial');let handle;try{handle=await fsp.open(temp,'wx',0o600);const h=crypto.createHash('sha256');let size=0;for await(const b of process.stdin){size+=b.length;if(size>r.size)throw Error('size cap');h.update(b);await handle.writeFile(b);}if(size!==r.size||h.digest('hex')!==r.sha256)throw Error('digest');await handle.sync();await handle.chown(1000,1000);await handle.chmod(0o644);await handle.close();handle=null;await safeParents(r.destination,false);await fsp.link(temp,r.destination);if(await inspect(r)!=='identical')throw Error('commit verify');console.log(JSON.stringify({state:'created',sha256:r.sha256,createdDirectories}));}finally{await handle?.close();await fsp.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}})().catch(()=>process.exit(1));`;
  const receipt=JSON.parse((await remote('vps2',receiver,content,16384)).toString());
  if(receipt.sha256!==r.sha256)throw new Error('Receiver receipt mismatch');
  if(receipt.state==='created'){copied++;bytes+=r.size;}else skipped++;
  receipts.push({index:i,...receipt});
}
await writeFile(join(relay,'receipts.json'),JSON.stringify({manifestSha256:pinned,completedAt:new Date().toISOString(),receipts},null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({manifestSha256:pinned,copied,skipped,copiedBytes:bytes,relay,allHashesMatched:true,sourceUnchanged:true}));
