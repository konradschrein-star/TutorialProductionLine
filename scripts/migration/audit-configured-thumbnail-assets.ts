/** Read-only, bounded prerequisite audit. Writes only a private local manifest. */
import { privateSsh } from './private-ssh.ts';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const sql = `with tc as(select * from channels where accepts_tutorials), selected as(
select distinct a.* from tc c join thumbnail_archetypes a on a.is_active and
(cardinality(a.formats)=0 or 'TUTORIAL_STUDIO'=any(a.formats)) where
exists(select 1 from channel_thumbnail_archetypes x where x.channel_id=c.id and x.archetype_id=a.id and x.tier='base') or
(not exists(select 1 from channel_thumbnail_archetypes x where x.channel_id=c.id) and (a.channel_id is null or a.channel_id=c.id))),
refs as(select 'style_main' kind,reference_image_path p from selected union all select 'style_extra',unnest(extra_reference_paths) from selected
union all select 'host_image',i.image_path from tc c join character_channels cc on cc.channel_id=c.id and cc.role='host' and cc.is_primary
join characters ch on ch.id=cc.character_id and ch.is_active join character_images i on i.character_id=ch.id and i.is_active
union all select 'host_original',i.original_path from tc c join character_channels cc on cc.channel_id=c.id and cc.role='host' and cc.is_primary
join characters ch on ch.id=cc.character_id and ch.is_active join character_images i on i.character_id=ch.id and i.is_active)
select json_agg(r) from (select p as path,array_agg(distinct kind) as kinds from refs where p is not null and p<>'' group by p) r`;
const refs = JSON.parse(await privateSsh('vps2', `import {execFileSync} from 'node:child_process';
console.log(execFileSync('docker',['exec','tutorial-recovery-staging-postgres-1','psql','-U','tutorial_staging','-d','tutorial_staging_cf_20260908','-At','-c',${JSON.stringify(sql)}],{encoding:'utf8'}));`));
if (refs.length !== 40) throw new Error('Configured inventory changed; expected exactly 40 deduplicated paths. Re-audit first.');
const shared = `import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const sourceRoot='/opt/content-forge/media';const inside=(root,p)=>p!==root&&p.startsWith(root+'/');
const digest=async p=>{const h=crypto.createHash('sha256');for await(const c of fs.createReadStream(p))h.update(c);return h.digest('hex');};`;
const source = JSON.parse(await privateSsh('cf-vps-deploy', `${shared}
const root=fs.realpathSync(sourceRoot);const out=[];let total=0;
for(const r of ${JSON.stringify(refs)}){
if(!inside(sourceRoot,r.path)||path.normalize(r.path)!==r.path)throw new Error('Unsafe source path');
const real=fs.realpathSync(r.path);if(!inside(root,real)||real!==r.path)throw new Error('Source symlink or root mismatch');
const st=fs.statSync(real);if(!st.isFile()||st.size<=0||st.size>20*1024*1024)throw new Error('Source file invalid or exceeds per-file cap');
total+=st.size;if(total>32*1024*1024)throw new Error('Inventory exceeds 32MiB cap');
out.push({...r,size:st.size,sha256:await digest(real)});}
console.log(JSON.stringify({root,files:out}));`, true));
const destination = JSON.parse(await privateSsh('vps2', `${shared}
import {execFileSync} from 'node:child_process';
const info=JSON.parse(execFileSync('docker',['inspect','tutorial-recovery-staging-web-1'],{encoding:'utf8'}))[0];
const mounts=info.Mounts;const out=[];const roots=new Set();
for(const r of ${JSON.stringify(source.files)}){
const mount=mounts.filter(m=>r.path===m.Destination||inside(m.Destination,r.path)).sort((a,b)=>b.Destination.length-a.Destination.length)[0];
if(!mount||mount.Type!=='bind')throw new Error('No explicit preserved-path bind mount');
const root=fs.realpathSync(mount.Source);const target=path.join(root,path.relative(mount.Destination,r.path));
if(!inside(root,target))throw new Error('Destination containment failure');roots.add(root);
let ancestor=target;while(!fs.existsSync(ancestor)){const next=path.dirname(ancestor);if(next===ancestor)throw new Error('No parent');ancestor=next;}
const realAncestor=fs.realpathSync(ancestor);if(realAncestor!==ancestor||!(realAncestor===root||inside(root,realAncestor)))throw new Error('Destination symlink escape');
let state='missing';let existingSha256=null;if(fs.existsSync(target)){const st=fs.statSync(target);if(!st.isFile()||st.size!==r.size)state='conflict';else{existingSha256=await digest(target);state=existingSha256===r.sha256?'identical':'conflict';}}
out.push({...r,destination:target,destinationState:state,existingSha256});}
console.log(JSON.stringify({roots:[...roots],files:out}));`));
const directory = await mkdtemp(join(tmpdir(), 'tutorial-configured-assets-'));
const manifest = join(directory, 'preservation-manifest.json');
await writeFile(manifest, JSON.stringify({version:1,createdAt:new Date().toISOString(),sourceHost:'cf-vps-deploy',destinationHost:'vps2',sourceRoot:source.root,destinationRoots:destination.roots,files:destination.files},null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({manifest,files:destination.files.length,bytes:destination.files.reduce((n:any,r:any)=>n+r.size,0),sourcePrefix:source.root,destinationPrefixes:destination.roots,identical:destination.files.filter((r:any)=>r.destinationState==='identical').length,missing:destination.files.filter((r:any)=>r.destinationState==='missing').length,conflicts:destination.files.filter((r:any)=>r.destinationState==='conflict').length}));
