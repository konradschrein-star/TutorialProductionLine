import { privateSsh } from './private-ssh';
console.log(await privateSsh('vps2', `
import {execFileSync,spawnSync} from 'node:child_process';
const row=JSON.parse(execFileSync('docker',['inspect','tutorial-recovery-staging-web-1'],{encoding:'utf8'}))[0];
const probe=spawnSync('docker',['exec','tutorial-recovery-staging-web-1','node','--input-type=module','-e',"const r=await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(10000)});console.log(JSON.stringify({http:r.status,body:await r.json()}));"],{encoding:'utf8',timeout:15000});
process.stdout.write(JSON.stringify({state:{status:row.State.Status,restarting:row.State.Restarting,oom:row.State.OOMKilled},bindings:row.HostConfig.PortBindings,ports:row.NetworkSettings.Ports,networks:Object.keys(row.NetworkSettings.Networks),mounts:row.Mounts.map(m=>({source:m.Source,target:m.Destination,writable:m.RW})),mediaEnvironment:row.Config.Env.filter(value=>value.startsWith('LOCAL_MEDIA_ROOT=')||value.startsWith('THUMBNAIL_MEDIA_DIR=')),health:probe.status===0?JSON.parse(probe.stdout):{probeFailed:true}}));
`));
