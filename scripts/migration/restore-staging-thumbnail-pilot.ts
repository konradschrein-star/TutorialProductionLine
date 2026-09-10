import { privateSsh } from './private-ssh';
if (process.argv[2] !== '--restore-exact') throw Error('Explicit exact restoration required');
console.log(await privateSsh('vps2', `
import {spawnSync} from 'node:child_process';
const code=${JSON.stringify(`
import {createDrizzleClient,thumbnails} from '/app/packages/db/dist/index.js';
import {eq} from 'drizzle-orm';
import {withTutorialMedia} from '/app/packages/storage/dist/tutorial-media.js';
import {fingerprintStorageSource} from '/app/packages/storage/dist/artifact-store.js';
import {mkdir,realpath,lstat} from 'node:fs/promises';
import {dirname} from 'node:path';
const db=createDrizzleClient(process.env.DATABASE_URL);
const [row]=await db.select().from(thumbnails).where(eq(thumbnails.id,'3b9cab2e-5b5c-4647-9753-31fa0c966e9b'));
if(!row || row.subject_id!=='d49fd231-e269-41ab-9021-ec1f0ca12c5d' || !row.output_path) throw Error('Unexpected exact thumbnail identity');
try {
const parent=dirname(row.output_path);
if(parent!=='/opt/content-forge/media/thumbnails/d49fd231-e269-41ab-9021-ec1f0ca12c5d' || await realpath(dirname(parent))!==dirname(parent)) throw Error('Unexpected restore parent');
await mkdir(parent,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
const info=await lstat(parent);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid())throw Error('Unsafe restore parent');
const result=await withTutorialMedia(db,{jobId:row.subject_id,kind:'thumbnail',path:row.output_path,expectedContent:{sha256:'7de7e37d8f9ee6e91b573fa925c932e68b63ae8b31ef66d86609901cc2e8ab3b',size:127176}},{allowedRoots:['/opt/content-forge/media'],maxBytes:32*1024*1024},fingerprintStorageSource);
console.log(JSON.stringify({restored:true,bytes:result.bytes,sha256:result.sha256,databaseWrites:0,sourceDeletions:0}));
} catch(error) { console.log(JSON.stringify({restored:false,error:error instanceof Error?error.message:'Unknown restoration failure'})); }
process.exit(0);
`)};
const result=spawnSync('docker',['exec','tutorial-recovery-staging-web-1','node','--input-type=module','-e',code],{encoding:'utf8',timeout:45000});
if(result.status!==0)throw Error('Private exact restoration failed before result');
process.stdout.write(result.stdout);
`));
