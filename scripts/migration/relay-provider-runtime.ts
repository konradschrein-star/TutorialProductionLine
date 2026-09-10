/** Prepare, never activate, an owner-only VPS2 provider env candidate.
 * Secrets travel through SSH pipes and process memory, never PC files/logs.
 * Fixed source/target: this is not a general credential export utility. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  PROVIDER_CREDENTIAL_NAMES, PROVIDER_SETTING_NAMES, PROVIDER_ENDPOINT_NAMES,
  selectProviderRuntime, mergeProviderRuntime, parseRuntimeEnv, renderRuntimeEnv,
} from "./provider-runtime-transfer";

const mode = process.argv[2];
if (!["--audit", "--prepare"].includes(mode ?? "")) throw Error("Choose --audit or --prepare");
const names = [...PROVIDER_CREDENTIAL_NAMES, ...PROVIDER_SETTING_NAMES, ...PROVIDER_ENDPOINT_NAMES];
const candidate = "/opt/tutorial-recovery-staging/runtime.providers-20260909.env.candidate";
async function ssh(host: "cf-vps-deploy" | "vps2", code: string, source = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=yes",
      host, `${source ? "cd /opt/content-forge && " : ""}node --input-type=module`], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = []; let bytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(Error("Private SSH operation timed out")); }, 30000);
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 128 * 1024) { child.kill(); reject(Error("Private SSH response exceeded limit")); }
      else chunks.push(chunk);
    });
    // Never expose a remote parser error that might contain a secret value.
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); reject(Error("Private SSH could not start")); });
    child.on("close", code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(Error(`Private SSH failed (${code})`)); });
    child.stdin.end(code);
  });
}
const selected = JSON.parse(await ssh("cf-vps-deploy", `
import fs from 'node:fs'; import dotenv from 'dotenv';
const path='/opt/content-forge/.env'; const info=fs.lstatSync(path);
if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe source');
const env=dotenv.parse(fs.readFileSync(path)); const values={};
for(const name of ${JSON.stringify(names)})if(typeof env[name]==='string'&&env[name].length)values[name]=env[name];
process.stdout.write(JSON.stringify(values));
`, true)) as Record<string, string>;
const endpointMap: Record<string, string> = {};
if (selected.CLAUDE_POOL_URL) endpointMap.CLAUDE_POOL_URL = "https://hub.schreinercontentsystems.com/claude";
if (selected.GEMINI_POOL_URL) endpointMap.GEMINI_POOL_URL = "https://hub.schreinercontentsystems.com/gemini";
// Preserve credentials, but do not install unusable source-local endpoints.
// These are reported explicitly and remain a separate activation gate.
const omittedEndpointNames: string[] = [];
for (const name of PROVIDER_ENDPOINT_NAMES) {
  if (!selected[name] || endpointMap[name]) continue;
  const host = new URL(selected[name]).hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.startsWith("127.") || host === "[::1]" || host === "0.0.0.0") {
    omittedEndpointNames.push(name); delete selected[name];
  }
}
const bundle = selectProviderRuntime(selected, Object.keys(selected), "content_forge_vps1");
const existing = await ssh("vps2", `
import fs from 'node:fs';
const directory='/opt/tutorial-recovery-staging'; const path=directory+'/runtime.env';
const dir=fs.lstatSync(directory),info=fs.lstatSync(path);
if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)||dir.uid!==process.getuid())throw Error('Unsafe directory');
if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)||info.uid!==process.getuid()||info.nlink!==1||info.size>131072)throw Error('Unsafe runtime');
process.stdout.write(fs.readFileSync(path,'utf8'));
`);
const merged = renderRuntimeEnv(mergeProviderRuntime(parseRuntimeEnv(existing), bundle, endpointMap));
const checksum = createHash("sha256").update(merged).digest("hex");
if (mode === "--prepare") {
  const receipt = JSON.parse(await ssh("vps2", `
import fs from 'node:fs'; import crypto from 'node:crypto';
const directory='/opt/tutorial-recovery-staging'; const dir=fs.lstatSync(directory);
if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)||dir.uid!==process.getuid())throw Error('Unsafe directory');
const original=fs.readFileSync(directory+'/runtime.env','utf8');
if(crypto.createHash('sha256').update(original).digest('hex')!==${JSON.stringify(createHash("sha256").update(existing).digest("hex"))})throw Error('Runtime changed');
const path=${JSON.stringify(candidate)},data=${JSON.stringify(merged)};
const fd=fs.openSync(path,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
const info=fs.lstatSync(path),sha=crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
if(sha!==${JSON.stringify(checksum)}||(info.mode&0o077)||info.uid!==process.getuid())throw Error('Candidate verification failed');
process.stdout.write(JSON.stringify({path,sha256:sha,bytes:info.size,mode:info.mode&0o777}));
`));
  console.log(JSON.stringify({ mode, ...receipt, selectedNames: Object.keys(selected), omittedEndpointNames, activeRuntimeUnchanged: true, sourceUnchanged: true, providerCalls: 0 }));
} else console.log(JSON.stringify({ mode, selectedNames: Object.keys(selected), mappedEndpointNames: Object.keys(endpointMap), omittedEndpointNames, candidateSha256: checksum, writes: 0, providerCalls: 0 }));
