import { privateSsh } from './private-ssh';
console.log(await privateSsh('vps2', `
import {spawnSync} from 'node:child_process';
const code="import {createDrizzleClient} from '/app/packages/db/dist/index.js'; import {loadStorageConfigFromDatabase} from '/app/packages/storage/dist/runtime-config.js'; const db=createDrizzleClient(process.env.DATABASE_URL); const c=await loadStorageConfigFromDatabase(db); console.log(JSON.stringify(c.enabled?{enabled:true,credentialSource:'configured'}:{enabled:false,reason:c.reason})); process.exit(0);";
const result=spawnSync('docker',['exec','tutorial-recovery-staging-web-1','node','--input-type=module','-e',code],{encoding:'utf8',timeout:20000});
if(result.status!==0)throw Error('Private effective Drive inspection failed');
process.stdout.write(result.stdout);
`));
