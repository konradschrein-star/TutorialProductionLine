import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, notInArray } from "drizzle-orm";
import { resolvePrincipal, ApiAuthError } from "@/app/api/_lib/auth";
import { db, tutorialJobs, users, channels } from "@/lib/db";
import {
  createTutorialJob,
  getTutorialSettings,
  listPromptPresets,
} from "@repo/db";
import {
  createRedisConnection,
  createTutorialGenerateQueue,
} from "@repo/queue";
import { findUserByEmail } from "@/lib/repositories/user-repository";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/tutorial/jobs
 *
 * Machine-to-machine "Produce" endpoint for the external Keyword Tool (KT).
 * KT posts a keyword it wants turned into a tutorial video; this route creates
 * a tutorial_job and enqueues the script stage — exactly like the browser route
 * at /api/production/jobs, but authenticated by Authorization: Bearer
 * ${CF_API_TOKEN} instead of a hub session cookie.
 *
 * This is a STANDALONE route. Its job-creation logic is copied from the proven
 * POST handler in /api/production/jobs/route.ts (duplicate guard, create
 * TutorialJob call, and enqueue) rather than refactored out of it, so a change
 * here can never regress the VA-facing browser route.
 */

const CreateSchema = z.object({
  // The KT keyword id (as text). Required — it is the whole point of the ERP
  // binding and the key the duplicate guard and status webhook hang off of.
  keyword_ref: z.string().min(1),
  // Lenient on purpose: KT sometimes sends a relative or non-URL ref, and we
  // never want a malformed link to reject an otherwise valid Produce request.
  kt_url: z.string().optional(),
  title: z.string().min(1),
  mode: z
    .enum([
      "THREE_MIN",
      "SIX_MIN",
      "SIX_MIN_STITCH",
      "LONG_FORM",
      "SHORT_MATCH",
      "SHORT_PLUS",
    ])
    .default("THREE_MIN"),
  language: z.string().optional(),
  reference_url: z.string().optional(),
  // Validated against the DB below rather than by shape — a bad id is treated
  // as "no channel", not a 400.
  channel_id: z.string().optional(),
  // The KT operator who clicked Produce. Used to attribute created_by when it
  // maps to a real hub user.
  claimed_by_email: z.string().optional(),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // Auth: REQUIRE a machine principal (valid Authorization: Bearer
  // ${CF_API_TOKEN}). resolvePrincipal throws ApiAuthError(503) when
  // CF_API_TOKEN is unset on the server and ApiAuthError(401) on a bad/missing
  // token — mirror the download route's try/catch mapping.
  let principal;
  try {
    principal = await resolvePrincipal(req);
  } catch (err) {
    const status = err instanceof ApiAuthError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Auth failure" },
      { status },
    );
  }
  if (principal.kind !== "machine") {
    return NextResponse.json(
      {
        error:
          "This endpoint requires a machine bearer token (Authorization: Bearer ${CF_API_TOKEN}).",
      },
      { status: 401 },
    );
  }

  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const data = parsed.data;

  // Duplicate guard (copied from /api/production/jobs): keyword_ref is indexed
  // but not unique, so a double-click or retry would create a second full job
  // for the same keyword and pay for the whole pipeline twice. Only
  // failed/cancelled jobs may be re-sent.
  {
    const [existing] = await db
      .select({ id: tutorialJobs.id, status: tutorialJobs.status })
      .from(tutorialJobs)
      .where(
        and(
          eq(tutorialJobs.keyword_ref, data.keyword_ref),
          notInArray(tutorialJobs.status, [
            "FAILED_SCRIPT",
            "FAILED_AUDIO",
            "FAILED_SPLICE",
            "CANCELLED",
          ]),
        ),
      )
      .limit(1);
    if (existing) {
      return NextResponse.json(
        {
          error:
            `This keyword already has a tutorial job "${existing.id}" (${existing.status}). ` +
            `Cancel that one first if you want to redo it.`,
        },
        { status: 409 },
      );
    }
  }

  // created_by resolution (created_by is NOT NULL).
  //   a. Prefer the KT operator's email if it maps to a real hub user.
  //   b. Otherwise fall back to the oldest ADMIN user.
  //   c. If neither exists, we cannot legally create the row.
  let createdBy: string | null = null;
  if (data.claimed_by_email) {
    const claimed = await findUserByEmail(data.claimed_by_email);
    if (claimed) createdBy = claimed.id;
  }
  if (!createdBy) {
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "ADMIN"))
      .orderBy(asc(users.created_at))
      .limit(1);
    if (admin) createdBy = admin.id;
  }
  if (!createdBy) {
    return NextResponse.json(
      {
        error:
          "Cannot attribute this job: claimed_by_email matched no user and no ADMIN user exists.",
      },
      { status: 500 },
    );
  }

  // channel_id resolution (nullable, but a NULL channel historically caused
  // misfiled jobs, so resolve one when we can).
  //   a. Use body.channel_id if it names an existing channel.
  //   b. Else, if a language was given, the most recently created channel that
  //      accepts tutorials in that language.
  //   c. Else leave it null and note it in the response.
  let channelId: string | null = null;
  if (data.channel_id && UUID_RE.test(data.channel_id)) {
    const [ch] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.id, data.channel_id))
      .limit(1);
    if (ch) channelId = ch.id;
  }
  if (!channelId && data.language) {
    const [ch] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(
        and(
          eq(channels.accepts_tutorials, true),
          eq(channels.language, data.language),
        ),
      )
      .orderBy(desc(channels.created_at))
      .limit(1);
    if (ch) channelId = ch.id;
  }

  // Required provider fields (script_provider, tts_provider, tts_voice are NOT
  // NULL). Fill from the single-row tutorial settings defaults. An empty
  // default_tts_voice is passed through unchanged — the worker resolves the
  // real voice (per-channel voice binding), matching the browser route.
  const settings = await getTutorialSettings(db);

  // Prompt preset: KT sends none, so use the default preset. If there is no
  // default preset AND no custom prompt (there never is one here), the job
  // would fail at the script stage with "No prompt found" — reject up front
  // with the same guarded error the browser route returns.
  const presets = await listPromptPresets(db);
  const defaultPreset = presets.find((p) => p.is_default);
  if (!defaultPreset) {
    return NextResponse.json(
      {
        error: "Pick a prompt preset or supply a custom prompt — got neither.",
      },
      { status: 400 },
    );
  }

  const job = await createTutorialJob(db, {
    created_by: createdBy,
    keyword_ref: data.keyword_ref,
    kt_url: data.kt_url,
    batch_id: randomUUID(),
    title: data.title,
    mode: data.mode,
    steps_input: "",
    prompt_preset_id: defaultPreset.id,
    script_provider: settings.default_script_provider,
    script_model: settings.default_script_model ?? undefined,
    tts_provider: settings.default_tts_provider,
    tts_voice: settings.default_tts_voice,
    channel_id: channelId,
    source_mode: "FROM_SCRATCH",
    reference_url: data.reference_url,
    language: data.language,
  });

  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    return NextResponse.json({ error: "REDIS_URL not set" }, { status: 500 });
  }
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const queue = createTutorialGenerateQueue(conn);
    await queue.add(
      "tutorial-generate",
      { jobId: job.id, stage: "script" },
      { jobId: `tutorial-script-${job.id}`, attempts: 2 },
    );
  } finally {
    await conn.quit();
  }

  const channelResolved = channelId !== null;
  return NextResponse.json(
    {
      jobId: job.id,
      channelResolved,
      ...(channelResolved
        ? {}
        : {
            note: "No channel could be resolved (channel_id absent/unknown and no accepts_tutorials channel matched the language). The job was created with channel_id null.",
          }),
    },
    { status: 201 },
  );
}
