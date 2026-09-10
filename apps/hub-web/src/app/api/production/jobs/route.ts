import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db, tutorialJobs, users } from "@/lib/db";
import { createOrReuseTutorialJob, listTutorialJobs, listTutorialJobsByUser } from "@repo/db";
import {
  createRedisConnection,
  createTutorialGenerateQueue,
} from "@repo/queue";
import { VoiceSettingsSchema } from "@repo/contracts";
import { getProductionChannelAccess } from "@/lib/tutorial/channel-access";
import { KeywordProductionSchema, keywordProductionPayload } from "@/lib/keyword-tool/production";
import { ktLogin, ktGet, ktProduce, KeywordToolError } from "@/lib/keyword-tool/client";

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
  const jobs = hasPermission(session, "manage:tutorial-settings")
    ? await listTutorialJobs(db, 100)
    : await listTutorialJobsByUser(db, session.userId, 100);

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
  const incoming = await req.json();
  if (incoming && typeof incoming === "object" && incoming.keyword_ref) {
    const linked = KeywordProductionSchema.safeParse(incoming);
    if (!linked.success) return NextResponse.json({ error: linked.error.message }, { status: 400 });
    const data = linked.data;
    const destination = await getProductionChannelAccess(session.userId, data.channel_id);
    if (!destination) return NextResponse.json({ error: "This channel is not assigned to you." }, { status: 403 });
    if (data.language !== destination.language) return NextResponse.json({ error: "The language must match the assigned channel." }, { status: 400 });
    try {
      const kt = await ktLogin(session);
      // Even an Admin's browser acts on its own claims here, never an arbitrary VA.
      const claims = await ktGet<Array<{ id: number }>>(kt, "/api/v5/keywords", { claimed_by: kt.user.id, limit: 200 });
      if (!claims.some((k) => String(k.id) === data.keyword_ref)) return NextResponse.json({ error: "Claim this keyword in the Keyword Tool before preparing it." }, { status: 403 });
      const result = await ktProduce(kt, data.keyword_ref, keywordProductionPayload(data));
      if (result.state !== "confirmed" || !result.forge_job_id) return NextResponse.json({
        error: result.message ?? "Your request is saved but Studio has not confirmed it. Retry this same keyword; do not create replacement work.",
        intentState: result.state ?? "uncertain",
      }, { status: 503 });
      // A retry reuses the frozen request, not newly edited form values.
      // Verify the actual original before claiming this selected destination succeeded.
      const [bound] = await db.select({ owner: tutorialJobs.created_by, channelId: tutorialJobs.channel_id, keywordRef: tutorialJobs.keyword_ref })
        .from(tutorialJobs).where(eq(tutorialJobs.id, result.forge_job_id)).limit(1);
      if (!bound || bound.owner !== session.userId || bound.channelId !== data.channel_id || bound.keywordRef !== data.keyword_ref) {
        return NextResponse.json({ error: "The saved request belongs to a different channel or producer, or cannot be verified here. Open the existing Studio tutorial or ask an Admin to reconcile it; do not create a replacement." }, { status: 409 });
      }
      return NextResponse.json({ jobId: result.forge_job_id, duplicate: result.duplicate ?? false }, { status: 200 });
    } catch (error) {
      if (error instanceof KeywordToolError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }
  const parsed = CreateSchema.safeParse(incoming);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const data = parsed.data;
  const destination = await getProductionChannelAccess(session.userId, data.channel_id);
  if (!destination) return NextResponse.json({ error: "This channel is not assigned to you for production. Ask an Admin to check your channel assignments." }, { status: 403 });
  if (data.language && data.language !== destination.language) return NextResponse.json({ error: "The tutorial language must match its assigned channel." }, { status: 400 });
  data.language = destination.language;

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
      .select({ id: tutorialJobs.id, status: tutorialJobs.status, owner: tutorialJobs.created_by, channelId: tutorialJobs.channel_id })
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
    if (existing && existing.owner !== session.userId) return NextResponse.json({ error: "This keyword is already assigned to another producer." }, { status: 409 });
    if (existing && existing.channelId !== data.channel_id) return NextResponse.json({ error: "This keyword is already bound to another channel." }, { status: 409 });
    if (existing && existing.status !== "QUEUED") {
      return NextResponse.json(
        {
          jobId: existing.id, duplicate: true, status: existing.status,
        },
        { status: 200 },
      );
    }
  }

  const intake = await createOrReuseTutorialJob(db, {
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
  const job = intake.job;
  if (!job) return NextResponse.json({ error: "This keyword already belongs to another producer or channel." }, { status: 409 });
  if (!intake.created && job.status !== "QUEUED") return NextResponse.json({ jobId: job.id, duplicate: true, status: job.status });

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
  return NextResponse.json({ jobId: job.id, duplicate: !intake.created }, { status: intake.created ? 201 : 200 });
}
