/** Owner-authorized migration to VPS2. No PC credential files, activation,
 * provider generation, Drive writes, source mutations or global sharing. */
import { privateSsh } from "./private-ssh";
const mode = process.argv[2];
if (mode !== "--prepare") throw Error("Explicit --prepare required");
const bundle = JSON.parse(await privateSsh("cf-vps-deploy", `
import fs from 'node:fs'; import dotenv from 'dotenv';
const env=dotenv.parse(fs.readFileSync('/opt/content-forge/.env')); process.chdir('/opt/content-forge');
let clientId=env.GOOGLE_DRIVE_CLIENT_ID,clientSecret=env.GOOGLE_DRIVE_CLIENT_SECRET;
if(!clientId||!clientSecret){const raw=JSON.parse(fs.readFileSync(env.GOOGLE_OAUTH_CLIENT_SECRET_FILE,'utf8'));const c=raw.web??raw.installed??raw;clientId??=c.client_id;clientSecret??=c.client_secret;}
const refreshToken=env.GOOGLE_DRIVE_REFRESH_TOKEN??fs.readFileSync(env.GOOGLE_DRIVE_REFRESH_TOKEN_FILE,'utf8').trim();
if(!clientId||!clientSecret||!refreshToken)throw Error('Missing OAuth');
process.stdout.write(JSON.stringify({clientId,clientSecret,refreshToken,rootFolderId:env.GOOGLE_DRIVE_ROOT_FOLDER_ID??'',rootFolderName:env.GOOGLE_DRIVE_ROOT_FOLDER_NAME??'Content Forge'}));
`, true)) as Record<string, string>;
for (const name of ["clientId", "clientSecret", "refreshToken", "rootFolderId", "rootFolderName"]) {
  if (typeof bundle[name] !== "string" || bundle[name].length > 32768 || /[\r\n\0'\\]/.test(bundle[name])) throw Error("Unsupported credential/config format");
}
const result = await privateSsh("vps2", `
import fs from 'node:fs';import crypto from 'node:crypto';
const b=${JSON.stringify(bundle)};
const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:b.clientId,client_secret:b.clientSecret,refresh_token:b.refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
if(!tokenResponse.ok)throw Error('OAuth refresh failed');const token=await tokenResponse.json();
const response=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
if(!response.ok)throw Error('Drive identity failed');const about=await response.json();
if(about.user?.emailAddress?.toLowerCase()!=='konrad.schrein@gmail.com')throw Error('Wrong Drive account');
const base='/opt/tutorial-recovery-staging';const dir=fs.lstatSync(base);
if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)||dir.uid!==process.getuid())throw Error('Unsafe staging directory');
const privateDir=base+'/drive-secrets';
fs.mkdirSync(privateDir,{mode:0o700});
function write(path,data){const fd=fs.openSync(path,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o400);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);fs.fchownSync(fd,1000,1000);}finally{fs.closeSync(fd);}}
write(privateDir+'/client.json',JSON.stringify({installed:{client_id:b.clientId,client_secret:b.clientSecret}}));
write(privateDir+'/refresh-token.txt',b.refreshToken);
fs.chownSync(privateDir,1000,1000);
const providerPath=base+'/runtime.providers-20260909.env.candidate';const info=fs.lstatSync(providerPath);
if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)||info.uid!==process.getuid())throw Error('Unsafe provider candidate');
const provider=fs.readFileSync(providerPath,'utf8');
if(crypto.createHash('sha256').update(provider).digest('hex')!=='4565f62c594a83efef9904e4d5f52adf7a7b32d2bc81e08c9ec49428252f8326')throw Error('Provider candidate changed');
const addition="GOOGLE_OAUTH_CLIENT_SECRET_FILE='/run/secrets/drive/client.json'\\nGOOGLE_DRIVE_REFRESH_TOKEN_FILE='/run/secrets/drive/refresh-token.txt'\\nGOOGLE_DRIVE_ROOT_FOLDER_ID='"+b.rootFolderId+"'\\nGOOGLE_DRIVE_ROOT_FOLDER_NAME='"+b.rootFolderName+"'\\n";
const candidate=base+'/runtime.drive-20260909.env.candidate';const data=provider+addition;
const fd=fs.openSync(candidate,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
process.stdout.write(JSON.stringify({emailMatchesExpected:true,credentialFiles:2,credentialMode:256,credentialUid:1000,candidatePath:candidate,candidateSha256:crypto.createHash('sha256').update(data).digest('hex'),activeRuntimeUnchanged:true,driveWrites:0}));
`);
console.log(result);
