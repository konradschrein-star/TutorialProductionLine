import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, contentJobs } from "@/lib/db";
import { getTutorialJobById } from "@repo/db";
import { createRedisConnection, createThumbnailQueue } from "@repo/queue";
import { listThumbnailsForSubject } from "@/lib/repositories/thumbnail-studio-repository";
import type { Thumbnail } from "@repo/db";
import { getV1Runtime } from "../../../v1/_lib/runtime";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/[id]/thumbnail?kind=content_job|tutorial_job
 * POST /api/jobs/[id]/thumbnail
 *
 * Job-detail thumbnail surface: list generated thumbnails for a job, and
 * enqueue regeneration (same reference / with changes / localize) via
 * queue-thumbnail. Actual image lookup goes through the existing
 * GET /api/thumbnails/image/{thumbnailId} route.
 */

type SubjectKind = "content_job" | "tutorial_job";

const KindSchema = z.enum(["content_job", "tutorial_job"]);

const Body = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("same"),
    kind: KindSchema.default("content_job"),
    editedPrompt: z.string().optional(),
    /** Swap the reference style; omitted keeps the current archetype. */
    archetypeId: z.string().uuid().optional(),
  }),
  z.object({
    mode: z.literal("changes"),
    kind: KindSchema.default("content_job"),
    instructions: z.string().min(1),
    archetypeId: z.string().uuid().optional(),
  }),
  z.object({
    // Iterate: edit the EXISTING image (reference = the parent's output).
    // Distinct from "changes", which rebuilds from the archetype reference.
    mode: z.literal("iterate"),
    kind: KindSchema.default("content_job"),
    instructions: z.string().min(1),
  }),
  z.object({
    mode: z.literal("localize"),
    kind: KindSchema.default("content_job"),
    languages: z.array(z.string().min(1)).min(1),
  }),
]);

interface JobContext {
  channelId: string | null;
  title: string;
  topic: string;
  format: string;
}

async function loadJobContext(
  kind: SubjectKind,
  id: string,
): Promise<JobContext | null> {
  if (kind === "tutorial_job") {
    const job = await getTutorialJobById(db, id);
    if (!job) return null;
    return {
      channelId: job.channel_id ?? null,
      title: job.title,
      topic: job.title,
      format: "TUTORIAL_STUDIO",
    };
  }

  const [job] = await db
    .select()
    .from(contentJobs)
    .where(eq(contentJobs.id, id))
    .limit(1);
  if (!job) return null;
  return {
    channelId: job.channel_id ?? null,
    title: job.title,
    topic: job.initial_topic ?? job.title,
    format: job.format,
  };
}

