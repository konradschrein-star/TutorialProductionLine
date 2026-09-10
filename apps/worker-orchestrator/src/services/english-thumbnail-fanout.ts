import { createHash, randomUUID } from "node:crypto";
import { tutorialAiThumbnailsEnabled } from "../utils/tutorial/ai-thumbnail-policy.js";
import { readFile } from "node:fs/promises";
import { and, asc, eq, lt, or, inArray } from "drizzle-orm";
import { tutorialJobs, thumbnails, channels, tutorialSettings, tutorialThumbnailFanout, tutorialUploadDispatches, englishThumbnailApprovalRevision, type DrizzleClient } from "@repo/db";
import { withTutorialMedia } from "@repo/storage";
import { requestThumbnail, type RequestThumbnailResult } from "../utils/thumbnail/index.js";

type Intent = typeof tutorialThumbnailFanout.$inferSelect;
type Source = typeof tutorialJobs.$inferSelect;
type Image = typeof thumbnails.$inferSelect;
class SupersededEnglishSource extends Error {}
export function assertEnglishThumbnailSource(intent: Intent, source: Source | undefined, selected: Image[]) {
  const image = selected[0];
  if (!source || source.source_job_id || source.language !== "en" || !source.channel_id || source.status === "CANCELLED" || source.va_review_status === "rework_requested" ||
    selected.length !== 1 || !image || image.id !== intent.source_thumbnail_id || image.output_path !== intent.source_path || image.status !== "completed" || image.channel_id !== source.channel_id || !["acceptable", "strong"].includes(image.review_verdict)) {
    throw new SupersededEnglishSource("Approved English thumbnail changed; old localization request superseded");
  }
  const revision = englishThumbnailApprovalRevision({ sourceJobId: source.id, thumbnailId: image.id, sourcePath: intent.source_path, sha256: intent.source_sha256, size: intent.source_size }, source.channel_id);
  if (revision !== intent.approval_revision) throw new SupersededEnglishSource("English approval identity changed");
}

