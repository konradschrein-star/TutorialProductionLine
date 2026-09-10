/** Explicit source->VPS2 configuration candidate. Never activates services. */
import { createHash } from "node:crypto";
import { privateSsh } from "./private-ssh";
import { mergeProviderRuntime, parseRuntimeEnv, renderRuntimeEnv, selectProviderRuntime } from "./provider-runtime-transfer";
if (process.argv[2] !== "--prepare") throw Error("Explicit --prepare required");
const selected = JSON.parse(await privateSsh("cf-vps-deploy", `
import fs from 'node:fs';import dotenv from 'dotenv';const env=dotenv.parse(fs.readFileSync('/opt/content-forge/.env'));
if(!env.VEOFORGE_API_KEY||!env.VEOFORGE_API_URL)throw Error('VeoForge source configuration absent');
process.stdout.write(JSON.stringify({VEOFORGE_API_KEY:env.VEOFORGE_API_KEY,VEOFORGE_API_URL:env.VEOFORGE_API_URL,THUMBNAIL_BACKEND:'veoforge',VEOFORGE_IMAGES_ENABLED:'0',VEOFORGE_MAX_CONCURRENT:'2',THUMBNAIL_VISUAL_QA_ENABLED:'1'}));
`, true));
const basePath = "/opt/tutorial-recovery-staging/runtime.drive-20260909.env.candidate";
const base = await privateSsh("vps2", `
import fs from 'node:fs';const p=${JSON.stringify(basePath)};const s=fs.lstatSync(p);
if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||(s.mode&0o077)||s.size>131072)throw Error('Unsafe candidate');
process.stdout.write(fs.readFileSync(p,'utf8'));
`);
const originalSha = createHash("sha256").update(base).digest("hex");
if (originalSha !== "20685b13897c086627407ee560be155fff1060fd90213e4b842d3985c265b74a") throw Error("Drive candidate changed; review required");
const bundle = selectProviderRuntime(selected, Object.keys(selected), "content_forge_vps1");
const data = renderRuntimeEnv(mergeProviderRuntime(parseRuntimeEnv(base), bundle, { VEOFORGE_API_URL: "https://veoforge.schreinercontentsystems.com" }));
const path = "/opt/tutorial-recovery-staging/runtime.ai-20260909.env.candidate";
const sha = createHash("sha256").update(data).digest("hex");
console.log(await privateSsh("vps2", `
import fs from 'node:fs';import crypto from 'node:crypto';
const dir=fs.lstatSync('/opt/tutorial-recovery-staging');if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==0||(dir.mode&0o077))throw Error('Unsafe directory');
if(crypto.createHash('sha256').update(fs.readFileSync(${JSON.stringify(basePath)})).digest('hex')!==${JSON.stringify(originalSha)})throw Error('Base changed');
const fd=fs.openSync(${JSON.stringify(path)},fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
try{fs.writeFileSync(fd,${JSON.stringify(data)});fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
process.stdout.write(JSON.stringify({candidatePath:${JSON.stringify(path)},sha256:${JSON.stringify(sha)},veoImagesEnabled:false,activeRuntimeUnchanged:true,providerCalls:0}));
`));
