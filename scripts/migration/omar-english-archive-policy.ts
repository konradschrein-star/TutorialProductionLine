import {sha256Text,type PreservedFile} from './preserve-english-finals';
export const OMAR_ARCHIVE={parent:'1cztfSoY3vjFoHHfPQHccAGn6P797sHaL',count:16,bytes:134989032,root:'/opt/tutorial-studio/media',version:'omar-english-archive/1'} as const;
export type ArchiveEntry=PreservedFile & {filename:string;qa:'failed'|'unmeasured'};
export type ArchiveManifest={version:string;parentId:string;folderName:string;createdAt:string;entries:ArchiveEntry[]};
export function validateArchive(m:ArchiveManifest){
 if(m.version!==OMAR_ARCHIVE.version||m.parentId!==OMAR_ARCHIVE.parent||m.folderName!=='Recovery archive - Omar English - NOT APPROVED - 20260909'||m.entries.length!==16)throw Error('manifest_scope');
 if(new Set(m.entries.map(e=>e.jobId)).size!==16||new Set(m.entries.map(e=>e.path)).size!==16||m.entries.reduce((n,e)=>n+e.bytes,0)!==OMAR_ARCHIVE.bytes||m.entries.filter(e=>e.qa==='failed').length!==5||m.entries.filter(e=>e.qa==='unmeasured').length!==11)throw Error('manifest_counts');
 for(const e of m.entries)if(!/^[a-f0-9-]{36}$/.test(e.jobId)||!e.path.startsWith(OMAR_ARCHIVE.root+'/')||e.path.split('/').some(p=>p==='..'||p==='.')||!Number.isSafeInteger(e.bytes)||e.bytes<=0||!/^[a-f0-9]{64}$/.test(e.sha256)||!/^[a-f0-9]{32}$/.test(e.md5)||!/^[a-f0-9]{64}$/.test(e.sourceRevision)||!e.filename||/[\/\\\x00-\x1f]/.test(e.filename))throw Error('manifest_entry');
 return m;
}
export const archiveRevision=(r:any)=>sha256Text(JSON.stringify(r));
