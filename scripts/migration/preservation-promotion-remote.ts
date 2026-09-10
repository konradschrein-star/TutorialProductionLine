/** Self-contained remote functions: serialized code runs through SSH stdin, never written on source. */
export async function readDriveProof(entries: any[]) {
  const {createRequire}=await import('node:module'),{readFileSync}=await import('node:fs'),{createHash}=await import('node:crypto');
  const req=createRequire('/opt/content-forge/package.json');
  const env=req('dotenv').parse(readFileSync('/opt/content-forge/.env'));
  process.chdir('/opt/content-forge');
  let clientId=env.GOOGLE_DRIVE_CLIENT_ID,clientSecret=env.GOOGLE_DRIVE_CLIENT_SECRET;
  if(!clientId||!clientSecret){const raw=JSON.parse(readFileSync(env.GOOGLE_OAUTH_CLIENT_SECRET_FILE,'utf8'));const c=raw.web??raw.installed??raw;clientId??=c.client_id;clientSecret??=c.client_secret;}
  const refresh=env.GOOGLE_DRIVE_REFRESH_TOKEN??readFileSync(env.GOOGLE_DRIVE_REFRESH_TOKEN_FILE,'utf8').trim();
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refresh,grant_type:'refresh_token'}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('proof_auth');const token=(await response.json() as any).access_token;
  async function get(url:string){const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('proof_read');return r;}
  const about=await(await get('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)')).json() as any;
  if(about.user?.emailAddress?.toLowerCase()!=='konrad.schrein@gmail.com')throw Error('proof_account');
  const out=[];
  for(const e of entries){
    if(!/^[\w-]+$/.test(e.drive_file_id))throw Error('proof_id');
    const url=`https://www.googleapis.com/drive/v3/files/${e.drive_file_id}`;
    const meta=await(await get(url+'?fields=id,size,md5Checksum,sha256Checksum,ownedByMe,owners(emailAddress),trashed,parents,version&supportsAllDrives=true')).json() as any;
    if(meta.trashed||!meta.ownedByMe||!meta.owners?.some((x:any)=>x.emailAddress?.toLowerCase()==='konrad.schrein@gmail.com')||Number(meta.size)!==e.bytes||meta.md5Checksum!==e.drive_md5)throw Error('proof_metadata');
    const sha=createHash('sha256'),md5=createHash('md5');let bytes=0;
    const media=await get(url+'?alt=media&supportsAllDrives=true');if(!media.body)throw Error('proof_body');
    for await(const chunk of media.body as any){bytes+=chunk.length;if(bytes>e.bytes)throw Error('proof_size');sha.update(chunk);md5.update(chunk);}
    const digest=sha.digest('hex'),md5sum=md5.digest('hex');
    if(bytes!==e.bytes||digest!==e.checksum_sha256||md5sum!==e.drive_md5)throw Error('proof_hash');
    const after=await(await get(url+'?fields=id,size,md5Checksum,ownedByMe,owners(emailAddress),trashed,parents,version&supportsAllDrives=true')).json() as any;
    if(after.version!==meta.version||after.trashed||!after.ownedByMe||after.size!==meta.size||after.md5Checksum!==meta.md5Checksum||JSON.stringify(after.parents)!==JSON.stringify(meta.parents)||JSON.stringify(after.owners)!==JSON.stringify(meta.owners))throw Error('proof_changed');
    out.push({fileId:e.drive_file_id,ownerMatches:true,ownedByMe:true,trashed:false,bytes,md5:md5sum,sha256:digest,checkedAt:new Date().toISOString(),parentIds:meta.parents??[]});
  }
  return out;
}

export async function readLocalProof(entries:any[]) {
  const fs=await import('node:fs/promises'),{constants}=await import('node:fs'),{posix}=await import('node:path'),{createHash}=await import('node:crypto');
  if(process.platform!=='linux'||process.getuid?.()!==1000)throw Error('local_uid');
  const out=[];
  for(const e of entries){
    const p=e.path;let ready=true,safe=true;
    if(typeof p!=='string'||!p.startsWith('/opt/content-forge/media/')||posix.normalize(p)!==p||p.includes('\\')||/[\x00-\x1f]/.test(p)||p.split('/').length>30)throw Error('local_path');
    let parent='';for(const part of posix.dirname(p).split('/').filter(Boolean)){parent+='/'+part;try{const s=await fs.lstat(parent);if(!s.isDirectory()||s.isSymbolicLink()){safe=false;break;}}catch(err:any){if(err.code==='ENOENT'){ready=false;break;}throw err;}}
    if(!safe||!ready){out.push({jobId:e.jobId,safePath:safe,parentDirectoryReady:ready,state:'absent'});continue;}
    let stat;try{stat=await fs.lstat(p)}catch(err:any){if(err.code==='ENOENT'){out.push({jobId:e.jobId,safePath:true,parentDirectoryReady:true,state:'absent'});continue;}throw err;}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size!==e.bytes){out.push({jobId:e.jobId,safePath:true,parentDirectoryReady:true,state:'conflict'});continue;}
    const stable=(s:any)=>JSON.stringify([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs]);const before=stable(stat),handle=await fs.open(p,constants.O_RDONLY|constants.O_NOFOLLOW),sha=createHash('sha256');let bytes=0;
    try{if(stable(await handle.stat())!==before)throw Error('local_changed');for await(const chunk of handle.createReadStream({autoClose:false})){bytes+=chunk.length;if(bytes>e.bytes)throw Error('local_changed');sha.update(chunk);}if(stable(await handle.stat())!==before||stable(await fs.lstat(p))!==before)throw Error('local_changed');}finally{await handle.close();}
    const digest=sha.digest('hex');out.push({jobId:e.jobId,safePath:true,parentDirectoryReady:true,state:bytes===e.bytes&&digest===e.sha256?'exact':'conflict',bytes,sha256:digest,statToken:before});
  }
  return out;
}
