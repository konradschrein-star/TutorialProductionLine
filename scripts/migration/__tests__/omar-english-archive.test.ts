import {describe,it,expect} from 'vitest';
import {validateArchive,OMAR_ARCHIVE as S,type ArchiveManifest} from '../omar-english-archive-policy';
import {preserveOne} from '../preserve-english-finals';
const fixture=():ArchiveManifest=>({version:S.version,parentId:S.parent,folderName:'Recovery archive - Omar English - NOT APPROVED - 20260909',createdAt:new Date().toISOString(),entries:Array.from({length:16},(_,i)=>({jobId:`12345678-1234-1234-1234-${String(i).padStart(12,'0')}`,path:S.root+`/tutorial/${i}.mp4`,filename:`${i}.mp4`,qa:i<5?'failed':'unmeasured',completedAt:new Date().toISOString(),sourceRevision:'a'.repeat(64),bytes:i===15?S.bytes-15:1,sha256:'b'.repeat(64),md5:'c'.repeat(32),statToken:'fixed'}))});
describe('Omar archive-only scope',()=>{
 it('accepts exactly reviewed count bytes and QA classifications',()=>expect(validateArchive(fixture()).entries).toHaveLength(16));
 it('rejects missing files or changed QA',()=>{const m=fixture();m.entries.pop();expect(()=>validateArchive(m)).toThrow();const q=fixture();q.entries[0].qa='unmeasured';expect(()=>validateArchive(q)).toThrow()});
 it('rejects root traversal and destination changes',()=>{const m=fixture();m.entries[0].path=S.root+'/../secret';expect(()=>validateArchive(m)).toThrow();const n=fixture();n.parentId='other';expect(()=>validateArchive(n)).toThrow()});
 it('lost create acknowledgment cannot blindly recreate',async()=>{const f=fixture().entries[0],history:any[]=[];let creates=0;const ports:any={recheck:async()=>{},find:async()=>null,append:async(r:any)=>{history.push(r)},start:async()=>{creates++;throw Error('lost ack')}};await expect(preserveOne(f,history,ports)).rejects.toThrow();await expect(preserveOne(f,history,ports)).rejects.toThrow('reconciliation');expect(creates).toBe(1)});
});