function pickCurrentThumbnail(rows: Thumbnail[]): Thumbnail | undefined {
  // Only a completed thumbnail is a valid i2i base for regenerate/localize — a
  // selected-but-failed row has no usable output_path. Prefer the selected
  // completed one, then any completed one.
  const selectedCompleted = rows.find(
    (row) => row.is_selected && row.status === "completed",
  );
  if (selectedCompleted) return selectedCompleted;
  return rows.find((row) => row.status === "completed");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (
    !session ||
    (!hasPermission(session, "view:jobs") &&
      !hasPermission(session, "manage:thumbnails"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const kindParam = req.nextUrl.searchParams.get("kind") ?? "content_job";
  // D7 boundary: tutorial jobs are a separate operation with their own surface
  // at /api/production/jobs/[id]/thumbnail. A /api/jobs/** route serves
  // content jobs only and must never touch tutorial subjects.
  if (kindParam === "tutorial_job") {
    return NextResponse.json(
      {
        error:
          "tutorial thumbnails are served by /api/production/jobs/[id]/thumbnail",
      },
      { status: 400 },
    );
  }
  const parsedKind = KindSchema.safeParse(kindParam);
  const kind: SubjectKind = parsedKind.success
    ? parsedKind.data
    : "content_job";

  const rows = await listThumbnailsForSubject(kind, id);
  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  // `manage:thumbnails` is the narrow grant that lets an UPLOADER_VA fix a bad
  // thumbnail on a finished video without handing them edit:job (which would
  // let them mutate scripts, states and assets). This route only ever enqueues
  // a thumbnail generation — nothing else about the job is touched.
  if (
    !session ||
    (!hasPermission(session, "edit:job") &&
      !hasPermission(session, "manage:thumbnails"))
  ) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 },
    );
  }

  const { id } = await params;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const body = parsed.data;

  // D7 boundary (see GET): this route serves content jobs only.
  if (body.kind === "tutorial_job") {
    return NextResponse.json(
      {
        error:
          "tutorial thumbnails are served by /api/production/jobs/[id]/thumbnail",
      },
      { status: 400 },
    );
  }

  const jobContext = await loadJobContext(body.kind, id);
  if (!jobContext) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!jobContext.channelId) {
    return NextResponse.json({ error: "job has no channel" }, { status: 400 });
  }

  const existing = await listThumbnailsForSubject(body.kind, id);
  const current = pickCurrentThumbnail(existing);

  if (body.mode !== "same" && !current) {
    return NextResponse.json(
      { error: "no base thumbnail to regenerate from" },
      { status: 400 },
    );
  }

  const base = {
    subjectKind: body.kind,
    subjectId: id,
    format: jobContext.format,
    channelId: jobContext.channelId,
    title: jobContext.title,
    topic: jobContext.topic,
    language: "en",
  };

  const { redisUrl } = getV1Runtime();
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  let enqueued = 0;
  try {
    const queue = createThumbnailQueue(conn);

    if (body.mode === "same") {
      await queue.add(
        "thumbnail",
        {
          ...base,
          archetypeId: body.archetypeId ?? current?.archetype_id ?? undefined,
          editedPrompt: body.editedPrompt,
          generationKind: "original",
        },
        { jobId: `regen-same-${id}-${randomUUID()}`, attempts: 2 },
      );
      enqueued = 1;
    } else if (body.mode === "changes") {
      // REGENERATE (DECISIONS §3.2.5): rebuild the brief from the parent's
      // ORIGINAL archetype reference and fold the operator's instruction in as
      // a regeneration note.
      //
      // This used to post {referenceOverride: <parent output>, instructions}
      // with no parentThumbnailId and no generationKind. The engine infers
      // kind from those fields, so it resolved to "original" — and `regenNote`
      // is only built for kind === "regenerate". The VA's typed instruction was
      // parsed, enqueued, persisted, and then dropped on the floor while a
      // fresh unrelated brief was generated. Both fields are now explicit.
      await queue.add(
        "thumbnail",
        {
          ...base,
          generationKind: "regenerate",
          parentThumbnailId: current!.id,
          ...(body.archetypeId ? { archetypeId: body.archetypeId } : {}),
          instructions: body.instructions,
        },
        { jobId: `regen-changes-${id}-${randomUUID()}`, attempts: 2 },
      );
      enqueued = 1;
    } else if (body.mode === "iterate") {
      // ITERATE: the parent's OUTPUT is the reference; apply only the deltas.
      await queue.add(
        "thumbnail",
        {
          ...base,
          generationKind: "iterate",
          parentThumbnailId: current!.id,
          instructions: body.instructions,
        },
        { jobId: `regen-iterate-${id}-${randomUUID()}`, attempts: 2 },
      );
      enqueued = 1;
    } else {
      for (const language of body.languages) {
        await queue.add(
          "thumbnail",
          {
            ...base,
            targetLanguage: language,
            localizeFromThumbnailId: current!.id,
          },
          {
            jobId: `regen-loc-${id}-${language}-${randomUUID()}`,
            attempts: 2,
          },
        );
        enqueued += 1;
      }
    }
  } finally {
    await conn.quit();
  }

  return NextResponse.json({ ok: true, enqueued });
}
