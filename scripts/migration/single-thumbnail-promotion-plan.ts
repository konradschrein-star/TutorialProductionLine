import {posix} from 'node:path';
import {SINGLE_THUMBNAIL as S,assertSingleThumbnail} from './single-thumbnail-policy';
import {sha256Text} from './preserve-english-finals';
export function planSingleThumbnailPromotion(input:any,target:any,proof:any,local:any,now:number){
  const manifest=JSON.parse(input.manifest);assertSingleThumbnail(manifest);
  if(manifest.version!=='selected-thumbnail-preservation/1'||manifest.folderId!==S.folderId||manifest.account!=='konrad.schrein@gmail.com'||sha256Text(input.manifest)!=='b4b5585e49e2822b0bdd24a4d907184de40c3f041725ab6fcb63b0255064467c'||!input.ledger.endsWith('\n'))throw Error('Singleton manifest changed');
  let head='',n=0,last:any=null;for(const line of input.ledger.split('\n').filter(Boolean)){const {hash,...r}=JSON.parse(line);if(r.manifestSha256!==sha256Text(input.manifest)||r.sequence!==++n||r.previousHash!==head||r.jobId!==S.jobId||r.thumbnailId!==S.thumbnailId||hash!==sha256Text(JSON.stringify(r)))throw Error('Singleton ledger chain');head=hash;last=r;}
  if(last?.stage!=='verified'||last.fileId!=='1S5yw7OnPaJ0kgjwiHJo7yn2SjVhLrXmZ'||last.sha256!==S.sha256||last.bytes!==S.bytes||!Number.isFinite(Date.parse(last.at)))throw Error('Verified singleton receipt required');
  const validPath=(p:any)=>typeof p==='string'&&p.startsWith('/opt/content-forge/media/')&&posix.normalize(p)===p&&!p.includes('\\')&&!/[\x00-\x1f]/.test(p)&&p.split('/').length<=30;
  if(!validPath(manifest.sourcePath)||!manifest.sourcePath.startsWith('/opt/content-forge/media/thumbnails/'+S.jobId+'/'))throw Error('Pinned thumbnail path');
  const j=target.job,t=target.thumbnail;
  if(j?.id!==S.jobId||j.language!=='en'||!j.channel_id||j.source_job_id||j.parent_job_id||t?.id!==S.thumbnailId||t.subject_id!==S.jobId||t.subject_kind!=='tutorial_job'||!t.is_selected||t.language!=='en'||t.status!=='completed'||t.review_verdict!=='not_reviewed'||t.output_path!==manifest.sourcePath||target.selectedCount!==1)throw Error('Selected original changed');
  if(!Number.isFinite(now)||proof?.fileId!==last.fileId||!proof.ownerMatches||!proof.ownedByMe||proof.trashed||proof.bytes!==S.bytes||proof.sha256!==S.sha256||proof.md5!==S.md5||JSON.stringify(proof.parentIds)!==JSON.stringify([S.folderId])||!Number.isFinite(Date.parse(proof.checkedAt))||Date.parse(proof.checkedAt)>now||now-Date.parse(proof.checkedAt)>900000)throw Error('Fresh singleton Drive proof');
  if(local?.jobId!==S.jobId||!local.safePath||!local.parentDirectoryReady||!['absent','exact'].includes(local.state)||(local.state==='exact'&&(local.bytes!==S.bytes||local.sha256!==S.sha256)))throw Error('Unsafe or missing thumbnail target directory');
  if(target.artifacts.length>1)throw Error('Artifact ownership ambiguity');const prior=target.artifacts[0]??null;
  if(prior&&(prior.job_id!==S.jobId||prior.owner_kind!=='tutorial_job'||prior.kind!=='thumbnail'||!validPath(prior.vps_path)||prior.state==='uploading'||prior.resumable_session_uri))throw Error('Existing thumbnail artifact conflict');
  const digest=sha256Text('single-thumbnail-parent/1:'+S.jobId+':thumbnail'),artifactId=prior?.id??`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
  const version={artifact_id:artifactId,drive_file_id:last.fileId,vps_path:manifest.sourcePath,bytes:S.bytes,checksum_sha256:S.sha256,drive_md5:S.md5,verified_at:last.at};
  // This specific rescue permits no replacement: absent or fully applied only.
  const priorVersions:any[]=[];
  for(const expected of [...priorVersions,version])for(const v of [...target.versions,version])if(v.artifact_id===expected.artifact_id&&v.drive_file_id===expected.drive_file_id){if(['vps_path','bytes','checksum_sha256','drive_md5'].some(k=>(v[k]??null)!==((expected as any)[k]??null))||(v.verified_at==null||expected.verified_at==null?(v.verified_at??null)!==(expected.verified_at??null):Date.parse(v.verified_at)!==Date.parse(expected.verified_at)))throw Error('Immutable thumbnail conflict');}
  const values={vps_path:manifest.sourcePath,drive_file_id:last.fileId,drive_web_link:'https://drive.google.com/file/d/'+last.fileId+'/view',drive_folder_id:S.folderId,drive_folder_path:null,bytes:S.bytes,checksum_sha256:S.sha256,drive_md5:S.md5,state:'uploaded',verified_at:last.at,uploaded_at:last.at,bytes_uploaded:S.bytes,resumable_session_uri:null,error_kind:null,error_message:null};
  if(prior){
    if(Object.entries(values).some(([k,v])=>['verified_at','uploaded_at'].includes(k)?Date.parse(prior[k])!==Date.parse(String(v)):prior[k]!==v))throw Error('Existing pointer is not exactly applied; replacement not authorized');
    if(!target.versions.some((v:any)=>v.artifact_id===artifactId&&v.drive_file_id===last.fileId&&v.vps_path===version.vps_path&&v.bytes===S.bytes&&v.checksum_sha256===S.sha256&&v.drive_md5===S.md5&&Date.parse(v.verified_at)===Date.parse(last.at)))throw Error('Existing pointer lacks exactly applied immutable receipt');
  }
  return{job:j,thumbnail:t,artifactId,prior,priorVersions,version,values,filename:posix.basename(manifest.sourcePath),mediaLeases:[...new Set([manifest.sourcePath,...(prior?[prior.vps_path]:[])])].sort(),remoteCheckedAt:proof.checkedAt,localEntries:[{jobId:S.jobId,path:manifest.sourcePath,bytes:S.bytes,sha256:S.sha256}],localSnapshots:[local],manifestSha256:sha256Text(input.manifest),ledgerSha256:sha256Text(input.ledger),ledgerHead:head};
}
