export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { createRedisConnection, createThumbnailQueue } from "@repo/queue";
import { getV1Runtime } from "../../v1/_lib/runtime";
import { listThumbnailsForSubject } from "@/lib/repositories/thumbnail-studio-repository";

/**
 * Programmatic thumbnail generation — the NO-HUMAN-IN-THE-LOOP path.
 *
 * POST /api/thumbnails/auto
 *   Enqueues a thumbnail for a real production job. Intended to be called by a
 *   format immediately after render, so the finished video reaches the uploader
 *   with a thumbnail already attached and nobody has to sit at a screen.
 *
 *   Body: { subjectKind, subjectId, format, title, ... }
 *   → 202 { subjectId, queued: true }
 *
 * GET /api/thumbnails/auto?subjectKind=&subjectId=
 *   Poll the outcome. Returns the selected thumbnail when one succeeded, and
 *   ALWAYS returns the failures alongside it. A caller that only checks for a
 *   200 would repeat this system's original sin: 57 consecutive silent
 *   failures that nobody noticed for eleven days.
 *
 * This is exposed as an AVAILABLE step, not a mandatory one — no format is
 * wired to call it by default.
 *
 * Auth: session with `edit:job`. Same-origin server-to-server callers inside
 * the cluster should use the queue directly rather than this route.
 */

const AutoSchema = z.object({
  subjectKind: z.enum(["content_job", "tutorial_job"]),
  subjectId: z.string().uuid(),
  format: z.string().min(1),
  channelId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  headlineText: z.string().max(300).optional(),
  topic: z.string().max(2000).optional(),
  scriptExcerpt: z.string().max(8000).optional(),
  /** Omit to let the engine pick least-recently-used from the global library. */
  archetypeId: z.string().uuid().optional(),
  promptMode: z.enum(["programmatic", "deepseek"]).optional(),
  logoSubject: z.string().max(120).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  resolution: z.enum(["1k", "2k", "4k"]).default("1k"),
  backend: z.enum(["vup", "forge", "fastgen", "ai33"]).optional(),
  language: z.string().max(64).default("en"),
  /** Re-run even if this subject already has a completed thumbnail. */
  force: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "edit:job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = AutoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const { force, ...data } = parsed.data;

  // Idempotent by default: don't burn provider quota regenerating a thumbnail
  // a job already has.
  if (!force) {
    const existing = await listThumbnailsForSubject(
      data.subjectKind,
      data.subjectId,
    );
    const done = existing.find(
      (t) => t.status === "completed" && t.output_path,
    );
    if (done) {
      return NextResponse.json({
        subjectId: data.subjectId,
        queued: false,
        reason: "already_generated",
        thumbnailId: done.id,
      });
    }
  }

  const { redisUrl } = getV1Runtime();
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const queue = createThumbnailQueue(conn);
    await queue.add(
      "thumbnail",
      { ...data, channelId: data.channelId ?? null },
      {
        // Timestamped so a retry after a failure is never dedup-blocked by a
        // retained failed job with a fixed id.
        jobId: `thumbnail-auto-${data.subjectId}-${Date.now()}`,
        attempts: 2,
        backoff: { type: "exponential", delay: 20_000 },
      },
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

  return NextResponse.json(
    { subjectId: data.subjectId, queued: true },
    { status: 202 },
  );
}

const SUBJECT_KINDS = ["content_job", "tutorial_job", "studio", "test"];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:jobs")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const subjectKind = req.nextUrl.searchParams.get("subjectKind") ?? "";
  const subjectId = req.nextUrl.searchParams.get("subjectId") ?? "";
  if (!SUBJECT_KINDS.includes(subjectKind) || !subjectId) {
    return NextResponse.json(
      { error: "subjectKind and subjectId are required" },
      { status: 400 },
    );
  }

  const rows = await listThumbnailsForSubject(
    subjectKind as "content_job" | "tutorial_job" | "studio" | "test",
    subjectId,
  );

  const completed = rows.filter((r) => r.status === "completed");
  const selected = completed.find((r) => r.is_selected) ?? completed[0] ?? null;
  const failures = rows
    .filter((r) => r.status === "failed")
    .map((r) => ({ id: r.id, error: r.error_message }));
  const pending = rows.some(
    (r) => r.status === "pending" || r.status === "generating",
  );

  // Downgrades are reported explicitly: a thumbnail served by a provider other
  // than the one requested may look nothing like the archetype.
  const downgrades = completed
    .filter(
      (r) => r.requested_backend && r.provider_used !== r.requested_backend,
    )
    .map((r) => ({
      id: r.id,
      requested: r.requested_backend,
      servedBy: r.provider_used,
    }));

  return NextResponse.json({
    subjectKind,
    subjectId,
    status: selected ? "completed" : pending ? "pending" : "failed",
    thumbnail: selected
      ? {
          id: selected.id,
          url: `/api/thumbnails/image/${selected.id}`,
          providerUsed: selected.provider_used,
          aspectRatio: selected.aspect_ratio,
          resolution: selected.resolution,
        }
      : null,
    failures,
    downgrades,
    total: rows.length,
  });
}
