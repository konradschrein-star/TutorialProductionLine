import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db, tutorialJobs, users } from "@/lib/db";
import { createTutorialJob, listTutorialJobsByUser } from "@repo/db";
import {
  createRedisConnection,
  createTutorialGenerateQueue,
} from "@repo/queue";
import { VoiceSettingsSchema } from "@repo/contracts";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  title: z.string().min(1),
  mode: z.enum([
    "THREE_MIN",
    "SIX_MIN",
    "SIX_MIN_STITCH",
    "LONG_FORM",
    "SHORT_MATCH",
    "SHORT_PLUS",
  ]),
  steps_input: z.string().default(""),
  prompt_preset_id: z.string().uuid().optional(),
  custom_prompt: z.string().optional(),
  script_provider: z.string().min(1),
  script_model: z.string().optional(),
  tts_provider: z.string().min(1),
  tts_voice: z.string().min(1),
  batch_id: z.string().uuid().optional(),
  voice_settings: VoiceSettingsSchema.optional(),
  // SIX_MIN_STITCH only
  target_minutes: z.number().int().positive().optional(),
  ref_video_seconds: z.number().int().positive().optional(),
  // LONG_FORM only
  part_length_minutes: z.number().int().positive().optional(),
  // Optional extra context/instructions for the script writer (LONG_FORM)
  extra_context: z.string().optional(),
  // REQUIRED as of 2026-08-03. Was .optional(), and combined with a picker
  // defaulting to "— None —" that produced 1,921 of 2,006 completed tutorials
  // (96%) with channel_id NULL — Drive folders literally named _no-channel,
  // thumbnail generation skipped, and no record of which of three channels a
  // finished video belongs to.
  channel_id: z.string().uuid({
    message:
      "A channel is required — it decides the Drive folder, the thumbnail style, and the upload destination.",
  }),
  // Script source: research-based write vs rewrite of a reference transcript.
  source_mode: z
    .enum(["FROM_SCRATCH", "TRANSCRIPT_REWRITE"])
    .default("FROM_SCRATCH"),
  reference_url: z.string().optional(),
  reference_transcript: z.string().optional(),
  // Target spoken language (default English).
  language: z.string().optional(),
  /**
   * Video ERP binding — the Keyword Tool keyword this job came from.
   *
   * The bearer-authenticated twin of this route (/api/v1/tutorial/jobs) has
   * accepted these since the binding was built, but the route a VA's browser
   * actually posts to did NOT, so a job created in the Create tab could never
   * be linked back to a keyword. That is why zero of 2,349 tutorial jobs carry
   * a keyword_ref, and therefore why the status webhook that advances the
   * keyword board has never fired: `updateTutorialJob` only fires it for jobs
   * that have one.
   */
  keyword_ref: z.string().min(1).optional(),
  kt_url: z.string().url().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const jobs = await listTutorialJobsByUser(db, session.userId, 100);

  // `?summary=1` nulls script_text. Tutorial Studio polls this endpoint every
  // 5s and script_text dominates the payload — 100 rows measured 546 kB in
  // Postgres, 368 kB of it script_text, serialising to a 1.37 MB JSON body
  // (confirmed in the nginx access log). Only the SELECTED job's script is
  // ever rendered (studio.tsx reads `selectedJob.script_text` and nothing
  // else), so the other 99 scripts were downloaded and JSON.parsed on the
  // main thread every 5 seconds — on the exact page the VA plays the
  // voiceover and records on.
  //
  // The shape is unchanged (script_text is nullable already), so callers that
  // don't opt in are unaffected and no client type changes. page-client keeps
  // the script_text it has already loaded and backfills any job whose script
  // finished while the page was open.
  // THE ABOVE FIX WAS HALF THE PAYLOAD. Nulling script_text alone took the
  // body from 1.37 MB to 1.23 MB — a 10% cut against a comment claiming
  // script_text "dominates". Measured over the 100 most recent rows:
  //
  //     script_text 481 kB  |  steps_input 469 kB  |  output_qa_detail 78 kB
  //     description  66 kB  |  script_structure 18 kB
  //
  // `steps_input` is the VA's typed-in step list. It is the same size as
  // script_text, is rendered from `selectedJob` and nowhere else
  // (studio.tsx:2411) — the identical access pattern — and sat one field away
  // from the fix without being noticed. output_qa_detail and script_structure
  // are not read by this page at all.
  //
  // Cost of the miss, from today's nginx log: 10,802 requests across 6 open
  // tabs, 7.3 GB of JSON, on the page a VA keeps open while recording. That is
  // the "Studio is slow" complaint, and it is why an idle tab can wedge.
  //
  // description stays — it is small and may be read by the review surfaces.
  if (req.nextUrl.searchParams.get("summary") === "1") {
    return NextResponse.json({
      jobs: jobs.map((j) => ({
        ...j,
        script_text: null,
        steps_input: "",
        output_qa_detail: null,
        script_structure: null,
      })),
    });
  }

  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const data = parsed.data;

  // A job with neither a preset id nor a custom prompt will fail at the
  // script stage with "No prompt found". Reject up front instead of
  // letting the worker burn through retries.
  if (!data.prompt_preset_id && !data.custom_prompt?.trim()) {
    return NextResponse.json(
      {
        error: "Pick a prompt preset or supply a custom prompt — got neither.",
      },
      { status: 400 },
    );
  }

  // Same duplicate guard as the bearer route: keyword_ref is indexed but not
  // unique, so a double-click or a retry after a slow response would create a
  // second full job for the same keyword and pay for the whole pipeline twice.
  // Only failed/cancelled jobs may be re-sent.
  if (data.keyword_ref) {
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
            `You have already started this keyword — it is job "${existing.id}" (${existing.status}). ` +
            `Cancel that one first if you want to redo it.`,
        },
        { status: 409 },
      );
    }
  }

  const job = await createTutorialJob(db, {
    created_by: session.userId,
    keyword_ref: data.keyword_ref,
    kt_url: data.kt_url,
    batch_id: data.batch_id ?? randomUUID(),
    title: data.title,
    mode: data.mode,
    steps_input: data.steps_input,
    prompt_preset_id: data.prompt_preset_id,
    custom_prompt: data.custom_prompt,
    script_provider: data.script_provider,
    script_model: data.script_model,
    tts_provider: data.tts_provider,
    tts_voice: data.tts_voice,
    voice_settings: data.voice_settings as Record<string, unknown> | undefined,
    target_minutes: data.target_minutes,
    ref_video_seconds: data.ref_video_seconds,
    part_length_minutes: data.part_length_minutes,
    extra_context: data.extra_context,
    channel_id: data.channel_id,
    source_mode: data.source_mode,
    reference_url: data.reference_url,
    reference_transcript: data.reference_transcript,
    language: data.language,
  });

  // Remember the channel this assistant is working on. It is what attributes a
  // job created OUTSIDE this form — one pushed from the keyword board's Produce
  // button, which sends no channel — to the right brand, without anyone having
  // to configure a server-wide default that would be wrong for somebody.
  // Best-effort: a failure here must not lose a job that was already created.
  if (job.channel_id) {
    await db
      .update(users)
      .set({ default_tutorial_channel_id: job.channel_id })
      .where(eq(users.id, session.userId))
      .catch((err: unknown) => {
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "could not remember the VA's channel choice",
            userId: session.userId,
            error: String(err).slice(0, 200),
          }),
        );
      });
  }

  // If this job came from the "Initial Keywords" fallback (keyword_ref
  // "seed:<id>"), advance that seed keyword's state to IN_PROGRESS so the
  // fallback list tracks it — the same way picking a board keyword advances the
  // board. Only bump from NEW so a manual DONE is never clobbered. Best-effort.
  if (data.keyword_ref && data.keyword_ref.startsWith("seed:")) {
    const seedId = Number(data.keyword_ref.slice("seed:".length));
    if (Number.isInteger(seedId) && seedId > 0) {
      await db
        .execute(
          sql`UPDATE seed_keywords SET status = 'IN_PROGRESS', updated_at = now()
              WHERE id = ${seedId} AND status = 'NEW' AND deleted_at IS NULL`,
        )
        .catch((err: unknown) => {
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "could not advance seed keyword to IN_PROGRESS",
              keyword_ref: data.keyword_ref,
              error: String(err).slice(0, 200),
            }),
          );
        });
    }
  }

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
  return NextResponse.json({ jobId: job.id }, { status: 201 });
}
