import { spawn } from "node:child_process";
/** Fixed migration peers; bounded pipes, no secret-bearing stderr/log output. */
export async function privateSsh(host: "cf-vps-deploy" | "vps2", code: string, source = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=yes",
      host, `${source ? "cd /opt/content-forge && " : ""}node --input-type=module`], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = []; let bytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(Error("Private SSH operation timed out")); }, 60000);
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 128 * 1024) { child.kill(); reject(Error("Private SSH response exceeded limit")); }
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); reject(Error("Private SSH could not start")); });
    child.on("close", code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(Error(`Private SSH failed (${code})`)); });
    child.stdin.end(code);
  });
}
