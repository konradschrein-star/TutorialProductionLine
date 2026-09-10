import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { resolvePrincipal, ApiAuthError } from "@/app/api/_lib/auth";
import { db, users, tutorialJobs } from "@/lib/db";
import {
  createOrReuseTutorialJob,
  getTutorialSettings,
  listPromptPresets,
} from "@repo/db";
import {
  createRedisConnection,
  createTutorialGenerateQueue,
} from "@repo/queue";
import { findUserByEmail } from "@/lib/repositories/user-repository";
import { getProductionChannelAccess } from "@/lib/tutorial/channel-access";

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
 * The shared createOrReuseTutorialJob helper preserves a stable intake identity
 * across retries. Producer and channel assignment are validated before intake;
 * no administrator or random language channel is used as a fallback.
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
  steps_input: z.string().max(100000).default(""),
  source_mode: z.enum(["FROM_SCRATCH", "TRANSCRIPT_REWRITE"]).default("FROM_SCRATCH"),
  reference_url: z.string().url().refine(value => /^https?:\/\//i.test(value), "Use an HTTP(S) reference URL").optional(),
  reference_transcript: z.string().max(500000).optional(),
  // Validated against the DB and the producer's authorized channels below.
  channel_id: z.string().optional(),
  // The KT operator who clicked Produce. Used to attribute created_by when it
  // maps to a real hub user.
  claimed_by_email: z.string().optional(),
}).strict().superRefine((data, context) => {
  if (data.source_mode === "TRANSCRIPT_REWRITE" && !data.reference_transcript?.trim() && !data.reference_url) {
    context.addIssue({ code: "custom", path: ["reference_transcript"], message: "Rewrite requires a reference transcript or URL; it will not silently become from-scratch." });
  }
  if (data.source_mode === "TRANSCRIPT_REWRITE") {
    const transcript = data.reference_transcript?.trim();
    if (transcript && transcript.split(/\s+/).length < 80) {
      context.addIssue({ code: "custom", path: ["reference_transcript"], message: "Paste the full reference transcript (at least 80 words), matching Studio's source-quality gate." });
    } else if (!transcript && data.reference_url && URL.canParse(data.reference_url)) {
      const host = new URL(data.reference_url).hostname.toLowerCase();
      if (!(host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com"))) {
        context.addIssue({ code: "custom", path: ["reference_url"], message: "Automatic transcript retrieval supports YouTube only; otherwise paste the full transcript." });
      }
    }
  }
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

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const data = parsed.data;

  // Attribute production only to the actual active operator supplied by KT.
  const claimed = data.claimed_by_email ? await findUserByEmail(data.claimed_by_email) : null;
  if (!claimed?.isActive) return NextResponse.json({ error: "claimed_by_email must identify an active Studio producer. No fallback owner will be assigned." }, { status: 422 });
  const createdBy = claimed.id;

  // Use the upstream channel or the producer's configured default, then enforce
  // explicit channel access. Language alone never chooses a destination.
  const [operator] = await db.select().from(users).where(eq(users.id, createdBy)).limit(1);
  const channelId = data.channel_id ?? operator?.default_tutorial_channel_id;
  if (!channelId || !UUID_RE.test(channelId)) return NextResponse.json({ error: "Provide the keyword's assigned channel_id, or configure the producer's default channel." }, { status: 422 });
  const destination = await getProductionChannelAccess(createdBy, channelId);
  if (!destination) return NextResponse.json({ error: "The keyword's channel is not assigned to this producer or is not enabled for original tutorials." }, { status: 403 });
  if (data.language && data.language !== destination.language) return NextResponse.json({ error: "Language must match the keyword's assigned channel." }, { status: 422 });

  // A saved job owns its frozen recipe. A later missing/changed default preset
  // must not prevent recovery of the original accepted intake.
  const [existing] = await db.select().from(tutorialJobs).where(and(
    eq(tutorialJobs.keyword_ref, data.keyword_ref), isNull(tutorialJobs.source_job_id),
  )).orderBy(asc(tutorialJobs.created_at)).limit(1);
  if (existing && (existing.created_by !== createdBy || existing.channel_id !== channelId)) {
    return NextResponse.json({ error: "This keyword already belongs to another producer or channel." }, { status: 409 });
  }
  let intake;
  if (existing) {
    intake = { job: existing, created: false };
  } else {

  // Required provider fields (script_provider, tts_provider, tts_voice are NOT
  // NULL). Fill from the single-row tutorial settings defaults. An empty
  // default_tts_voice is passed through unchanged — the worker resolves the
  // real voice (per-channel voice binding), matching the browser route.
  const settings = await getTutorialSettings(db);

  // Prompt/provider/voice selection belongs to Studio Admin settings, not KT.
  // Reject missing defaults before queuing an unrecoverable script job.
  const presets = await listPromptPresets(db);
  const defaultPreset = presets.find((p) => p.is_default);
  if (!defaultPreset) {
    return NextResponse.json(
      {
        error: "A Studio Admin must configure a default tutorial prompt preset before new intake.",
      },
      { status: 400 },
    );
  }

  intake = await createOrReuseTutorialJob(db, {
    created_by: createdBy,
    keyword_ref: data.keyword_ref,
    kt_url: data.kt_url,
    batch_id: randomUUID(),
    title: data.title,
    mode: data.mode,
    steps_input: data.steps_input,
    prompt_preset_id: defaultPreset.id,
    script_provider: settings.default_script_provider,
    script_model: settings.default_script_model ?? undefined,
    tts_provider: settings.default_tts_provider,
    tts_voice: settings.default_tts_voice,
    channel_id: channelId,
    source_mode: data.source_mode,
    reference_url: data.reference_url,
    reference_transcript: data.reference_transcript,
    language: destination.language,
  });
  }
  const job = intake.job;
  if (!job) return NextResponse.json({ error: "This keyword already belongs to another producer or channel." }, { status: 409 });
  if (!intake.created && job.status !== "QUEUED") return NextResponse.json({ jobId: job.id, duplicate: true, status: job.status });

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

  return NextResponse.json(
    {
      jobId: job.id,
      duplicate: !intake.created,
      channelResolved: true,
    },
    { status: intake.created ? 201 : 200 },
  );
}
