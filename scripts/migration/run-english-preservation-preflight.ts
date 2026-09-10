/** Fixed-source copy-only preflight. Private rows and credentials never leave source. */
import { readFile } from "node:fs/promises";
import { privateSsh } from "./private-ssh";
if (process.argv[2] !== "--preflight") throw Error("Explicit --preflight required");
const code = await readFile("C:/Users/konra/AppData/Local/Temp/preserve-english-finals-20260909.mjs", "utf8");
const ids = ["48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6", "409f215a-c13d-4937-9dee-3c6aafd995a2", "6b645f6e-1ed6-4ff9-8f55-bb2954d303fb", "2071be5e-9956-42be-9803-04b7d418848b", "63edc16b-33b1-4f9d-8be7-5c71d661f568"];
const result = await privateSsh("cf-vps-deploy", `
import fs from 'node:fs'; import {execFileSync} from 'node:child_process'; import dotenv from 'dotenv';
if(process.getuid()!==0)throw Error('Expected source operator');
const env=dotenv.parse(fs.readFileSync('/opt/content-forge/.env'));
// Existing tutorial root from the audited storage folder scheme, not a new tree.
let clientId=env.GOOGLE_DRIVE_CLIENT_ID,clientSecret=env.GOOGLE_DRIVE_CLIENT_SECRET;
if(!clientId||!clientSecret){const raw=JSON.parse(fs.readFileSync(env.GOOGLE_OAUTH_CLIENT_SECRET_FILE,'utf8'));const c=raw.web??raw.installed??raw;clientId??=c.client_id;clientSecret??=c.client_secret;}
const refreshToken=env.GOOGLE_DRIVE_REFRESH_TOKEN??fs.readFileSync(env.GOOGLE_DRIVE_REFRESH_TOKEN_FILE,'utf8').trim();
const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(10000)});
if(!auth.ok)throw Error('OAuth unavailable');const token=await auth.json();
const url=new URL('https://www.googleapis.com/drive/v3/files');url.searchParams.set('q',"name = '_Tutorials' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'root' in parents and 'me' in owners");url.searchParams.set('fields','files(id),nextPageToken');url.searchParams.set('pageSize','100');
const response=await fetch(url,{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(10000)});
if(!response.ok)throw Error('Existing tutorial folder lookup failed');const folders=await response.json();
if(folders.nextPageToken||folders.files?.length!==1)throw Error('Unique existing tutorial root required');
const folder=folders.files[0].id;
const base=fs.mkdtempSync('/var/tmp/tutorial-migration-preserve-'); fs.chmodSync(base,0o700);
fs.writeFileSync(base+'/cli.mjs',${JSON.stringify(code)},{mode:0o600,flag:'wx'});
fs.writeFileSync(base+'/allowlist.json',${JSON.stringify(JSON.stringify(ids))},{mode:0o600,flag:'wx'});
const output=execFileSync(process.execPath,[base+'/cli.mjs','--allowlist',base+'/allowlist.json','--folder-id',folder,'--out',base+'/manifest.json'],{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']});
process.stdout.write(JSON.stringify({privateDirectory:base,...JSON.parse(output)}));
`, true);
console.log(result);
