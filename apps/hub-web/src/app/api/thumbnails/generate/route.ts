export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { createRedisConnection, createThumbnailQueue } from "@repo/queue";
import { getV1Runtime } from "../../v1/_lib/runtime";

/**
 * POST /api/thumbnails/generate
 *
 * Thumbnail Studio generation. Enqueues a `queue-thumbnail` job and returns the
 * `subjectId` the client polls via GET /api/thumbnails/studio/<subjectId>.
 *
 * Everything is optional except a title: no channel (ad-hoc Studio render), no
 * archetype (least-recently-used pick from the GLOBAL library). Defaults are
 * 16:9 at 1K.
 *
 * `parentThumbnailId` + `instructions` is the iterate loop: regenerate an
 * existing thumbnail with a tweak, keeping lineage.
 */

const GenerateSchema = z.object({
  /** Omit for an ad-hoc Studio render not tied to a channel. */
  channelId: z.string().uuid().nullable().optional(),
  format: z.string().min(1).default("OTHER"),
  archetypeId: z.string().uuid().optional(),
  promptMode: z
    .enum(["programmatic", "deepseek", "authored", "manual"])
    .default("programmatic"),
  title: z.string().min(1).max(300),
  /** The literal text on the thumbnail, if not the title. */
  headlineText: z.string().max(300).optional(),
  topic: z.string().max(2000).optional(),
  scriptExcerpt: z.string().max(8000).optional(),
  logoSubject: z.string().max(120).optional(),
  /** Hand-edited prompt — bypasses prompt building entirely. */
  editedPrompt: z.string().max(5000).optional(),
  /** Free-text tweak for an iterate pass. */
  instructions: z.string().max(2000).optional(),
  /** Replaces the archetype's primary reference. */
  referenceOverride: z.string().optional(),
  /** Extra i2i references — e.g. other thumbnails reused as references. */
  extraReferences: z.array(z.string()).max(6).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  resolution: z.enum(["1k", "2k", "4k"]).default("1k"),
  /** Pin a provider. Recorded so any downgrade is visible, never silent. */
  backend: z.enum(["vup", "forge", "fastgen", "ai33"]).optional(),
  parentThumbnailId: z.string().uuid().optional(),
  /**
   * Iterate vs Regenerate — STRICTLY apart (§3.2.5). Iterate references the
   * parent's OUTPUT; Regenerate references the parent's ORIGINAL archetype.
   */
  generationKind: z
    .enum(["original", "variant", "iterate", "regenerate", "localize"])
    .optional(),
  /** Fallback policy for this request (§2.6). */
  onFallback: z.enum(["allow", "warn", "fail"]).optional(),
  /** Reuse the same subject (append variants to an existing group). */
  subjectId: z.string().uuid().optional(),
  language: z.string().max(64).default("en"),
  /** Variant count — widened to 1-10 for manual exploration (§3.2.6). The
   *  automatic path uses 3 (YouTube Test & Compare cap). */
  count: z.number().int().min(1).max(10).default(1),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = GenerateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const { count, subjectId: reuseSubjectId, ...data } = parsed.data;

  // One subjectId groups this batch of variants so the client can poll them
  // together via /api/thumbnails/studio/<subjectId>. Iterate/Regenerate against
  // an existing thumbnail reuse the parent's subject so lineage stays together.
  const subjectId = reuseSubjectId ?? randomUUID();
  // request_group_id groups THIS submission's variants (§3.2.6) so the gallery
  // can render "2 of 3" even when several submissions share a subject.
  const requestGroupId = randomUUID();
  // A multi-variant batch renders structurally-different variants (marked by
  // variant_index) rather than N identical re-rolls (plan §B4). count>1 is only
  // meaningful for original/variant kinds; iterate/regenerate are single.
  const kind = data.generationKind ?? "original";
  const effectiveCount =
    kind === "iterate" || kind === "regenerate" ? 1 : count;

  const { redisUrl } = getV1Runtime();
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const queue = createThumbnailQueue(conn);
    await Promise.all(
      Array.from({ length: effectiveCount }, (_, i) =>
        queue.add(
          "thumbnail",
          {
            ...data,
            subjectKind: "studio",
            subjectId,
            channelId: data.channelId ?? null,
            requestGroupId,
            variantIndex: i,
            generationKind: kind,
          },
          { jobId: `thumbnail-studio-${requestGroupId}-${i}`, attempts: 1 },
        ),
      ),
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to enqueue: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  } finally {
    await conn.quit();
  }

  return NextResponse.json({
    subjectId,
    requestGroupId,
    count: effectiveCount,
  });
}
