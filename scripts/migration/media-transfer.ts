/** Private server-to-server protocol. Never log paths, headers or child stderr. */
import { createHash, randomUUID } from "node:crypto";
import {
  open,
  lstat,
  realpath,
  mkdir,
  link,
  unlink,
  statfs,
} from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, relative, isAbsolute, dirname, sep, parse } from "node:path";
import { once } from "node:events";
import type { Readable, Writable } from "node:stream";
import { inspectMediaFile } from "./private-media-manifest";

export const SOURCE_ROOT = "/opt/content-forge/media";
export const DESTINATION_ROOT = "/opt/tutorial-recovery-staging/media";
type Entry = { path: string; bytes: number; sha256: string };
export function selectTransferEntries(
  manifest: any,
  root = SOURCE_ROOT,
): Entry[] {
  if (
    ![
      "tutorial-private-media-manifest/2",
      "tutorial-private-media-manifest/3",
    ].includes(manifest.version)
  )
    throw new Error("Manifest version rejected.");
  const seen = new Set<string>();
  return manifest.files
    .filter((row: any) => row.state === "local_verified")
    .map((row: any) => {
      safeRelative(root, row.path);
      if (
        !Number.isSafeInteger(row.bytes) ||
        row.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(row.sha256) ||
        seen.has(row.path)
      )
        throw new Error("Invalid manifest entry.");
      seen.add(row.path);
      return { path: row.path, bytes: row.bytes, sha256: row.sha256 };
    });
}
function safeRelative(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("Path outside permitted root.");
  return rel;
}
async function noSymlinks(path: string) {
  let cursor = parse(resolve(path)).root;
  for (const part of resolve(path)
    .slice(cursor.length)
    .split(sep)
    .filter(Boolean)) {
    cursor = resolve(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink())
      throw new Error("Symlink rejected.");
  }
  if ((await realpath(path)) !== resolve(path))
    throw new Error("Noncanonical path rejected.");
}
async function write(stream: Writable, bytes: Buffer) {
  if (!stream.write(bytes)) await once(stream, "drain");
}
async function frame(stream: Writable, value: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length);
  await write(stream, length);
  await write(stream, value);
}
async function json(stream: Writable, value: unknown) {
  await frame(stream, Buffer.from(JSON.stringify(value)));
}
class Frames {
  private buffer = Buffer.alloc(0);
  private iterator: AsyncIterator<any>;
  constructor(input: Readable) {
    this.iterator = input[Symbol.asyncIterator]();
  }
  private async bytes(size: number) {
    while (this.buffer.length < size) {
      const next = await this.iterator.next();
      if (next.done) throw new Error("Truncated transfer.");
      this.buffer = Buffer.concat([this.buffer, Buffer.from(next.value)]);
    }
    const result = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return result;
  }
  async read() {
    const size = (await this.bytes(4)).readUInt32BE();
    if (size > 1024 * 1024) throw new Error("Oversized frame.");
    return this.bytes(size);
  }
  async json() {
    const bytes = await this.read();
    if (bytes.length > 16384) throw new Error("Oversized header.");
    return JSON.parse(bytes.toString());
  }
}
export async function sendMedia(
  entries: Entry[],
  output: Writable,
  root = SOURCE_ROOT,
) {
  await json(output, {
    version: 1,
    files: entries.length,
    totalBytes: entries.reduce((n, row) => n + row.bytes, 0),
  });
  const counts = { sent: 0, skippedChanged: 0 };
  for (const row of entries) {
    const rel = safeRelative(root, row.path);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await noSymlinks(row.path);
      handle = await open(
        row.path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size !== row.bytes) {
        await handle.close();
        handle = undefined;
        counts.skippedChanged++;
        continue;
      }
      await json(output, {
        type: "file",
        relativePath: rel,
        bytes: row.bytes,
        sha256: row.sha256,
      });
      const hash = createHash("sha256");
      let size = 0;
      let readable = true;
      try {
        if (row.bytes)
          for await (const chunk of handle.createReadStream({
            autoClose: false,
            highWaterMark: 256 * 1024,
            end: row.bytes - 1,
          })) {
            size += chunk.length;
            hash.update(chunk);
            await frame(output, chunk);
          }
      } catch {
        readable = false;
      }
      await frame(output, Buffer.alloc(0));
      let stable = false;
      try {
        const after = await handle.stat();
        const current = await lstat(row.path);
        stable =
          readable &&
          size === row.bytes &&
          hash.digest("hex") === row.sha256 &&
          before.ino === current.ino &&
          before.dev === current.dev &&
          !current.isSymbolicLink() &&
          before.size === after.size &&
          before.mtimeMs === after.mtimeMs &&
          before.ctimeMs === after.ctimeMs &&
          (await realpath(row.path)) === resolve(row.path);
      } catch {
        stable = false;
      }
      await json(output, { stable });
      if (stable) counts.sent++;
      else counts.skippedChanged++;
    } catch {
      if (handle)
        throw new Error(
          "Source stream interrupted; receiver must discard partial file.",
        );
      counts.skippedChanged++;
    } finally {
      if (handle) await handle.close();
    }
  }
  await json(output, { type: "end" });
  return counts;
}
export async function receiveMedia(
  input: Readable,
  root = DESTINATION_ROOT,
  headroomBytes = 10 * 1024 ** 3,
) {
  await noSymlinks(root);
  const rootInfo = await lstat(root);
  if (
    !rootInfo.isDirectory() ||
    (process.platform !== "win32" &&
      ((rootInfo.mode & 0o022) !== 0 || rootInfo.uid !== process.getuid?.()))
  )
    throw new Error(
      "Destination must be owned by receiver and not group/world writable.",
    );
  const reader = new Frames(input);
  const preflight = await reader.json();
  if (
    preflight.version !== 1 ||
    !Number.isSafeInteger(preflight.totalBytes) ||
    preflight.totalBytes < 0 ||
    !Number.isSafeInteger(preflight.files) ||
    preflight.files < 0
  )
    throw new Error("Invalid transfer preflight.");
  const space = await statfs(root);
  if (
    Number(space.bavail) * Number(space.bsize) <
    preflight.totalBytes + headroomBytes
  )
    throw new Error("Insufficient free space and headroom.");
  const counts = {
    copied: 0,
    alreadyIdentical: 0,
    existingMismatch: 0,
    sourceChanged: 0,
    bytesCopied: 0,
  };
  let receivedFiles = 0;
  let receivedBytes = 0;
  while (true) {
    const header = await reader.json();
    if (header.type === "end") break;
    if (
      header.type !== "file" ||
      typeof header.relativePath !== "string" ||
      isAbsolute(header.relativePath) ||
      !Number.isSafeInteger(header.bytes) ||
      header.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(header.sha256)
    )
      throw new Error("Invalid file header.");
    if (
      ++receivedFiles > preflight.files ||
      (receivedBytes += header.bytes) > preflight.totalBytes
    )
      throw new Error("Transfer exceeds preflight.");
    const destination = resolve(root, header.relativePath);
    safeRelative(root, destination);
    let cursor = resolve(root);
    for (const part of relative(root, dirname(destination))
      .split(sep)
      .filter(Boolean)) {
      cursor = resolve(cursor, part);
      try {
        await mkdir(cursor, { mode: 0o700 });
      } catch (error: any) {
        if (error.code !== "EEXIST") throw error;
      }
      await noSymlinks(cursor);
    }
    await noSymlinks(dirname(destination));
    const temp = resolve(
      dirname(destination),
      `.migration-${randomUUID()}.partial`,
    );
    const file = await open(temp, "wx", 0o600);
    let committed = false;
    try {
      const hash = createHash("sha256");
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (!chunk.length) break;
        size += chunk.length;
        if (size > header.bytes)
          throw new Error("Source exceeded declared size.");
        hash.update(chunk);
        await file.writeFile(chunk);
      }
      const trailer = await reader.json();
      await file.sync();
      await file.close();
      if (
        !trailer.stable ||
        size !== header.bytes ||
        hash.digest("hex") !== header.sha256
      ) {
        counts.sourceChanged++;
        continue;
      }
      await noSymlinks(dirname(destination));
      try {
        await link(temp, destination);
        committed = true;
        counts.copied++;
        counts.bytesCopied += size;
      } catch (error: any) {
        if (error.code !== "EEXIST") throw error;
        const existing = await inspectMediaFile(destination, [root]);
        if (
          existing.state === "local_verified" &&
          existing.sha256 === header.sha256 &&
          existing.bytes === header.bytes
        )
          counts.alreadyIdentical++;
        else counts.existingMismatch++;
      }
    } finally {
      await file.close().catch(() => {});
      await unlink(temp).catch(() => {});
      if (committed && process.platform !== "win32") {
        const dir = await open(dirname(destination), "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
    }
  }
  return counts;
}
