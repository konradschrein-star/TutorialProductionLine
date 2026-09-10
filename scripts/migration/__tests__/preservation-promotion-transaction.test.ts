import {afterEach,describe,expect,it,vi} from 'vitest';
const fake=vi.hoisted(()=>({db:null as any}));
vi.mock('node:module',()=>({createRequire:()=>()=>()=>fake.db}));
import {rehearsePromotion} from '../preservation-promotion-transaction';
const originalUid=Object.getOwnPropertyDescriptor(process,'getuid');
afterEach(()=>{vi.restoreAllMocks();if(originalUid)Object.defineProperty(process,'getuid',originalUid);else delete (process as any).getuid;});
function harness(){
  const calls:string[]=[];
  const db:any=async(parts:TemplateStringsArray)=>{calls.push(parts.join('?'));return [{db:'tutorial_staging_cf_20260908',role:'tutorial_staging',fresh:true,result:{parentInserts:3,versionInserts:5,pointerUpdates:5}}]};
  db.unsafe=async(text:string)=>{calls.push(text)};db.end=async()=>calls.push('END_CONNECTION');fake.db=db;
  Object.defineProperty(process,'getuid',{configurable:true,value:()=>1000});
  const ids=['2071be5e-9956-42be-9803-04b7d418848b','409f215a-c13d-4937-9dee-3c6aafd995a2','48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6','63edc16b-33b1-4f9d-8be7-5c71d661f568','6b645f6e-1ed6-4ff9-8f55-bb2954d303fb'];
  const plan={updates:ids.map(jobId=>({jobId})),preparation:{parents:Array(3).fill({}),fences:ids.map(id=>({id}))},atomicAllFive:true,execute:false,localEntries:[],localSnapshots:[]};
  return{calls,db,plan};
}
describe('rollback-only promotion transaction',()=>{
  it('takes root then media then artifact fences before local hashing and always rolls back success',async()=>{const h=harness();const result=await rehearsePromotion(h.plan,async()=>{h.calls.push('LOCAL_HASH');return []});expect(result.committedWrites).toBe(0);const lock=h.calls.find(s=>s.includes('runtime_fence'))!;expect(lock.indexOf('FROM tutorial_jobs')).toBeLessThan(lock.indexOf('tutorial-media:'));expect(lock.indexOf('tutorial-media:')).toBeLessThan(lock.indexOf('FROM storage_artifacts'));expect(h.calls.indexOf(lock)).toBeLessThan(h.calls.indexOf('LOCAL_HASH'));expect(h.calls.at(-2)).toBe('ROLLBACK');expect(h.calls.some(s=>/\bCOMMIT\b/.test(s))).toBe(false);});
  it('rolls back a changed local snapshot before inserts',async()=>{const h=harness();await expect(rehearsePromotion(h.plan,async()=>[{changed:true}])).rejects.toThrow('local_fence');expect(h.calls.at(-2)).toBe('ROLLBACK');expect(h.calls.some(s=>s.includes('INSERT INTO storage_artifacts'))).toBe(false);});
  it('rolls back SQL errors and never exposes a commit path',async()=>{const h=harness();h.db.unsafe=async(s:string)=>{h.calls.push(s);if(s.includes('INSERT INTO storage_artifacts'))throw Error('synthetic_conflict')};await expect(rehearsePromotion(h.plan,async()=>[])).rejects.toThrow('synthetic_conflict');expect(h.calls.at(-2)).toBe('ROLLBACK');});
  it('rejects explicit commit without a protected backup attestation',async()=>{const h=harness();await expect(rehearsePromotion(h.plan,async()=>[],'commit-five-verified-originals')).rejects.toThrow('verified_backup');expect(h.calls).not.toContain('COMMIT');});
  it('commits only the explicit mode after fresh backup and source/local fences (mock only)',async()=>{const h=harness();const backup={database:'tutorial_staging_cf_20260908',path:'/var/tmp/tutorial-preservation-promotion-synthetic/staging-before-promotion.dump',bytes:100,sha256:'a'.repeat(64),listingVerified:true,completedAt:'2026-09-09T00:00:00Z'};const result=await rehearsePromotion(h.plan,async()=>[],'commit-five-verified-originals',backup);expect(result).toMatchObject({commitPerformed:true,committedWrites:13});expect(h.calls.at(-2)).toBe('COMMIT');expect(h.calls).not.toContain('ROLLBACK');});
  it('treats lost COMMIT acknowledgement as uncertain, never reported rollback',async()=>{const h=harness();h.db.unsafe=async(s:string)=>{h.calls.push(s);if(s==='COMMIT')throw Error('lost_ack')};const backup={database:'tutorial_staging_cf_20260908',path:'/var/tmp/tutorial-preservation-promotion-synthetic/staging-before-promotion.dump',bytes:100,sha256:'a'.repeat(64),listingVerified:true,completedAt:'2026-09-09T00:00:00Z'};await expect(rehearsePromotion(h.plan,async()=>[],'commit-five-verified-originals',backup)).rejects.toThrow('commit_outcome_uncertain');expect(h.calls).not.toContain('ROLLBACK');});
});
