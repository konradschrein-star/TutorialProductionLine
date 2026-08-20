import type { NextRequest } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { createTutorialJob, tutorialJobs, users } from "@repo/db";
import {
  createRedisConnection,
  createTutorialGenerateQueue,
} from "@repo/queue";
import { VoiceSettingsSchema } from "@repo/contracts";
import { CfApiError } from "@repo/cf-api";
import { withApiAuth } from "../../_lib/auth";
import { getV1Runtime } from "../../_lib/runtime";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/tutorial/jobs
 *
 * Bearer-gated parallel to POST /api/production/jobs. TUTORIAL_STUDIO uses
 * its own tutorial_jobs table + queue-tutorial-generate lane (not the
 * content_jobs / queue-ingest path most formats use), so it needs its own
 * v1 entry point.
 *
 * The session-cookie endpoint sets created_by from the logged-in user. For
 * machine principals we don't have one, so:
 *   - the body MAY pass `created_by` explicitly (UUID), or
 *   - the env CF_SYSTEM_USER_ID is used as the system actor.
 * If neither is set, 412 — production cannot run anonymously.
 */
const CreateSchema = z.object({
  title: z.string().min(1),
  mode: z.enum(["THREE_MIN", "SIX_MIN", "SIX_MIN_STITCH"]),
  steps_input: z.string().default(""),
  prompt_preset_id: z.string().uuid().optional(),
  custom_prompt: z.string().optional(),
  script_provider: z.string().min(1),
  script_model: z.string().optional(),
  tts_provider: z.string().min(1),
  tts_voice: z.string().min(1),
  batch_id: z.string().uuid().optional(),
  voice_settings: VoiceSettingsSchema.optional(),
  target_minutes: z.number().int().positive().optional(),
  ref_video_seconds: z.number().int().positive().optional(),
  created_by: z.string().uuid().optional(),
  /**
   * WHO PRESSED THE BUTTON — not who created the keyword.
   *
   * An HTTP call from the Keyword Tool carries a shared bearer token and no
   * user, so unless the caller names the acting assistant, every job it starts
   * is owned by one configured account. That is not cosmetic: ownership decides
   * who sees a video in their Review tab, and who may download or delete it.
   *
   * Email is the right handle because it is the SAME handle on both sides —
   * these are the same humans in two tables, joined by address. The Keyword
   * Tool does not know Content Forge user ids and should not have to.
   */
  actor_email: z.string().email().optional(),
  /** @deprecated Misleading name — read as "who created the keyword". Use
   *  `actor_email`. Still accepted so an older caller keeps working. */
  created_by_email: z.string().email().optional(),
  channel_id: z.string().uuid().optional(),
  // Video ERP cross-reference — set when the Keyword Tool creates the job.
  keyword_ref: z.string().min(1).optional(),
  kt_url: z.string().url().optional(),
  // Script source: research-based write vs rewrite of a reference transcript.
  // This is how the Keyword Tool sends transcript-rewrite jobs.
  //
  // `reference_transcript` is now OPTIONAL for TRANSCRIPT_REWRITE: given
  // `reference_url`, the worker fetches the source video's captions itself
  // (utils/tutorial/source-transcript.ts). The Keyword Tool may still push a
  // transcript it already holds, and that one wins.
  source_mode: z
    .enum(["FROM_SCRATCH", "TRANSCRIPT_REWRITE"])
    .default("FROM_SCRATCH"),
  reference_url: z.string().optional(),
  reference_transcript: z.string().optional(),
  // Target spoken language (default English).
  language: z.string().optional(),
});

