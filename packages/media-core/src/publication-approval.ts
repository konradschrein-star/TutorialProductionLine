import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export interface PublicationIdentity {
  jobId: string; channelId: string; language: string; sourceRevision: string;
  title: string; description: string; tags: string[];
  videoPath: string; thumbnailId: string; thumbnailPath: string;
}
export interface ApprovedPublication {
  version: 1; revision: string; identity: PublicationIdentity;
  video: { sha256: string; size: number };
  thumbnail: { sha256: string; size: number };
}

async function fingerprint(path: string) {
  const before = await stat(path);
  if (!before.isFile() || before.size <= 0) throw new Error("Publication asset is missing or empty.");
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== after.ino) throw new Error("Publication asset changed while approval was being recorded. Retry review.");
  return { sha256: digest.digest("hex"), size: after.size };
}

/** Includes file bytes, not just a path which could be overwritten in place. */
export async function capturePublicationApproval(input: PublicationIdentity): Promise<ApprovedPublication> {
  // Explicit property order gives the same revision regardless of caller order.
  const identity: PublicationIdentity = {
    jobId: input.jobId, channelId: input.channelId, language: input.language,
    sourceRevision: input.sourceRevision, title: input.title,
    description: input.description, tags: [...input.tags], videoPath: input.videoPath,
    thumbnailId: input.thumbnailId, thumbnailPath: input.thumbnailPath,
  };
  const [video, thumbnail] = await Promise.all([fingerprint(identity.videoPath), fingerprint(identity.thumbnailPath)]);
  const revision = createHash("sha256").update(JSON.stringify({ identity, video, thumbnail })).digest("hex");
  return { version: 1, revision, identity, video, thumbnail };
}

export function publicationApprovalMatches(stored: unknown, current: ApprovedPublication): boolean {
  if (!stored || typeof stored !== "object") return false;
  const record = stored as Partial<ApprovedPublication>;
  return record.version === 1 && record.revision === current.revision;
}
