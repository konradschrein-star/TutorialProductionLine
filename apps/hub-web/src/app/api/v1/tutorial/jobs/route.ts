import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { resolveTutorialIntakePrincipal, ApiAuthError } from "@/app/api/_lib/auth";
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
 * at /api/production/jobs. Identity-v2 uses the dedicated source-bound
 * KT_INGEST_TOKEN; legacy v1 may use CF_API_TOKEN during migration.
 *
 * The shared createOrReuseTutorialJob helper preserves a stable intake identity
 * across retries. Producer and channel assignment are validated before intake;
 * no administrator or random language channel is used as a fallback.
 */

const CanonicalUuid = z.string().uuid().transform((value) => value.toLowerCase());

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
  channel_id: CanonicalUuid.optional(),
  // The KT operator who clicked Produce. Used to attribute created_by when it
  // maps to a real hub user.
  claimed_by_email: z.string().optional(),
  identity: z.object({
    schema_version: z.literal(2),
    external_source: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,99}$/),
    request_id: CanonicalUuid,
    production_run_id: CanonicalUuid,
    opportunity_id: CanonicalUuid,
    family_id: CanonicalUuid,
    evidence_id: CanonicalUuid,
    route_decision_id: CanonicalUuid,
  }).strict().optional(),
}).strict().superRefine((data, context) => {
  if (data.identity && (!data.channel_id || !data.language)) {
    context.addIssue({
      code: "custom",
      path: ["identity"],
      message: "Identity v2 requires the Keyword Tool's frozen channel_id and language.",
    });
  }
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // Auth: REQUIRE a machine principal. Identity-v2 is checked below for the
  // route-scoped source-bound credential; a browser session never suffices.
  let principal;
  try {
    principal = await resolveTutorialIntakePrincipal(req);
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
          "This endpoint requires a machine bearer token.",
      },
      { status: 401 },
    );
  }

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const data = parsed.data;
  const identity = data.identity;
  if (identity && principal.externalSource !== identity.external_source) {
    return NextResponse.json(
      { error: "Identity v2 requires its dedicated source-bound ingestion credential." },
      { status: 403 },
    );
  }
  if (!identity && principal.externalSource) {
    return NextResponse.json(
      { error: "The source-bound ingestion credential requires an identity-v2 request." },
      { status: 400 },
    );
  }
  const requestId = req.headers.get("idempotency-key")?.trim();
  if (identity && requestId !== identity.request_id) {
    return NextResponse.json(
      { error: "Identity v2 requires Idempotency-Key to equal identity.request_id." },
      { status: 400 },
    );
  }
  const requestHash = identity
    ? createHash("sha256").update(canonicalJson(data)).digest("hex")
    : null;

  // An accepted identity-v2 request is immutable. Return an exact replay
  // before consulting mutable user/channel configuration; revoking future
  // access must not turn a successful but lost acknowledgement into a new job.
  if (identity) {
    const candidates = await db.select().from(tutorialJobs).where(and(
      eq(tutorialJobs.external_source, identity.external_source),
      or(
        eq(tutorialJobs.external_production_run_id, identity.production_run_id),
        eq(tutorialJobs.intake_request_id, identity.request_id),
      ),
      isNull(tutorialJobs.source_job_id),
    )).orderBy(asc(tutorialJobs.created_at)).limit(2);
    if (candidates.length > 0) {
      const exact = candidates.find((candidate) =>
        candidate.external_production_run_id === identity.production_run_id
        && candidate.intake_request_id === identity.request_id
        && candidate.intake_request_hash === requestHash,
      );
      if (!exact || candidates.some((candidate) => candidate.id !== exact.id)) {
        return NextResponse.json(
          {
            error: "The request or production-run identity is already bound to different work.",
            jobId: candidates[0]?.id,
            reconciliationRequired: true,
          },
          { status: 409 },
        );
      }
      return NextResponse.json({
        jobId: exact.id,
        duplicate: true,
        status: exact.status,
        channelResolved: true,
        identityVersion: 2,
        requestId: identity.request_id,
        productionRunId: identity.production_run_id,
        dispatchDurable: true,
      });
    }
  }

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
  const [existing] = identity ? [] : await db.select().from(tutorialJobs)
    .where(and(eq(tutorialJobs.keyword_ref, data.keyword_ref), isNull(tutorialJobs.source_job_id)))
    .orderBy(asc(tutorialJobs.created_at)).limit(1);
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
    external_source: identity?.external_source,
    external_production_run_id: identity?.production_run_id,
    external_opportunity_id: identity?.opportunity_id,
    external_family_id: identity?.family_id,
    external_route_decision_id: identity?.route_decision_id,
    external_evidence_id: identity?.evidence_id,
    intake_request_id: identity?.request_id,
    intake_request_hash: requestHash ?? undefined,
    external_route_snapshot: identity ? {
      schemaVersion: identity.schema_version,
      routeDecisionId: identity.route_decision_id,
      channelId,
      language: destination.language,
      format: data.mode,
    } : undefined,
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
  if (!job) {
    if (identity) {
      const [candidate] = await db.select({ id: tutorialJobs.id }).from(tutorialJobs).where(and(
        eq(tutorialJobs.external_source, identity.external_source),
        or(
          eq(tutorialJobs.external_production_run_id, identity.production_run_id),
          eq(tutorialJobs.intake_request_id, identity.request_id),
        ),
        isNull(tutorialJobs.source_job_id),
      )).limit(1);
      return NextResponse.json({
        error: "The request or production-run identity is already bound to different work.",
        jobId: candidate?.id,
        reconciliationRequired: true,
      }, { status: 409 });
    }
    return NextResponse.json({ error: "This keyword already belongs to another producer or channel." }, { status: 409 });
  }
  if (!intake.created && job.status !== "QUEUED") return NextResponse.json({ jobId: job.id, duplicate: true, status: job.status });

  if (identity) {
    return NextResponse.json(
      {
        jobId: job.id,
        duplicate: !intake.created,
        channelResolved: true,
        identityVersion: 2,
        requestId: identity.request_id,
        productionRunId: identity.production_run_id,
        dispatchDurable: true,
      },
      { status: intake.created ? 201 : 200 },
    );
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

  return NextResponse.json(
    {
      jobId: job.id,
      duplicate: !intake.created,
      channelResolved: true,
      identityVersion: 1,
    },
    { status: intake.created ? 201 : 200 },
  );
}