export async function POST(req: NextRequest) {
  return withApiAuth(req, async () => {
    const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new CfApiError(
        "BAD_REQUEST",
        "Invalid TUTORIAL_STUDIO payload",
        parsed.error.flatten(),
      );
    }
    const data = parsed.data;

    if (!data.prompt_preset_id && !data.custom_prompt?.trim()) {
      throw new CfApiError(
        "BAD_REQUEST",
        "Pick a prompt_preset_id or supply a custom_prompt — got neither.",
      );
    }

    // A rewrite with nothing to rewrite from used to be accepted here and then
    // silently produced a from-scratch script three stages later. Reject it at
    // the edge: one of the two source fields is mandatory, and reference_url is
    // enough because the worker fetches the transcript from it.
    if (
      data.source_mode === "TRANSCRIPT_REWRITE" &&
      !data.reference_url?.trim() &&
      !data.reference_transcript?.trim()
    ) {
      throw new CfApiError(
        "BAD_REQUEST",
        "source_mode=TRANSCRIPT_REWRITE needs a reference_url (the transcript is fetched " +
          "from it automatically) or an explicit reference_transcript — got neither.",
      );
    }

    // Duplicate guard. `tutorial_jobs.keyword_ref` is indexed but NOT unique, so a double
    // click in the Keyword Tool — or a retry after a timed-out response — silently created a
    // second full job for the same keyword and paid for the whole pipeline twice. Reject a
    // repeat while an earlier job for that keyword is still alive or already finished; only
    // failed/cancelled jobs may be re-sent. KT surfaces the 409 as "already sent to
    // production", matching the check it already does on its own side (kt_keywords.forge_job_id).
    if (data.keyword_ref) {
      const existing = await db
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
      if (existing.length > 0) {
        throw new CfApiError(
          "CONFLICT",
          `keyword_ref "${data.keyword_ref}" already has tutorial job ${existing[0]!.id} ` +
            `(status ${existing[0]!.status}). Re-sending would duplicate the video and the spend. ` +
            `Cancel that job first, or omit keyword_ref for a deliberate second take.`,
        );
      }
    }

    /**
     * Owner and channel, resolved together — because on this route the channel
     * comes FROM the owner.
     *
     * Owner: an explicit uuid, else the named assistant's account, else the
     * configured system actor. Ownership is not cosmetic — the Review tab and
     * the download and delete routes are all scoped by it, so a job attributed
     * to the wrong person is invisible to the person who made it.
     *
     * Channel: a tutorial with no channel gets a Drive folder literally named
     * `_no-channel`, no thumbnail styling, no channel voice, and no record of
     * which of three brands it was made for — the state 96% of the table is
     * already in. The Keyword Tool sends no channel_id at all, so every job it
     * produced would land there.
     *
     * The fix is deliberately NOT a server-wide default channel. The owner:
     * "that's something the VA should decide and they get instructions from my
     * friend who is actually running this whole thing." One global default
     * would attribute one assistant's video to the brand a different assistant
     * was told to work on. So it falls back to the PRODUCING ASSISTANT's own
     * channel (users.default_tutorial_channel_id, which the Create form keeps
     * up to date), and refuses if they have never picked one.
     */
    let createdBy = data.created_by ?? null;
    let ownerDefaultChannel: string | null = null;
    let ownerLabel = "the system account";

    const actorEmail = data.actor_email ?? data.created_by_email;
    if (actorEmail) {
      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          channel: users.default_tutorial_channel_id,
        })
        .from(users)
        .where(eq(users.email, actorEmail.toLowerCase()))
        .limit(1);
      if (!user) {
        throw new CfApiError(
          "FAILED_PRECONDITION",
          `No Content Forge user with email "${actorEmail}". ` +
            `The job was NOT created — assigning it to the wrong person is worse ` +
            `than failing, because ownership decides who can see and delete it.`,
        );
      }
      createdBy = createdBy ?? user.id;
      ownerDefaultChannel = user.channel;
      ownerLabel = user.name;
    } else if (createdBy) {
      const [user] = await db
        .select({
          name: users.name,
          channel: users.default_tutorial_channel_id,
        })
        .from(users)
        .where(eq(users.id, createdBy))
        .limit(1);
      ownerDefaultChannel = user?.channel ?? null;
      ownerLabel = user?.name ?? ownerLabel;
    }

    createdBy = createdBy ?? process.env["CF_SYSTEM_USER_ID"] ?? null;
    if (!createdBy) {
      throw new CfApiError(
        "FAILED_PRECONDITION",
        "Machine principal needs CF_SYSTEM_USER_ID env, `actor_email`, or `created_by` in the body.",
      );
    }

    const channelId = data.channel_id ?? ownerDefaultChannel ?? null;
    if (!channelId) {
      throw new CfApiError(
        "FAILED_PRECONDITION",
        `No channel for this job. Pass \`channel_id\`, or have ${ownerLabel} pick a channel ` +
          `once in Tutorial Studio → Create — it is remembered and used for anything they ` +
          `produce from the keyword board. A channel decides the Drive folder, the thumbnail ` +
          `style, the voice and the upload destination, so it is never guessed.`,
      );
    }

    const job = await createTutorialJob(db, {
      created_by: createdBy,
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
      voice_settings: data.voice_settings as
        | Record<string, unknown>
        | undefined,
      target_minutes: data.target_minutes,
      ref_video_seconds: data.ref_video_seconds,
      channel_id: channelId,
      keyword_ref: data.keyword_ref,
      kt_url: data.kt_url,
      source_mode: data.source_mode,
      reference_url: data.reference_url,
      reference_transcript: data.reference_transcript,
      language: data.language,
    });

    const { redisUrl } = getV1Runtime();
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

    return { jobId: job.id, status: "QUEUED", stage: "script" };
  });
}
