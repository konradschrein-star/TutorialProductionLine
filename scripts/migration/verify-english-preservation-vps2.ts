/** One exact-ID restoration pilot. Keeps the restored test file, never evicts originals. */
import { privateSsh } from "./private-ssh";
if (process.argv[2] !== "--restore-one") throw Error("Explicit --restore-one required");
const receipt = JSON.parse(await privateSsh("cf-vps-deploy", `
import fs from 'node:fs';import crypto from 'node:crypto';
const base='/var/tmp/tutorial-migration-preserve-q09ypb';
const text=fs.readFileSync(base+'/manifest.json','utf8');
if(crypto.createHash('sha256').update(text).digest('hex')!=='f022aedee8cd423e26a8ce05adce4b98164c27fa504a8e9f85ceb26a0fe188da')throw Error('Manifest changed');
const manifest=JSON.parse(text);const first=manifest.entries[0];
const rows=fs.readFileSync(base+'/receipts.jsonl','utf8').trim().split('\\n').map(x=>JSON.parse(x));
const found=rows.filter(r=>r.stage==='verified'&&r.jobId===first.jobId&&r.sha256===first.sha256&&r.bytes===first.bytes).at(-1);
if(!found)throw Error('No verified exact receipt');
process.stdout.write(JSON.stringify({fileId:found.fileId,bytes:found.bytes,sha256:found.sha256}));
`));
if (!/^[\w-]{10,200}$/.test(receipt.fileId) || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !Number.isSafeInteger(receipt.bytes) || receipt.bytes > 32 * 1024 * 1024) throw Error("Invalid bounded pilot identity");
console.log(await privateSsh("vps2", `
import fs from 'node:fs';import crypto from 'node:crypto';import {Readable,Transform} from 'node:stream';import {pipeline} from 'node:stream/promises';
const expected=${JSON.stringify(receipt)};
const base='/opt/tutorial-recovery-staging';const info=fs.lstatSync(base);
if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==0||(info.mode&0o077))throw Error('Unsafe staging root');
const raw=JSON.parse(fs.readFileSync(base+'/drive-secrets/client.json','utf8'));const c=raw.installed??raw.web??raw;
const refresh=fs.readFileSync(base+'/drive-secrets/refresh-token.txt','utf8').trim();
const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:c.client_id,client_secret:c.client_secret,refresh_token:refresh,grant_type:'refresh_token'}),signal:AbortSignal.timeout(10000)});
if(!auth.ok)throw Error('OAuth failed');const token=await auth.json();
const headers={Authorization:'Bearer '+token.access_token};
const aboutResponse=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers,signal:AbortSignal.timeout(10000)});
if(!aboutResponse.ok||(await aboutResponse.json()).user?.emailAddress?.toLowerCase()!=='konrad.schrein@gmail.com')throw Error('Wrong Drive owner');
const response=await fetch('https://www.googleapis.com/drive/v3/files/'+expected.fileId+'?alt=media',{headers,signal:AbortSignal.timeout(40000)});
if(!response.ok||!response.body)throw Error('Exact Drive download failed');
const dir=fs.mkdtempSync(base+'/restore-pilot-');fs.chmodSync(dir,0o700);const path=dir+'/english-original.mp4';
const hash=crypto.createHash('sha256');let count=0;
const check=new Transform({transform(chunk,encoding,callback){count+=chunk.length;if(count>expected.bytes)return callback(Error('Excess remote bytes'));hash.update(chunk);callback(null,chunk);}});
await pipeline(Readable.fromWeb(response.body),check,fs.createWriteStream(path,{flags:'wx',mode:0o600}));
if(count!==expected.bytes||hash.digest('hex')!==expected.sha256)throw Error('Restore verification failed');
process.stdout.write(JSON.stringify({exactRestoreVerified:true,bytes:count,sha256:expected.sha256,privatePilotPath:path,driveWrites:0,databaseWrites:0,originalsDeleted:0}));
`));
