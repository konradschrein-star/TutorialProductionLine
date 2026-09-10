/** VPS2 host only. Full staging backup stays private on-server; no source writes. */
export async function createPromotionBackup(audit:any) {
  const fs=await import('node:fs'),fsp=await import('node:fs/promises'),{spawnSync}=await import('node:child_process'),{createHash}=await import('node:crypto');
  if(process.platform!=='linux'||process.getuid?.()!==0)throw Error('backup_host');
  const args=['exec','tutorial-recovery-staging-postgres-1'];
  const identity=spawnSync('docker',[...args,'psql','-X','-U','tutorial_staging','-d','tutorial_staging_cf_20260908','-qAt','-v','ON_ERROR_STOP=1','-c',"SELECT current_database() || ':' || current_user;"],{encoding:'utf8',timeout:30000});
  if(identity.status!==0||identity.stdout.trim()!=='tutorial_staging_cf_20260908:tutorial_staging')throw Error('backup_identity');
  const free=await fsp.statfs('/var/tmp');if(Number(free.bavail)*Number(free.bsize)<2*1024**3)throw Error('backup_headroom');
  const directory=await fsp.mkdtemp('/var/tmp/tutorial-preservation-promotion-');await fsp.chmod(directory,0o700);
  const path=directory+'/staging-before-promotion.dump',fd=fs.openSync(path,'wx',0o600);
  try{const result=spawnSync('docker',[...args,'pg_dump','-U','tutorial_staging','-d','tutorial_staging_cf_20260908','-Fc'],{stdio:['ignore',fd,'pipe'],timeout:180000,maxBuffer:1024*1024});if(result.status!==0)throw Error('backup_dump');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const info=await fsp.lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.uid!==0||info.nlink!==1||(info.mode&0o077)||info.size<1)throw Error('backup_file');
  const read=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let listing;
  try{listing=spawnSync('docker',['exec','-i','tutorial-recovery-staging-postgres-1','pg_restore','--list'],{stdio:[read,'pipe','pipe'],encoding:'utf8',timeout:60000,maxBuffer:8*1024**2});}finally{fs.closeSync(read);}
  if(listing.status!==0||!['tutorial_jobs','users','storage_artifacts','storage_artifact_versions'].every(table=>new RegExp('TABLE DATA public '+table+' ').test(listing.stdout)))throw Error('backup_listing');
  const hash=createHash('sha256');for await(const chunk of fs.createReadStream(path))hash.update(chunk);
  const proof={database:'tutorial_staging_cf_20260908',path,bytes:info.size,sha256:hash.digest('hex'),listingVerified:true,completedAt:new Date().toISOString()};
  const auditHandle=await fsp.open(directory+'/backup-audit.json','wx',0o600);try{await auditHandle.writeFile(JSON.stringify({version:1,...proof,...audit})+'\n');await auditHandle.sync();}finally{await auditHandle.close();}
  const directoryHandle=await fsp.open(directory,'r');try{await directoryHandle.sync();}finally{await directoryHandle.close();}
  return proof;
}

export async function verifyPromotionBackup(proof:any) {
  const fs=await import('node:fs'),fsp=await import('node:fs/promises'),{createHash}=await import('node:crypto');
  if(process.platform!=='linux'||process.getuid?.()!==0||!/^\/var\/tmp\/tutorial-preservation-promotion-[A-Za-z0-9]+\/staging-before-promotion\.dump$/.test(proof.path))throw Error('backup_path');
  const directory=proof.path.slice(0,proof.path.lastIndexOf('/'));for(const path of [directory,proof.path,directory+'/backup-audit.json']){const s=await fsp.lstat(path);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o077))throw Error('backup_protection');}
  const s=await fsp.lstat(proof.path);if(!s.isFile()||s.nlink!==1||s.size!==proof.bytes)throw Error('backup_changed');
  const stable=(item:any)=>JSON.stringify([item.dev,item.ino,item.size,item.mtimeMs,item.ctimeMs]);
  const hash=createHash('sha256'),handle=await fsp.open(proof.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{if(stable(await handle.stat())!==stable(s))throw Error('backup_changed');for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);if(stable(await handle.stat())!==stable(s)||stable(await fsp.lstat(proof.path))!==stable(s)||hash.digest('hex')!==proof.sha256)throw Error('backup_changed');}finally{await handle.close();}
  const audit=JSON.parse(await fsp.readFile(directory+'/backup-audit.json','utf8'));
  if(audit.sha256!==proof.sha256||audit.bytes!==proof.bytes||audit.listingVerified!==true||audit.completedAt!==proof.completedAt)throw Error('backup_audit');
  return {verified:true};
}

export async function recordPromotionAudit(input:any) {
  const fs=await import('node:fs/promises');
  const {proof,event,...summary}=input;
  if(process.platform!=='linux'||process.getuid?.()!==0||!/^\/var\/tmp\/tutorial-preservation-promotion-[A-Za-z0-9]+\/staging-before-promotion\.dump$/.test(proof.path)||!['before-commit','after-commit','reconciliation'].includes(event))throw Error('audit_scope');
  const dir=proof.path.slice(0,proof.path.lastIndexOf('/')),s=await fs.lstat(dir);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077))throw Error('audit_directory');
  const file=await fs.open(dir+'/'+event+'.json','wx',0o600);
  try{await file.writeFile(JSON.stringify({version:1,event,at:new Date().toISOString(),backupSha256:proof.sha256,...summary})+'\n');await file.sync();}finally{await file.close();}
  const directoryHandle=await fs.open(dir,'r');try{await directoryHandle.sync();}finally{await directoryHandle.close();}
  return {recorded:true};
}