/** Only in-memory bytes leave the leased read. The gateway cannot reread a new file. */
export function approvedReferenceDataUrl(bytes: Buffer, expected: { sha256: string; size: number }) {
  if (bytes.length !== expected.size || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) throw new Error("English thumbnail bytes changed after approval");
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" : bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP" ? "image/webp" : null;
  if (!mime) throw new Error("Approved reference must be a PNG, JPEG or WebP image");
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export interface FanoutPorts {
  claim(): Promise<Intent | null>;
  reference(intent: Intent): Promise<{ dataUrl: string; child: Source } | null>;
  generate(intent: Intent, reference: { dataUrl: string; child: Source }): Promise<RequestThumbnailResult>;
  finish(intent: Intent, result: RequestThumbnailResult): Promise<void>;
  fail(intent: Intent, message: string, state?: "failed" | "uncertain" | "superseded"): Promise<void>;
}
/** One locale failing never cancels or approves another locale. */
export async function runEnglishThumbnailFanout(ports: FanoutPorts) {
  if (!tutorialAiThumbnailsEnabled()) return false;
  const intent = await ports.claim();
  if (!intent) return false;
  try {
    const reference = await ports.reference(intent);
    if (!reference) return true;
    const result = await ports.generate(intent, reference);
    if (result.status !== "completed" || !result.thumbnailId) {
      await ports.fail(intent, "Localized image generation did not complete; review this locale before retrying", result.failureCertainty === "definite" ? "failed" : "uncertain");
      return true;
    }
    await ports.finish(intent, result);
  } catch (error) { await ports.fail(intent, error instanceof Error ? error.message : "Localization could not be verified", error instanceof SupersededEnglishSource ? "superseded" : "uncertain"); }
  return true;
}

export function englishThumbnailFanoutPorts(db: DrizzleClient): FanoutPorts {
  const selectedFor = async (tx: Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0], sourceId: string) => tx.select().from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), eq(thumbnails.subject_id, sourceId), eq(thumbnails.language, "en"), eq(thumbnails.is_selected, true)));
  return {
    claim: () => db.transaction(async (tx) => {
      const [settings] = await tx.select().from(tutorialSettings).where(eq(tutorialSettings.id, 1));
      if (settings?.thumbnail_generation_mode !== "ai") return null;
      // A crashed in-flight provider call is uncertain, not permission to pay again.
      await tx.update(tutorialThumbnailFanout).set({ state: "uncertain", lease_token: null, lease_until: null, last_error: "Worker acknowledgement was lost. Inspect any generated candidate before explicit retry.", updated_at: new Date() }).where(and(eq(tutorialThumbnailFanout.state, "running"), lt(tutorialThumbnailFanout.lease_until, new Date())));
      const [row] = await tx.select().from(tutorialThumbnailFanout).where(eq(tutorialThumbnailFanout.state, "pending")).orderBy(asc(tutorialThumbnailFanout.updated_at)).limit(1).for("update", { skipLocked: true });
      if (!row) return null;
      const token = randomUUID();
      const [claimed] = await tx.update(tutorialThumbnailFanout).set({ state: "running", lease_token: token, lease_until: new Date(Date.now() + 30 * 60_000), attempts: row.attempts + 1, updated_at: new Date() }).where(eq(tutorialThumbnailFanout.id, row.id)).returning();
      return claimed ?? null;
    }),
    reference: (intent) => db.transaction(async (tx) => {
      // Same order as approval: source row, then media advisory lease. The
      // immutable data URI is captured before either lock is released.
      const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, intent.source_job_id)).limit(1).for("update");
      assertEnglishThumbnailSource(intent, source, await selectedFor(tx, intent.source_job_id));
      const [settings] = await tx.select().from(tutorialSettings).where(eq(tutorialSettings.id, 1)).for("share");
      const family = await tx.select().from(tutorialJobs).where(or(eq(tutorialJobs.id, intent.source_job_id), eq(tutorialJobs.source_job_id, intent.source_job_id)));
      const dispatch = await tx.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches).where(inArray(tutorialUploadDispatches.tutorial_job_id, family.map(row => row.id))).limit(1);
      if (settings?.thumbnail_generation_mode !== "ai" || dispatch.length || family.some(row => row.is_uploaded || row.uploader_status)) throw new SupersededEnglishSource("AI mode or delivery authorization changed");
      const children = await tx.select().from(tutorialJobs).where(and(eq(tutorialJobs.source_job_id, intent.source_job_id), eq(tutorialJobs.language, intent.target_language)));
      if (children.length !== 1 || !children[0]!.channel_id) {
        await tx.update(tutorialThumbnailFanout).set({ state: "pending", lease_token: null, lease_until: null, last_error: "Prepare exactly one assigned language draft before localization", updated_at: new Date() }).where(and(eq(tutorialThumbnailFanout.id, intent.id), eq(tutorialThumbnailFanout.lease_token, intent.lease_token!)));
        return null;
      }
      const child = children[0]!;
      if (child.channel_id !== intent.target_channel_id || child.created_by !== source!.created_by) throw new Error("Language destination or producer changed after English approval");
      if (child.status === "CANCELLED") throw new Error("Language draft cancelled; restore it before retrying");
      const [channel] = await tx.select().from(channels).where(eq(channels.id, child.channel_id!)).limit(1);
      if (!channel || channel.language !== intent.target_language) throw new Error("Assigned language channel does not match this locale");
      const dataUrl = await withTutorialMedia(db, { jobId: source!.id, kind: "thumbnail", path: intent.source_path, expectedContent: { sha256: intent.source_sha256, size: intent.source_size } },
        { allowedRoots: [process.env.LOCAL_MEDIA_ROOT ?? "/opt/content-forge/media"], maxBytes: 32 * 1024 ** 2, transaction: tx },
        async (path) => approvedReferenceDataUrl(await readFile(path), { sha256: intent.source_sha256, size: intent.source_size }));
      return { dataUrl, child };
    }),
    generate: async (intent, { dataUrl, child }) => {
      await db.transaction(async tx => {
      const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, intent.source_job_id)).limit(1).for("update");
      assertEnglishThumbnailSource(intent, source, await selectedFor(tx, intent.source_job_id));
      const [settings] = await tx.select().from(tutorialSettings).where(eq(tutorialSettings.id, 1)).for("share");
      const family = await tx.select().from(tutorialJobs).where(or(eq(tutorialJobs.id, intent.source_job_id), eq(tutorialJobs.source_job_id, intent.source_job_id)));
      const dispatch = await tx.select({ id: tutorialUploadDispatches.id }).from(tutorialUploadDispatches).where(inArray(tutorialUploadDispatches.tutorial_job_id, family.map(row => row.id))).limit(1);
      const currentChild = family.find(row => row.id === child.id);
      if (settings?.thumbnail_generation_mode !== "ai" || dispatch.length || family.some(row => row.is_uploaded || row.uploader_status) || !currentChild || currentChild.status === "CANCELLED" || currentChild.channel_id !== intent.target_channel_id || currentChild.created_by !== source!.created_by) throw new SupersededEnglishSource("Generation admission changed after reference capture");
      });
      return requestThumbnail(db, {
      subjectKind: "tutorial_job", subjectId: child.id, channelId: child.channel_id, title: child.title,
      format: "TUTORIAL_STUDIO", language: intent.target_language, targetLanguage: intent.target_language,
      generationKind: "localize", localizeFromThumbnailId: intent.source_thumbnail_id, parentThumbnailId: intent.source_thumbnail_id,
      requestGroupId: intent.generation_request_id ?? intent.id, variantIndex: 0, approvedEnglishReference: { thumbnailId: intent.source_thumbnail_id, path: intent.source_path, dataUrl },
      onFallback: "fail",
      });
    },
    finish: (intent, result) => db.transaction(async (tx) => {
      const [source] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, intent.source_job_id)).limit(1).for("update");
      assertEnglishThumbnailSource(intent, source, await selectedFor(tx, intent.source_job_id));
      await withTutorialMedia(db, { jobId: source!.id, kind: "thumbnail", path: intent.source_path, expectedContent: { sha256: intent.source_sha256, size: intent.source_size } },
        { allowedRoots: [process.env.LOCAL_MEDIA_ROOT ?? "/opt/content-forge/media"], maxBytes: 32 * 1024 ** 2, transaction: tx }, async () => undefined);
      const [image] = await tx.select().from(thumbnails).where(eq(thumbnails.id, result.thumbnailId)).limit(1);
      if (!image || image.channel_id !== intent.target_channel_id || image.parent_thumbnail_id !== intent.source_thumbnail_id || image.request_group_id !== (intent.generation_request_id ?? intent.id) || image.language !== intent.target_language || image.status !== "completed" || image.is_selected || image.review_verdict !== "not_reviewed") throw new Error("Localized output identity or human-review state changed");
      const [child] = await tx.select().from(tutorialJobs).where(eq(tutorialJobs.id, image.subject_id)).limit(1);
      if (!child || child.source_job_id !== intent.source_job_id || child.channel_id !== intent.target_channel_id || child.language !== intent.target_language || child.created_by !== source!.created_by) throw new Error("Language draft was rerouted during generation");
      await tx.update(tutorialThumbnailFanout).set({ state: "completed", output_thumbnail_id: result.thumbnailId, lease_token: null, lease_until: null, last_error: null, updated_at: new Date() }).where(and(eq(tutorialThumbnailFanout.id, intent.id), eq(tutorialThumbnailFanout.lease_token, intent.lease_token!)));
    }),
    fail: async (intent, message, state = "uncertain") => {
      await db.update(tutorialThumbnailFanout).set({ state, lease_token: null, lease_until: null, last_error: message.slice(0, 500), updated_at: new Date() }).where(and(eq(tutorialThumbnailFanout.id, intent.id), eq(tutorialThumbnailFanout.lease_token, intent.lease_token!)));
    },
  };
}

export function startEnglishThumbnailFanout(db: DrizzleClient) {
  if (!tutorialAiThumbnailsEnabled()) return () => {};
  let busy = false, stopped = false;
  const ports = englishThumbnailFanoutPorts(db);
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try { for (let i = 0; i < 4 && !stopped; i++) if (!await runEnglishThumbnailFanout(ports)) break; }
    catch { console.warn("English thumbnail fanout unavailable; durable requests retained"); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void tick(), 30_000); timer.unref(); void tick();
  return () => { stopped = true; clearInterval(timer); };
}
