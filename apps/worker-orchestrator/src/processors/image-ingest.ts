/**
 * Image Ingest Processor
 *
 * Mirrors clip-ingest but without scene detection — an image is its own
 * unit. Flow:
 *
 *   pending → downloading → processing → labeling   (success)
 *   pending → download_failed                       (HTTP / Pexels error)
 *   pending → processing_failed                     (hash/probe/store error)
 *   pending → archived                              (SHA-256 duplicate)
 *
 * Sources:
 *   - source_kind='stock' + external_provider='pexels' + external_id=<id>
 *     → Pexels API lookup → HTTP download
 *   - source_url present (any source_kind) → HTTP download
 *   - source_file_path present → local copy
 *
 * On completion, inserts the matching `images` row (1:1) and dispatches a
 * single image-label job. Image-label runs Gemini + face recognition.
 */
import { createReadStream } from "node:fs";
import { copyFile, mkdir, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import type { Job, Queue } from "bullmq";
import { eq, sql } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { sourceImages, images, clipLibraries } from "@repo/db";
import {
  ImageIngestPayloadSchema,
  buildRefBase,
  composeExternalRef,
} from "@repo/contracts";
import type { ImageIngestPayload } from "@repo/contracts";
import { createContextLogger } from "@repo/logger";
import { fetchPexelsPhoto } from "../utils/pexels-client.js";
import {
  dhashImage,
  paletteImage,
  probeImage,
  downloadToFile,
} from "../utils/image-signals.js";
import {
  resolveStoragePath,
  resolveCdnUrl,
} from "../utils/storage-resolver.js";

const logger = createContextLogger("image-ingest");

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function pickExt(format: string, url: string | null): string {
  // Prefer format from ffprobe; fall back to URL extension; default jpg.
  if (format && format !== "unknown") return format;
  if (url) {
    const ext = extname(new URL(url).pathname).replace(/^\./, "").toLowerCase();
    if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
  }
  return "jpg";
}

export function createImageIngestProcessor(
  db: DrizzleClient,
  queues: { imageLabel: Queue },
) {
  return async (job: Job<ImageIngestPayload>): Promise<void> => {
    const parseResult = ImageIngestPayloadSchema.safeParse(job.data);
    if (!parseResult.success) {
      throw new Error(
        `Invalid image-ingest payload: ${parseResult.error.message}`,
      );
    }
    const { source_image_id, library_id } = parseResult.data;
    logger.info(
      { source_image_id, library_id, bullmq_job_id: job.id },
      "image-ingest invoked",
    );

    let tempFilePath: string | null = null;

    try {
      const [[sourceImage], [library]] = await Promise.all([
        db
          .select()
          .from(sourceImages)
          .where(eq(sourceImages.id, source_image_id))
          .limit(1),
        db
          .select({
            id: clipLibraries.id,
            storage_backend: clipLibraries.storage_backend,
            storage_root: clipLibraries.storage_root,
          })
          .from(clipLibraries)
          .where(eq(clipLibraries.id, library_id))
          .limit(1),
      ]);

      if (!sourceImage) {
        throw new Error(`source_image not found: ${source_image_id}`);
      }
      if (!library) {
        throw new Error(`clip_library not found: ${library_id}`);
      }

      // Skip terminal states.
      const TERMINAL = ["labeling", "embedding", "ready", "archived"] as const;
      if ((TERMINAL as readonly string[]).includes(sourceImage.ingest_status)) {
        logger.info(
          { source_image_id, ingest_status: sourceImage.ingest_status },
          "source_image already complete — skipping",
        );
        return;
      }

      // Reset retriable.
      if (sourceImage.ingest_status !== "pending") {
        await db
          .update(sourceImages)
          .set({
            ingest_status: "pending",
            error_message: null,
            updated_at: new Date(),
          })
          .where(eq(sourceImages.id, source_image_id));
      }

      await db
        .update(sourceImages)
        .set({
          ingest_status: "downloading",
          ingest_started_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(sourceImages.id, source_image_id));

      // ── Resolve the file ────────────────────────────────────────────────
      let workingPath: string;
      let resolvedUrl: string | null = sourceImage.source_url;
      let pexelsAttribution: Record<string, unknown> | null = null;
      let pexelsLicense: Record<string, unknown> | null = null;

      try {
        if (
          sourceImage.source_kind === "stock" &&
          sourceImage.external_provider === "pexels"
        ) {
          // Resolve via Pexels API.
          const apiKey = process.env["PEXELS_API_KEY"] ?? "";
          const photo = await fetchPexelsPhoto(
            sourceImage.external_id ?? "",
            apiKey,
          );
          resolvedUrl = photo.download_url;
          pexelsAttribution = photo.attribution;
          pexelsLicense = photo.license;
        }

        if (resolvedUrl) {
          tempFilePath = join(
            tmpdir(),
            `image-ingest-${source_image_id}-${randomUUID()}.bin`,
          );
          await downloadToFile(resolvedUrl, tempFilePath);
          workingPath = tempFilePath;
        } else if (sourceImage.source_file_path) {
          workingPath = sourceImage.source_file_path;
        } else {
          throw new Error(
            `source_image ${source_image_id} has no source_url or source_file_path`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db
          .update(sourceImages)
          .set({
            ingest_status: "download_failed",
            error_message: msg,
            updated_at: new Date(),
          })
          .where(eq(sourceImages.id, source_image_id));
        throw new Error(
          `Download failed for source_image ${source_image_id}: ${msg}`,
        );
      }

      await db
        .update(sourceImages)
        .set({ ingest_status: "processing", updated_at: new Date() })
        .where(eq(sourceImages.id, source_image_id));

      try {
        // ── SHA-256 dedup ──────────────────────────────────────────────
        const contentHash = await hashFile(workingPath);
        const dupRows = await db
          .select({ id: sourceImages.id })
          .from(sourceImages)
          .where(
            sql`${sourceImages.content_hash} = ${contentHash} AND ${sourceImages.id} != ${source_image_id}`,
          )
          .limit(1);

        if (dupRows.length > 0) {
          const existing = dupRows[0]!.id;
          logger.info(
            { source_image_id, duplicate_of: existing },
            "duplicate source_image — archiving",
          );
          await db
            .update(sourceImages)
            .set({
              ingest_status: "archived",
              error_message: `Duplicate of ${existing}`,
              content_hash: contentHash,
              updated_at: new Date(),
            })
            .where(eq(sourceImages.id, source_image_id));
          return;
        }

        // ── Probe + signals ────────────────────────────────────────────
        const meta = await probeImage(workingPath);
        const phash = await dhashImage(workingPath);
        const palette = await paletteImage(workingPath, 3).catch(() => []);

        // ── ref_base ───────────────────────────────────────────────────
        // source_images carries the lean identity set (no season/episode/
        // youtube_id/work_part — those are video-specific). Fill nulls so
        // the shared buildRefBase helper can switch on source_kind.
        let refBase: string;
        try {
          refBase = buildRefBase({
            source_kind: sourceImage.source_kind,
            work_slug: sourceImage.work_slug,
            work_part: null,
            season: null,
            episode: null,
            youtube_id: null,
            external_provider: sourceImage.external_provider,
            external_id: sourceImage.external_id,
          });
        } catch (err) {
          logger.warn(
            {
              source_image_id,
              source_kind: sourceImage.source_kind,
              error: err instanceof Error ? err.message : String(err),
            },
            "ref_base could not be composed — falling back to source_image_id",
          );
          refBase = source_image_id;
        }

        const ext = pickExt(meta.format, resolvedUrl);
        const storageKey = `images/sources/${refBase}/source.${ext}`;
        const destPath = resolveStoragePath(library, storageKey);
        await mkdir(join(destPath, ".."), { recursive: true });
        await copyFile(workingPath, destPath);

        const cdnUrl = resolveCdnUrl(library, storageKey);

        // ── Update source_image with all metadata ──────────────────────
        await db
          .update(sourceImages)
          .set({
            content_hash: contentHash,
            ref_base: refBase,
            storage_key: storageKey,
            cdn_url: cdnUrl,
            width: meta.width,
            height: meta.height,
            format: meta.format,
            bytes: meta.bytes,
            phash,
            palette_dominant_hex: palette,
            license: pexelsLicense,
            attribution: pexelsAttribution,
            ingest_status: "labeling",
            ingest_completed_at: new Date(),
            updated_at: new Date(),
          })
          .where(eq(sourceImages.id, source_image_id));

        // ── Create the matching images row (1:1) ───────────────────────
        const externalRef = composeExternalRef(refBase, 0);
        const [imageRow] = await db
          .insert(images)
          .values({
            library_id,
            source_image_id,
            external_ref: externalRef,
            review_status: "pending" as const,
          })
          .returning({ id: images.id });

        if (!imageRow) {
          throw new Error("Failed to insert images row");
        }

        // Bump library counter (we count images alongside clips).
        await db.execute(
          sql`UPDATE clip_libraries SET clip_count = clip_count + 1 WHERE id = ${library_id}`,
        );

        // Dispatch label.
        await queues.imageLabel.add(
          "label-image",
          { image_id: imageRow.id, library_id },
          { jobId: `image-label-${imageRow.id}`, removeOnComplete: true },
        );

        logger.info(
          { source_image_id, image_id: imageRow.id, ref_base: refBase },
          "image ingested — label dispatched",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          { source_image_id, error: msg },
          "image-ingest processing failed",
        );
        await db
          .update(sourceImages)
          .set({
            ingest_status: "processing_failed",
            error_message: msg,
            updated_at: new Date(),
          })
          .where(eq(sourceImages.id, source_image_id));
        throw err;
      }
    } finally {
      if (tempFilePath) {
        await unlink(tempFilePath).catch(() => {});
      }
    }
  };
}
