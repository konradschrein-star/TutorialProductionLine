import { withTutorialMedia, withTutorialMediaSet, openLeasedMediaStream, type TutorialMediaRequest, type TutorialMediaTransaction } from "@repo/storage";
import { db } from "@/lib/db";
import { getHubConfig } from "@/lib/config";

function options(kind: TutorialMediaRequest["kind"]) {
  return { allowedRoots: [getHubConfig().LOCAL_MEDIA_ROOT], maxBytes: kind === "thumbnail" ? 32 * 1024 * 1024 : (kind === "raw_recording" ? 10 : 8) * 1024 * 1024 * 1024 };
}
/** Authorization belongs to the calling route before any archive lookup. */
export function withTutorialAsset<T>(request: TutorialMediaRequest, consume: (path: string) => Promise<T>) {
  return withTutorialMedia(db, request, options(request.kind), consume);
}
export function openTutorialAssetStream(request: TutorialMediaRequest, options: { range?: string | null; ifNoneMatch?: string | null } = {}) {
  return openLeasedMediaStream((consume) => withTutorialAsset(request, consume), options);
}
export function withPublicationMedia<T>(jobId: string, videoPath: string, thumbnailPath: string, consume: () => Promise<T>, transaction: TutorialMediaTransaction) {
  return withTutorialMediaSet(db, [{ jobId, kind: "final_video", path: videoPath }, { jobId, kind: "thumbnail", path: thumbnailPath }], { ...options("final_video"), transaction }, consume);
}
