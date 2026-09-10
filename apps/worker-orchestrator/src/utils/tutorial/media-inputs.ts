import { createDrizzleClient, type DrizzleClient } from "@repo/db";
import { withTutorialMediaSet, type TutorialMediaRequest, type TutorialMediaTransaction } from "@repo/storage";

let mediaDb: DrizzleClient | undefined;
/** Separate bounded pool: media leases can span provider/FFmpeg work without
 * occupying the ordinary job pool or delaying its stage/status commits.
 */
function getMediaDatabase() {
  if (!mediaDb) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL is required for tutorial media leases");
    mediaDb = createDrizzleClient(url, { max: 2 });
  }
  return mediaDb;
}

export function withTutorialPublicationInputs<T>(input: { jobId: string; videoPath: string; thumbnailPath: string; video?: {sha256:string;size:number}; thumbnail?: {sha256:string;size:number} }, consume: () => Promise<T>, dependencies: { db?: DrizzleClient; transaction?: TutorialMediaTransaction; mediaRoot?: string } = {}) {
  const requests: TutorialMediaRequest[] = [
    { jobId: input.jobId, kind: "final_video", path: input.videoPath, ...(input.video ? {expectedContent:input.video} : {}) },
    { jobId: input.jobId, kind: "thumbnail", path: input.thumbnailPath, ...(input.thumbnail ? {expectedContent:input.thumbnail} : {}) },
  ];
  // Existing publication transactions already pin a connection; never obtain
  // another pool slot just to acquire these sorted media locks.
  return withTutorialMediaSet(dependencies.db ?? (dependencies.transaction as unknown as DrizzleClient | undefined) ?? getMediaDatabase(), requests, {
    allowedRoots: [dependencies.mediaRoot ?? process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media"], maxBytes: 8 * 1024 ** 3,
    ...(dependencies.transaction ? {transaction:dependencies.transaction} : {}),
  }, consume);
}

export async function withTutorialWorkerInputs<T>(input: {
  jobId: string;
  sourceJobId?: string | null;
  recordingPath: string;
  audioPath?: string;
}, consume: () => Promise<T>, dependencies: { db?: DrizzleClient; mediaRoot?: string } = {}): Promise<T> {
  const requests: TutorialMediaRequest[] = [{ jobId: input.sourceJobId ?? input.jobId, kind: "raw_recording", path: input.recordingPath }];
  // Narration has no durable artifact kind yet. Validate/lease the exact local
  // input; never pretend that raw_recording or another Drive object is narration.
  if (input.audioPath) requests.push({ jobId: input.jobId, kind: null, path: input.audioPath });
  return withTutorialMediaSet(dependencies.db ?? getMediaDatabase(), requests, {
    allowedRoots: [dependencies.mediaRoot ?? process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media"],
    maxBytes: 8 * 1024 ** 3,
  }, consume);
}
