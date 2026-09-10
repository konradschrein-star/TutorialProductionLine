import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export interface ImmutableDriveRevision {
  driveFileId: string;
  sha256: string;
  sizeBytes: number;
  /** Original absolute database path; do not change approval identity on restore. */
  targetPath: string;
}

export interface MaterializerPorts {
  allowedRoots: readonly string[];
  maxBytes: number;
  streamFileContent(fileId: string, maxBytes: number): AsyncIterable<Uint8Array>;
  /** REQUIRED shared cross-process exclusive lease, held until work completes.
   * Every writer/evictor must honor this same canonical-path key. Implement with
   * a dedicated DB advisory-lock connection, not an expiring unrenewed TTL.
   * The callback includes consumption so active bytes remain protected.
   */
  withLease<T>(canonicalPath: string, work: () => Promise<T>): Promise<T>;
}

const pending = new Map<string, Promise<string>>();
const noFollow = constants.O_NOFOLLOW ?? 0;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export async function validateMediaTarget(target: string, allowedRoots: readonly string[]): Promise<string> {
  if (!isAbsolute(target) || target.split(/[\\/]/).some((part) => part === ".." || part.includes(":" ) && part !== parse(target).root.slice(0, 2))) throw new Error("Unsafe materialization target");
  const absolute = resolve(target);
  let admitted = false;
  for (const root of allowedRoots) {
    if (!isAbsolute(root)) continue;
    const canonicalRoot = await realpath(root);
    const comparable = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (comparable(canonicalRoot) !== comparable(resolve(root))) throw new Error("Allowed media root must not resolve through symlinks");
    const rel = relative(canonicalRoot, absolute);
    if (rel && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)) admitted = true;
  }
  if (!admitted) throw new Error("Materialization target outside allowed media roots");
  // Reject links at every existing component, including the configured root.
  // Directories must be service-owned: JS cannot provide openat2-style atomic
  // path resolution against a hostile actor changing ancestors concurrently.
  let current = parse(absolute).root;
  const parts = absolute.slice(current.length).split(sep);
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory()) || (i === parts.length - 1 && !info.isFile())) throw new Error("Materialization path contains a link or non-file target");
    } catch (error) {
      if (missing(error) && i === parts.length - 1) break;
      throw error;
    }
  }
  return absolute;
}

async function verifyExisting(path: string, revision: ImmutableDriveRevision): Promise<boolean> {
  let file;
  try { file = await open(path, constants.O_RDONLY | noFollow); }
  catch (error) { if (missing(error)) return false; throw error; }
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size !== revision.sizeBytes) throw new Error("Existing local revision differs; retained without overwrite");
    const hash = createHash("sha256");
    let count = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      count += chunk.length;
      if (count > revision.sizeBytes) throw new Error("Existing local revision changed");
      hash.update(chunk);
    }
    const after = await file.stat();
    if (count !== revision.sizeBytes || hash.digest("hex") !== revision.sha256.toLowerCase() || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size) throw new Error("Existing local revision differs; retained without overwrite");
    return true;
  } finally { await file.close(); }
}

async function materialize(revision: ImmutableDriveRevision, ports: MaterializerPorts, path: string): Promise<string> {
  await validateMediaTarget(path, ports.allowedRoots);
  if (await verifyExisting(path, revision)) return path;
  const temporary = join(dirname(path), `.drive-hydration-${randomUUID()}.partial`);
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
  try {
    let count = 0;
    const hash = createHash("sha256");
    for await (const chunk of ports.streamFileContent(revision.driveFileId, revision.sizeBytes)) {
      count += chunk.byteLength;
      if (count > revision.sizeBytes) throw new Error("Drive revision exceeded declared size");
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const result = await file.write(chunk, offset, chunk.byteLength - offset);
        if (!result.bytesWritten) throw new Error("Hydration write made no progress");
        offset += result.bytesWritten;
      }
    }
    if (count !== revision.sizeBytes || hash.digest("hex") !== revision.sha256.toLowerCase()) throw new Error("Drive revision size or SHA-256 verification failed");
    await file.sync();
    await file.close();
    await validateMediaTarget(path, ports.allowedRoots);
    try { await link(temporary, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A racing writer wins. Reuse only if it independently matches exactly.
      if (!await verifyExisting(path, revision)) throw new Error("Materialization target disappeared during commit");
    }
    return path;
  } finally {
    await file.close().catch(() => undefined);
    // Only our exclusive random partial is removed, never destination bytes.
    await unlink(temporary).catch((error) => { if (!missing(error)) throw error; });
  }
}

/** Consume verified bytes while retaining the required shared active-file lease.
 * Do not return a stream or HTTP Response/NextResponse from consume: response
 * construction precedes stream consumption. Await readable completion/cancel
 * inside the callback, or adapt the HTTP stream lifecycle to hold this lease.
 * Deliberately no eviction, directory creation, legacy lookup, or provider writes.
 */
export async function withMaterializedArtifact<T>(revision: ImmutableDriveRevision, ports: MaterializerPorts, consume: (path: string) => Promise<T>): Promise<T> {
  if (!revision.driveFileId || !/^[a-f0-9]{64}$/i.test(revision.sha256) || !Number.isSafeInteger(revision.sizeBytes) || revision.sizeBytes <= 0 || !Number.isSafeInteger(ports.maxBytes) || revision.sizeBytes > ports.maxBytes || typeof ports.withLease !== "function") throw new Error("Verified immutable revision and active-file lease are required");
  const path = await validateMediaTarget(revision.targetPath, ports.allowedRoots);
  return ports.withLease(path, async () => {
    const key = JSON.stringify([path, revision.driveFileId, revision.sha256.toLowerCase(), revision.sizeBytes]);
    let work = pending.get(key);
    if (!work) {
      work = materialize(revision, ports, path);
      pending.set(key, work);
      void work.finally(() => { if (pending.get(key) === work) pending.delete(key); }).catch(() => undefined);
    }
    return consume(await work);
  });
}
