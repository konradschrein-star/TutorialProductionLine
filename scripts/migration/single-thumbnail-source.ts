/** Serialized to source Node stdin; fixed selection and bytes, no source writes. */
export async function inspectSingleThumbnailSource(includeBytes=false) {
  const fs=await import('node:fs'),{posix}=await import('node:path'),{execFileSync}=await import('node:child_process'),{createHash}=await import('node:crypto');
  const query="BEGIN READ ONLY;SELECT json_build_object('thumbnail',(SELECT row_to_json(t) FROM (SELECT id,subject_id,subject_kind,language,status,is_selected,review_verdict,output_path,updated_at FROM thumbnails WHERE id='70175471-10ac-4d26-81d5-da503701b942'::uuid AND subject_id='48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6'::uuid)t),'job',(SELECT row_to_json(j) FROM (SELECT id,status,channel_id,final_path FROM tutorial_jobs WHERE id='48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6'::uuid)j));ROLLBACK;";
  const read=()=>JSON.parse(execFileSync('docker',['exec','content-forge-postgres','psql','-X','-U','postgres','-d','content_forge','-qAt','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  const before=read(),t=before.thumbnail,p=t?.output_path,digest=(x:string)=>createHash('sha256').update(x).digest('hex');
  if(digest(JSON.stringify(before))!=='dc4ca9128a562b465d549c6abee5957790d4b11fae12665ae749bfb357b2e3fd'||!t.is_selected||t.status!=='completed'||typeof p!=='string'||!p.startsWith('/opt/content-forge/media/thumbnails/48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6/')||posix.normalize(p)!==p)throw Error('source_revision');
  let parent='';for(const part of posix.dirname(p).split('/').filter(Boolean)){parent+='/'+part;const s=fs.lstatSync(parent);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o022))throw Error('source_ancestor');}
  const s=fs.lstatSync(p),stable=(x:any)=>JSON.stringify([x.dev,x.ino,x.size,x.mtimeMs,x.ctimeMs]);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size!==146123)throw Error('source_file');
  const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let data:Buffer;
  try{if(stable(fs.fstatSync(fd))!==stable(s))throw Error('source_changed');data=fs.readFileSync(fd);if(stable(fs.fstatSync(fd))!==stable(s)||stable(fs.lstatSync(p))!==stable(s))throw Error('source_changed');}finally{fs.closeSync(fd);}
  const sha256=createHash('sha256').update(data).digest('hex'),md5=createHash('md5').update(data).digest('hex');
  if(sha256!=='94113309775e2b0e8eb9077711be893c0c27a6aa7bb48f068ca3b32f122b719f'||md5!=='549dc5cd3a6c891463cc2853dc556c9a'||JSON.stringify(before)!==JSON.stringify(read()))throw Error('source_changed');
  const mimeType=data[0]===255&&data[1]===216?'image/jpeg':data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':null;if(!mimeType)throw Error('source_mime');
  return{jobId:t.subject_id,thumbnailId:t.id,sourcePath:p,sourceRevision:digest(JSON.stringify(before)),completedAt:t.updated_at,bytes:data.length,sha256,md5,mimeType,statToken:stable(s),...(includeBytes?{dataBase64:data.toString('base64')}:{})};
}
