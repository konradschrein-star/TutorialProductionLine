import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db, contentJobs } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Let a VA fix the NAMES of a RANKING job's items.
 *
 * ## Why this exists
 *
 * Narration anchoring locates every item by listening for its name in the
 * Whisper transcript. When the TTS/Whisper pair cannot carry a name the job
 * fails the anchoring gate — correctly, because the alternative is a video
 * whose footage is attached to the wrong moments.
 *
 * The failure message said, in production, to
 * "edit metadata.ranking.items[].name". That is a database instruction printed
 * for a VA. The B-Roll Studio has blocks / request-regen / submit / upload and
 * no rename, so the only person who could act on that sentence was a developer
 * with psql — which is precisely the escalation this lane exists to remove.
 *
 * A real case: Whisper rendered "Keychron" as "Keycrone" once and, on a second
 * run, did not produce the name at all. The fix a human needs is either to
 * spell the item the way it is actually said, or to leave a pronunciation hint.
 * Both are one short string. Neither should require a developer.
 *
 * ## What this deliberately does NOT do
 *
 * It does not re-run anything and it does not relax the gate. Renaming an item
 * is a separate act from retrying the job, so a VA can correct several names,
 * read them back, and then press retry once. The gate still refuses to render a
 * job it cannot anchor.
 */

const BodySchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        /** What the host should say. Empty string is rejected, not silently kept. */
        name: z.string().trim().min(1).max(120).optional(),
        /**
         * Spoken-form hint for a name TTS mangles. null clears it — an
         * unhelpful hint should be removable, not permanent.
         */
        pronunciation: z.string().trim().max(120).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [job] = await db
    .select({
      id: contentJobs.id,
      format: contentJobs.format,
      metadata: contentJobs.metadata,
    })
    .from(contentJobs)
    .where(eq(contentJobs.id, id))
    .limit(1);

  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Format-locked, same reasoning as the retry route: holding the tutorial
  // grant must never become a way to edit other formats' jobs.
  if (job.format !== "RANKING") {
    return NextResponse.json(
      { error: "This endpoint only edits RANKING jobs." },
      { status: 400 },
    );
  }

  const meta =
    job.metadata &&
    typeof job.metadata === "object" &&
    !Array.isArray(job.metadata)
      ? (job.metadata as Record<string, unknown>)
      : {};
  const ranking =
    meta["ranking"] && typeof meta["ranking"] === "object"
      ? (meta["ranking"] as Record<string, unknown>)
      : null;
  const items = Array.isArray(ranking?.["items"])
    ? (ranking!["items"] as Array<Record<string, unknown>>)
    : null;

  if (!ranking || !items) {
    return NextResponse.json(
      { error: "This job has no ranking items to edit yet." },
      { status: 409 },
    );
  }

  const byId = new Map(parsed.data.items.map((i) => [i.id, i]));
  const unknown = parsed.data.items
    .map((i) => i.id)
    .filter((id2) => !items.some((it) => it["id"] === id2));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unknown item id(s): ${unknown.join(", ")}` },
      { status: 400 },
    );
  }

  const updated = items.map((it) => {
    const patch = byId.get(String(it["id"]));
    if (!patch) return it;
    const next = { ...it };
    if (patch.name !== undefined) next["name"] = patch.name;
    if (patch.pronunciation !== undefined) {
      if (patch.pronunciation === null || patch.pronunciation === "") {
        delete next["pronunciation"];
      } else {
        next["pronunciation"] = patch.pronunciation;
      }
    }
    // Any rename invalidates the old anchoring: those timestamps were found by
    // listening for the PREVIOUS name. Clearing them means a retry re-derives
    // them honestly instead of inheriting numbers for a name nobody says.
    if (patch.name !== undefined) {
      delete next["narrationStartMs"];
      delete next["narrationEndMs"];
    }
    return next;
  });

  await db
    .update(contentJobs)
    .set({
      metadata: { ...meta, ranking: { ...ranking, items: updated } } as never,
      updated_at: new Date(),
    })
    .where(eq(contentJobs.id, id));

  return NextResponse.json({
    success: true,
    items: updated.map((it) => ({
      id: it["id"],
      name: it["name"],
      pronunciation: it["pronunciation"] ?? null,
    })),
  });
}
