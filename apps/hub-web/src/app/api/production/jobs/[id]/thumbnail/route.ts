import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById } from "@repo/db";
import { deriveLogoSubject } from "@repo/domain";
import { createRedisConnection, createThumbnailQueue } from "@repo/queue";
import { listThumbnailsForSubject } from "@/lib/repositories/thumbnail-studio-repository";
import type { Thumbnail } from "@repo/db";
import { getV1Runtime } from "../../../../v1/_lib/runtime";

export const dynamic = "force-dynamic";

/**
 * GET  /api/production/jobs/[id]/thumbnail   — list this tutorial job's thumbnails
 * POST /api/production/jobs/[id]/thumbnail   — regenerate (same reference)
 *
 * Production-scoped mirror of /api/jobs/[id]/thumbnail. A separate route exists
 * because the tutorial Studio is used by TUTORIAL_VA / PRODUCTION_VA, who have
 * `view:production` + `create:tutorial-job` but NOT the `view:settings` /
 * `edit:job` the generic thumbnail routes require. The auto-enqueued tutorial
 * thumbnail is stored with subject_kind "tutorial_job" and subject_id = the
 * (parent) tutorial job id — see processors/tutorial/{splice,stitch}.ts.
 */

/**
 * Regeneration options. All optional, so the historical empty-body POST
 * ("regenerate with the same reference") keeps working unchanged.
 */
const Body = z.object({
  /** Swap the reference style. Omitted keeps the current archetype. */
  archetypeId: z.string().uuid().optional(),
  /** What the operator wants changed. Requires a base thumbnail. */
  instructions: z.string().min(1).max(2000).optional(),
  /**
   * regenerate — rebuild from the archetype reference + the instruction
   * iterate    — edit the existing image, applying only the deltas
   */
  mode: z.enum(["same", "changes", "iterate"]).default("same"),
});

function pickCurrentThumbnail(rows: Thumbnail[]): Thumbnail | undefined {
  const selectedCompleted = rows.find(
    (row) => row.is_selected && row.status === "completed",
  );
  if (selectedCompleted) return selectedCompleted;
  return rows.find((row) => row.status === "completed");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  // `manage:thumbnails` is the uploader's narrow grant (see rbac.ts): they can
  // see and fix thumbnails on a finished tutorial video without holding
  // view:production (which would open the whole production engine).
  if (
    !session ||
    (!hasPermission(session, "view:production") &&
      !hasPermission(session, "manage:thumbnails"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    hasPermission(session, "manage:thumbnails") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";
  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await listThumbnailsForSubject("tutorial_job", id);
  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "create:tutorial-job") &&
      !hasPermission(session, "manage:thumbnails"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    hasPermission(session, "manage:thumbnails") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";
  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // NOTE: a missing channel is NOT a rejection reason. The format + global
  // archetype rules can serve the request on their own (DECISIONS §3.2.8), and
  // 95% of completed tutorials have no channel — this hard-reject made the
  // "regenerate" button unusable for almost every job. Mirrors the same fix in
  // worker-render/src/utils/enqueue-thumbnail.ts (plan A2.6). channel_id flows
  // through as null and requestThumbnail() handles it.

  // Reuse the most recent completed thumbnail's archetype so a regenerate
  // stays on-brand; the worker will re-derive everything else.
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const body = parsed.data;

  const existing = await listThumbnailsForSubject("tutorial_job", id);
  const current = pickCurrentThumbnail(existing);

  if (body.mode !== "same" && !current) {
    return NextResponse.json(
      { error: "no base thumbnail to regenerate from" },
      { status: 400 },
    );
  }
  if (body.mode !== "same" && !body.instructions) {
    return NextResponse.json(
      { error: "instructions are required for this mode" },
      { status: 400 },
    );
  }

  // generationKind is ALWAYS explicit. The engine infers it from the other
  // fields when omitted, and that inference resolves to "original" — which is
  // how the operator's typed instruction used to be silently discarded.
  const payload =
    body.mode === "same"
      ? {
          generationKind: "original" as const,
          archetypeId: body.archetypeId ?? current?.archetype_id ?? undefined,
        }
      : {
          generationKind:
            body.mode === "iterate"
              ? ("iterate" as const)
              : ("regenerate" as const),
          parentThumbnailId: current!.id,
          instructions: body.instructions,
          ...(body.mode === "changes" && body.archetypeId
            ? { archetypeId: body.archetypeId }
            : {}),
        };

  const logoSubject = deriveLogoSubject(job.title);

  const { redisUrl } = getV1Runtime();
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const queue = createThumbnailQueue(conn);
    await queue.add(
      "thumbnail",
      {
        subjectKind: "tutorial_job",
        subjectId: id,
        format: "TUTORIAL_STUDIO",
        channelId: job.channel_id,
        title: job.title,
        topic: job.title,
        // The product this tutorial is about. The auto-enqueue in the splice
        // and stitch processors passes the same thing; without it here a VA's
        // manual regenerate would produce a LESS branded thumbnail than the
        // automatic one, which is the wrong way round for the button they
        // press when the automatic result was not good enough.
        ...(logoSubject !== null ? { logoSubject } : {}),
        language: "en",
        ...payload,
      },
      { jobId: `tutorial-thumb-regen-${id}-${randomUUID()}`, attempts: 2 },
    );
  } finally {
    await conn.quit();
  }

  return NextResponse.json({ ok: true });
}
