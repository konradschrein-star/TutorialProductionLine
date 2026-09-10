/** Bundle as ESM. Source-host only; stdout contains aggregate counts, never paths/tokens. */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { constants, type Stats } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import { DriveClient } from "../../packages/storage/src/drive/client";
import { DriveTokenProvider } from "../../packages/storage/src/drive/auth";
import { loadStorageConfig } from "../../packages/storage/src/config";
import { validateMediaTarget } from "../../packages/storage/src/materializer";
import { protectedPath } from "./secure-selective-bundle";
import { assertDriveOwner, exactFiveIds, EXPECTED_OWNER, parsePreservationManifest, PRESERVATION_VERSION, preserveOne, sha256Text, type PreservedFile, type PreservationManifest, type Receipt } from "./preserve-english-finals";

const ROOT = "/opt/content-forge/media/tutorial";
const args = new Map<string, string>();
const permitted = new Set(["--allowlist", "--out", "--folder-id", "--manifest", "--sha256", "--receipts", "--confirm-count"]);
let execute = false;
function sourceRows(ids: string[]) {
  exactFiveIds(ids);
  const sql = `BEGIN READ ONLY; SELECT coalesce(json_agg(x),'[]') FROM (SELECT id,language,status,final_path,completed_at,recording_path,audio_path,recorded_at,md5(coalesce(script_text,'')) AS script_digest,to_jsonb(j)->>'source_job_id' AS source_id,to_jsonb(j)->>'parent_job_id' AS parent_id FROM tutorial_jobs j WHERE id IN (${ids.map(id => `'${id}'::uuid`).join(",")})) x; COMMIT;`;
  const rows = JSON.parse(execFileSync("docker", ["exec", "content-forge-postgres", "psql", "-U", "postgres", "-d", "content_forge", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", maxBuffer: 1024 * 1024 }));
  if (rows.length !== 5 || rows.some((row: any) => row.status !== "COMPLETED" || !["en", "english"].includes(String(row.language).toLowerCase()) || row.source_id || row.parent_id || !row.completed_at)) throw new Error("Allowlisted jobs are not five completed English originals");
  return rows as any[];
}
const rowRevision = (row: any) => sha256Text(JSON.stringify([row.id, row.status, row.final_path, row.completed_at, row.recording_path, row.audio_path, row.recorded_at, row.script_digest, row.source_id, row.parent_id]));
const tokenOf = (s: Stats) => JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs]);
async function statToken(path: string) {
  await validateMediaTarget(path, [ROOT]);
  for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0) throw new Error("Source ancestors must not be writable by group/others");
  }
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size <= 0 || s.size > 8 * 1024 ** 3) throw new Error("Unsafe or oversized source file");
  return tokenOf(s);
}
// Same stable-byte recipe as ArtifactStore, deliberately without importing its
// live database repositories into this no-database-write preservation command.
async function fingerprintStorageSource(path: string) {
  const before = await statToken(path), sha = createHash("sha256"), md5 = createHash("md5");
  let bytes = 0;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (tokenOf(await handle.stat()) !== before) throw new Error("Source replaced before hashing");
    for await (const chunk of handle.createReadStream({ autoClose: false })) { bytes += chunk.length; sha.update(chunk); md5.update(chunk); }
    if (tokenOf(await handle.stat()) !== before) throw new Error("Open source changed while hashing");
  } finally { await handle.close(); }
  if (before !== await statToken(path)) throw new Error("Source changed while hashing");
  return { bytes, sha256: sha.digest("hex"), md5: md5.digest("hex") };
}
async function readPrivate(path: string, limit: number) {
  const safe = await protectedPath(path, true);
  if ((await lstat(safe)).size > limit) throw new Error("Private input exceeds limit");
  return readFile(safe, "utf8");
}
const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => { if (!result.ok) throw new Error("Drive request failed; details withheld"); return result.value; };
async function main() {
  if (process.platform !== "linux") throw new Error("Run only on the protected source Linux host");
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i]!;
    if (key === "--execute-preservation") { if (execute) throw new Error("Duplicate execution flag"); execute = true; continue; }
    if (!permitted.has(key) || args.has(key) || !process.argv[i + 1] || process.argv[i + 1]!.startsWith("--")) throw new Error("Invalid arguments");
    args.set(key, process.argv[++i]!);
  }
  createRequire("/opt/content-forge/package.json")("dotenv").config({ path: "/opt/content-forge/.env", quiet: true });
  process.chdir("/opt/content-forge"); // Existing OAuth file paths may be relative to this installation.
  // A local override permits this isolated explicit command; no environment file
  // or global storage setting is changed and no production worker is started.
  const loaded = loadStorageConfig({ ...process.env, STORAGE_DRIVE_ENABLED: "true" });
  if (!loaded.enabled) throw new Error("Source Drive credentials unavailable");
  const timedFetch: typeof fetch = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(120000) });
  const drive = new DriveClient(loaded.drive, { fetch: timedFetch });
  const tokens = new DriveTokenProvider(loaded.drive.auth, { fetch: timedFetch });
  async function googleRead(url: string) {
    const token = unwrap(await tokens.getToken());
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("Drive identity/metadata unavailable");
    return response.json();
  }
  async function verifyDestination(folderId: string, bytes: number) {
    if (!/^[\w-]{10,200}$/.test(folderId)) throw new Error("Explicit destination folder ID required");
    const about = await googleRead("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota");
    const folder = await googleRead(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,mimeType,ownedByMe,trashed,driveId,capabilities(canAddChildren)&supportsAllDrives=true`);
    assertDriveOwner(about, folder, bytes);
  }
  if (!args.has("--manifest")) {
    if (execute || args.has("--receipts") || args.has("--sha256") || args.has("--confirm-count")) throw new Error("Execution requires an existing manifest");
    const ids = exactFiveIds(JSON.parse(await readPrivate(args.get("--allowlist") ?? "", 4096)));
    const rows = sourceRows(ids), entries: PreservedFile[] = [];
    for (const row of rows) {
      const path = await validateMediaTarget(row.final_path, [ROOT]);
      const token = await statToken(path), hash = await fingerprintStorageSource(path);
      if (token !== await statToken(path)) throw new Error("Source changed during preflight");
      entries.push({ jobId: row.id, path, sourceRevision: rowRevision(row), completedAt: new Date(row.completed_at).toISOString(), bytes: hash.bytes, sha256: hash.sha256, md5: hash.md5, statToken: token });
    }
    const after = sourceRows(ids);
    if (entries.some(entry => rowRevision(after.find(row => row.id === entry.jobId)) !== entry.sourceRevision)) throw new Error("Source rows changed during preflight");
    const manifest: PreservationManifest = { version: PRESERVATION_VERSION, expectedOwner: EXPECTED_OWNER, folderId: args.get("--folder-id") ?? "", createdAt: new Date().toISOString(), entries };
    parsePreservationManifest(manifest);
    const bytes = entries.reduce((n, entry) => n + entry.bytes, 0);
    await verifyDestination(manifest.folderId, bytes);
    const text = JSON.stringify(manifest);
    const handle = await open(await protectedPath(args.get("--out") ?? "", false), "wx", 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    console.log(JSON.stringify({ mode: "preflight", files: 5, bytes, manifestSha256: sha256Text(text), ownerVerified: true, driveWrites: 0, databaseWrites: 0, deleted: 0 }));
    return;
  }
  if (args.has("--allowlist") || args.has("--out") || args.has("--folder-id")) throw new Error("Manifest mode does not accept destination or selection overrides");
  const text = await readPrivate(args.get("--manifest")!, 128 * 1024), digest = sha256Text(text);
  if (digest !== args.get("--sha256")) throw new Error("Exact manifest SHA256 required");
  const manifest = parsePreservationManifest(JSON.parse(text)), ids = exactFiveIds(manifest.entries.map(e => e.jobId));
  const recheck = async (file: PreservedFile, full: boolean) => {
    if (await statToken(file.path) !== file.statToken) throw new Error("Source stat changed; new preflight required");
    if (full) {
      const hash = await fingerprintStorageSource(file.path);
      if (hash.sha256 !== file.sha256 || hash.md5 !== file.md5 || hash.bytes !== file.bytes || rowRevision(sourceRows(ids).find(row => row.id === file.jobId)) !== file.sourceRevision) throw new Error("Source revision changed");
    }
  };
  const bytes = manifest.entries.reduce((n, e) => n + e.bytes, 0);
  await verifyDestination(manifest.folderId, bytes);
  for (const entry of manifest.entries) await recheck(entry, true);
  if (!execute) { console.log(JSON.stringify({ mode: "verify-preflight", files: 5, bytes, ownerVerified: true, driveWrites: 0, databaseWrites: 0, deleted: 0 })); return; }
  if (args.get("--confirm-count") !== "5" || !args.has("--receipts")) throw new Error("Execution requires --confirm-count 5 and a protected receipt ledger");
  const ledgerPath = args.get("--receipts")!;
  let previousText = "";
  try { previousText = await readPrivate(ledgerPath, 2 * 1024 ** 2); } catch (error: any) { if (error.code !== "ENOENT") throw error; await protectedPath(ledgerPath, false); }
  if (previousText && !previousText.endsWith("\n")) throw new Error("Truncated ledger requires reconciliation");
  let sequence = 0, previousHash = "";
  const receipts: Receipt[] = [];
  for (const line of previousText.split("\n").filter(Boolean)) {
    const { hash, ...row } = JSON.parse(line);
    if (row.manifestSha256 !== digest || row.sequence !== ++sequence || row.previousHash !== previousHash || hash !== sha256Text(JSON.stringify(row)) || !ids.includes(row.jobId)) throw new Error("Receipt ledger identity/hash chain mismatch");
    previousHash = hash; receipts.push(row);
  }
  const lockPath = await protectedPath(`${ledgerPath}.lock`, false);
  const lock = await open(lockPath, "wx", 0o600);
  let ledger;
  try {
    // Another invocation may have finished between our initial read and lock.
    // Never append a stale sequence/hash chain to its newly written receipts.
    const lockedText = await readPrivate(ledgerPath, 2 * 1024 ** 2).catch((error: any) => { if (error.code === "ENOENT") return ""; throw error; });
    if (lockedText !== previousText) throw new Error("Receipt ledger changed; retry from fresh state");
    // O_NOFOLLOW and the protected directory prevent redirecting the receipt sink.
    ledger = await open(ledgerPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    const append = async (receipt: Receipt) => {
      const row = { ...receipt, manifestSha256: digest, sequence: ++sequence, at: new Date().toISOString(), previousHash };
      const hash = sha256Text(JSON.stringify(row));
      await ledger!.writeFile(JSON.stringify({ ...row, hash }) + "\n"); await ledger!.sync(); previousHash = hash; receipts.push(receipt);
    };
    let verified = 0, verifiedBytes = 0, uncertain = 0;
    for (const entry of manifest.entries) {
      try {
        await preserveOne(entry, receipts, {
          recheck,
          find: async file => unwrap(await drive.findExistingArtifact(file.jobId, "final_video", file.sha256))?.id ?? null,
          start: async file => unwrap(await drive.createResumableSession({ filename: `english-${file.jobId}.mp4`, parentId: manifest.folderId, mimeType: "video/mp4", sizeBytes: file.bytes, jobId: file.jobId, kind: "final_video", sourceSha256: file.sha256 })),
          offset: async (uri, total) => unwrap(await drive.queryResumableOffset(uri, total)),
          chunk: async (uri, file, start, end) => {
            const source = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
              if (tokenOf(await source.stat()) !== file.statToken) throw new Error("Source replaced before chunk open");
              // Pin the inspected inode; the Drive client opens a duplicate of
              // this descriptor, never a newly swapped source pathname.
              const result = unwrap(await drive.uploadChunk({ sessionUri: uri, localPath: `/proc/self/fd/${source.fd}`, start, end, totalBytes: file.bytes }));
              if (tokenOf(await source.stat()) !== file.statToken) throw new Error("Source changed during chunk");
              return result.done ? { fileId: result.file.id } : { nextOffset: result.nextOffset };
            } finally { await source.close(); }
          },
          verify: async (fileId, file) => {
            if (!/^[\w-]{10,200}$/.test(fileId)) throw new Error("Invalid exact Drive ID");
            const meta = unwrap(await drive.getFile(fileId));
            if (meta.trashed || Number(meta.size) !== file.bytes || (meta.md5Checksum && meta.md5Checksum !== file.md5)) throw new Error("Remote metadata mismatch");
            const content = unwrap(await drive.inspectFileContent(fileId, file.bytes));
            if (content.sizeBytes !== file.bytes || content.sha256 !== file.sha256) throw new Error("Remote bytes mismatch");
          },
          append,
        });
        verified++; verifiedBytes += entry.bytes;
      } catch { uncertain++; await append({ jobId: entry.jobId, stage: "uncertain" }); }
      console.log(JSON.stringify({ mode: "preservation", attempted: verified + uncertain, verified, verifiedBytes, uncertain, databaseWrites: 0, deleted: 0 }));
    }
    if (uncertain) process.exitCode = 2;
  } finally { await ledger?.close(); await lock.close(); await unlink(lockPath); }
}
main().catch(() => { console.error(JSON.stringify({ result: "stopped", detailsWithheld: true, deleted: 0 })); process.exitCode = 1; });
