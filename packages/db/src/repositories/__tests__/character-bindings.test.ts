import { describe, expect, it } from 'vitest';
import { setCharacterChannels } from '../character-library-repository.js';
function database() {
  let rows:any[]=[{channel_id:'a',role:'host',is_primary:true},{channel_id:'b',role:'cast',is_primary:false}];
  let queue=Promise.resolve();let transactions=0;
  const db={transaction: async (consume:any)=>{
    const before=queue;let release!:()=>void;queue=new Promise<void>(r=>{release=r;});await before;
    const saved=structuredClone(rows);transactions++;
    const tx={select:()=>({from:()=>({where:()=>({for:async()=>[{id:'host'}],then:(resolve:any)=>Promise.resolve(structuredClone(rows)).then(resolve)})})}),
      delete:()=>({where:async()=>{rows=[];}}),insert:()=>({values:async(v:any[])=>{if(v.some(b=>b.channel_id==='conflict'))throw Error('primary conflict');rows=v;}})};
    try{return await consume(tx);}catch(e){rows=saved;throw e;}finally{release();}
  }};
  return {db:db as any,rows:()=>rows,transactions:()=>transactions};
}
describe('atomic character channel replacement',()=>{
  it('rolls back deleted bindings when the replacement violates a constraint',async()=>{
    const d=database(),before=structuredClone(d.rows());
    await expect(setCharacterChannels(d.db,'host',[{channel_id:'conflict'}])).rejects.toThrow('primary conflict');
    expect(d.rows()).toEqual(before);expect(d.transactions()).toBe(1);
  });
  it('preserves each existing primary/role while new host bindings are primary per channel',async()=>{
    const d=database();await setCharacterChannels(d.db,'host',[{channel_id:'a'},{channel_id:'b'},{channel_id:'c',role:'host',is_primary:true}]);
    expect(d.rows().map(r=>[r.channel_id,r.role,r.is_primary])).toEqual([['a','host',true],['b','cast',false],['c','host',true]]);
  });
  it('serializes concurrent replacement and retains the successful update if the next fails',async()=>{
    const d=database();const results=await Promise.allSettled([setCharacterChannels(d.db,'host',[{channel_id:'c'}]),setCharacterChannels(d.db,'host',[{channel_id:'conflict'}])]);
    expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']);expect(d.rows().map(r=>r.channel_id)).toEqual(['c']);
  });
  it('explicit empty replacement commits in the same transaction',async()=>{const d=database();await setCharacterChannels(d.db,'host',[]);expect(d.rows()).toEqual([]);expect(d.transactions()).toBe(1);});
});
