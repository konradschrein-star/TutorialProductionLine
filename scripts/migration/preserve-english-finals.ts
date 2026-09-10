import { createHash } from "node:crypto";
export const PRESERVATION_VERSION = "english-original-preservation/1";
export const EXPECTED_OWNER = "konrad.schrein@gmail.com";
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type PreservedFile = { jobId: string; path: string; sourceRevision: string; completedAt: string; bytes: number; sha256: string; md5: string; statToken: string };
export type PreservationManifest = { version: typeof PRESERVATION_VERSION; expectedOwner: string; folderId: string; createdAt: string; entries: PreservedFile[] };
export type Receipt = { jobId: string; stage: "intent" | "session" | "uploaded" | "verified" | "uncertain"; sessionUri?: string; fileId?: string; sha256?: string; bytes?: number };
export function exactFiveIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== 5 || value.some(id => typeof id !== "string" || !uuid.test(id)) || new Set(value).size !== 5) throw new Error("Five unique explicit tutorial UUIDs required");
  return [...value].sort();
}
export function parsePreservationManifest(value: unknown): PreservationManifest {
  const m = value as PreservationManifest;
  if (!m || m.version !== PRESERVATION_VERSION || m.expectedOwner !== EXPECTED_OWNER || !/^[\w-]{10,200}$/.test(m.folderId) || !Array.isArray(m.entries)) throw new Error("Invalid preservation manifest");
  exactFiveIds(m.entries.map(entry => entry.jobId));
  if (m.entries.some(e => !e.path?.startsWith("/opt/content-forge/media/tutorial/") || !/^[a-f0-9]{64}$/.test(e.sha256) || !/^[a-f0-9]{32}$/.test(e.md5) || !/^[a-f0-9]{64}$/.test(e.sourceRevision) || !Number.isSafeInteger(e.bytes) || e.bytes <= 0 || e.bytes > 8 * 1024 ** 3 || !e.statToken || !Number.isFinite(Date.parse(e.completedAt)))) throw new Error("Invalid exact file identity");
  if (new Set(m.entries.map(e => e.path)).size !== 5) throw new Error("Distinct original files required");
  return m;
}
export const sha256Text = (text: string) => createHash("sha256").update(text).digest("hex");
export function assertDriveOwner(about: any, folder: any, neededBytes: number) {
  if (about?.user?.emailAddress?.toLowerCase() !== EXPECTED_OWNER) throw new Error("Drive owner mismatch");
  if (folder?.trashed || folder?.mimeType !== "application/vnd.google-apps.folder" || folder?.ownedByMe !== true || folder?.capabilities?.canAddChildren !== true || folder?.driveId) throw new Error("An existing writable folder owned by the expected account is required");
  const quota = about.storageQuota;
  if (!quota || !/^\d+$/.test(quota.usage ?? "")) throw new Error("Drive capacity unknown");
  if (quota.limit !== undefined && (!/^\d+$/.test(quota.limit) || BigInt(quota.limit) - BigInt(quota.usage) < BigInt(neededBytes) + 100n * 1024n * 1024n)) throw new Error("Insufficient verified Drive headroom");
}
export function safeSessionUri(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com" || url.username || url.password || !url.pathname.startsWith("/upload/drive/v3/files")) throw new Error("Untrusted upload session");
  return value;
}
export interface PreservationPorts {
  recheck(file: PreservedFile, full: boolean): Promise<void>;
  find(file: PreservedFile): Promise<string | null>;
  start(file: PreservedFile): Promise<string>;
  offset(uri: string, bytes: number): Promise<number | "complete">;
  chunk(uri: string, file: PreservedFile, start: number, end: number): Promise<{ nextOffset: number } | { fileId: string }>;
  verify(fileId: string, file: PreservedFile): Promise<void>;
  append(receipt: Receipt): Promise<void>;
}
/** Sequential, bounded copy only. No deletes, publication, QA or database writes.
 * Intent is durable BEFORE a remote create. Ambiguous creation never blindly retries.
 */
export async function preserveOne(file: PreservedFile, history: Receipt[], ports: PreservationPorts) {
  await ports.recheck(file, true);
  const previous = history.filter(row => row.jobId === file.jobId);
  const completed = [...previous].reverse().find(row => row.stage === "verified" || row.stage === "uploaded");
  let fileId = completed?.fileId ?? await ports.find(file);
  if (!fileId) {
    let sessionUri = [...previous].reverse().find(row => row.stage === "session")?.sessionUri;
    if (!sessionUri && previous.length) throw new Error("Uncertain preservation attempt requires reconciliation");
    if (!sessionUri) {
      await ports.append({ jobId: file.jobId, stage: "intent" });
      sessionUri = safeSessionUri(await ports.start(file));
      await ports.append({ jobId: file.jobId, stage: "session", sessionUri });
    }
    sessionUri = safeSessionUri(sessionUri);
    let offset = await ports.offset(sessionUri, file.bytes);
    if (offset === "complete") {
      fileId = await ports.find(file);
      if (!fileId) throw new Error("Completed upload requires exact-object reconciliation");
    } else {
      let count = 0;
      while (offset < file.bytes) {
        if (!Number.isSafeInteger(offset) || offset < 0 || ++count > Math.ceil(file.bytes / (8 * 1024 ** 2)) + 5) throw new Error("Unexpected upload offset");
        await ports.recheck(file, false);
        const end = Math.min(offset + 8 * 1024 ** 2, file.bytes) - 1;
        const result = await ports.chunk(sessionUri, file, offset, end);
        if ("fileId" in result) { fileId = result.fileId; break; }
        if (result.nextOffset <= offset || result.nextOffset > end + 1) throw new Error("Unexpected acknowledged offset");
        offset = result.nextOffset;
      }
      if (!fileId) throw new Error("No completed Drive object returned");
    }
    await ports.append({ jobId: file.jobId, stage: "uploaded", fileId });
  }
  await ports.verify(fileId, file);
  await ports.recheck(file, true);
  await ports.append({ jobId: file.jobId, stage: "verified", fileId, sha256: file.sha256, bytes: file.bytes });
  return { verified: 1, bytes: file.bytes };
}
