import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { channels, db, thumbnails, tutorialJobs, tutorialSourceRevision, tutorialThumbnailFanout } from "@/lib/db";
import { englishThumbnailApprovalRevision } from "@repo/db";
import { fingerprintStorageSource } from "@repo/storage";
import { withTutorialAsset } from "@/lib/tutorial/media-access";
import { assessTutorialThumbnailSelection } from "@/lib/tutorial/thumbnail-selection";
import { localizationTargets } from "@/lib/tutorial/localization-targets";
import {
  createRedisConnection,
  createTutorialTranslateQueue,
} from "@repo/queue";
import {
  normalizeTutorialLanguage,
  type TutorialTranslatePayload,
} from "@repo/contracts";

export const dynamic = "force-dynamic";

const EnqueueSchema = z.object({
  sourceJobId: z.string().uuid(),
  languages: z.array(z.string()).min(1),
  mode: z.enum(["automatic", "manual"]).default("manual"),
});
type TargetLanguage = TutorialTranslatePayload["targetLanguage"];

/**
 * Fan out one tutorial-translate queue job per requested language for a
 * COMPLETED English source tutorial. Thin enqueue: the translate processor does
 * the LLM translate + TTS, creates a child tutorial_job, and hands off to the
 * existing splice lane. Skips a language whose child already exists.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = EnqueueSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { sourceJobId, languages, mode } = parsed.data;

  if (languages.some((language) => !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(language))) {
    return NextResponse.json(
      {
        error: "Language codes must use the configured channel language format.",
      },
      { status: 400 },
    );
  }

  // A translation destination is authorized by the explicit channel profile
  // below, not by a source-code list that has to be redeployed for each locale.
  const requested = Array.from(
    new Set(languages),
  );
  if (requested.length === 0) {
    return NextResponse.json(
      {
        error: "No configured languages requested.",
      },
      { status: 400 },
    );
  }

  if (mode === "manual" && requested.length !== 1) {
    return NextResponse.json(
      { error: "Manual translation requests must select exactly one language" },
      { status: 400 },
    );
  }

  // Source must exist and be a COMPLETED original (not itself a translation).
  const [source] = await db
    .select({
      id: tutorialJobs.id,
      createdBy: tutorialJobs.created_by,
      status: tutorialJobs.status,
      recordingPath: tutorialJobs.recording_path,
      finalPath: tutorialJobs.final_path,
      recordedAt: tutorialJobs.recorded_at,
      scriptText: tutorialJobs.script_text,
      sourceJobId: tutorialJobs.source_job_id,
      language: tutorialJobs.language,
      channelId: tutorialJobs.channel_id,
    })
    .from(tutorialJobs)
    .where(eq(tutorialJobs.id, sourceJobId))
    .limit(1);

  if (!source) {
    return NextResponse.json(
      { error: "source job not found" },
      { status: 404 },
    );
  }
  const privileged = session.role === "ADMIN" || session.role === "MANAGER" ||
    hasPermission(session, "manage:tutorial-settings");
  if (!privileged && source.createdBy !== session.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (source.status !== "COMPLETED") {
    return NextResponse.json(
      { error: `source job is ${source.status}, not COMPLETED` },
      { status: 409 },
    );
  }
  if (
    source.sourceJobId !== null ||
    normalizeTutorialLanguage(source.language) !== "en"
  ) {
    return NextResponse.json(
      { error: "translation source must be an explicit English original" },
      { status: 409 },
    );
  }
  if (!source.recordingPath || !source.scriptText) {
    return NextResponse.json(
      { error: "source job has no recording or script to translate" },
      { status: 409 },
    );
  }

  const channelRows = await db
    .select({ id: channels.id, language: channels.language, isPrimary: channels.is_primary, metadata: channels.metadata })
    .from(channels)
    .where(eq(channels.accepts_tutorials, true));
  const existing = await db.select({ id: tutorialJobs.id, language: tutorialJobs.language, status: tutorialJobs.status, channelId: tutorialJobs.channel_id })
    .from(tutorialJobs).where(eq(tutorialJobs.source_job_id, sourceJobId));
  const configured = localizationTargets(source.channelId, channelRows);
  const configuredLanguages = new Set(configured.map((target) => target.language));
  const unconfigured = requested.filter((language) => !configuredLanguages.has(language));
  if (unconfigured.length) {
    return NextResponse.json(
      {
        error: "Translation destination is not explicitly enabled for this primary channel.",
        reasons: unconfigured.map((language) => `${language}: enable and map this destination in Channels & translations`),
      },
      { status: 409 },
    );
  }
  const channelIssues = requested.flatMap((language) => {
    const assigned = existing.filter((row) => normalizeTutorialLanguage(row.language) === language);
    if (assigned.length > 1) return [`${language}: multiple language records need reconciliation`];
    const matches = channelRows.filter(
      (channel) => configured.some(target => target.channelId === channel.id && target.language === language) && (!assigned[0] || channel.id === assigned[0].channelId),
    );
    return matches.length === 1
      ? []
      : [
          `${language}: ${matches.length === 0 ? "target channel missing" : `target channel ambiguous (${matches.length} matches)`}`,
        ];
  });
  if (channelIssues.length > 0) {
    return NextResponse.json(
      {
        error: "Translation channel configuration is incomplete or ambiguous",
        reasons: channelIssues,
      },
      { status: 409 },
    );
  }

  const approvalOwners = [source, ...existing.filter((row) => requested.includes(normalizeTutorialLanguage(row.language) as TargetLanguage))];
  const selected = await db.select({ id: thumbnails.id, subjectId: thumbnails.subject_id, language: thumbnails.language, channelId: thumbnails.channel_id, status: thumbnails.status, isSelected: thumbnails.is_selected, outputPath: thumbnails.output_path, verdict: thumbnails.review_verdict, generationKind: thumbnails.generation_kind, promptMode: thumbnails.prompt_mode })
    .from(thumbnails).where(and(eq(thumbnails.subject_kind, "tutorial_job"), inArray(thumbnails.subject_id, approvalOwners.map((row) => row.id))));
  const blockers = requested.filter((language) => !existing.some((row) => normalizeTutorialLanguage(row.language) === language))
    .map((language) => `${language}: prepare its thumbnail draft first`);
  for (const owner of approvalOwners) {
    const selection = assessTutorialThumbnailSelection(owner, selected.filter((row) => row.subjectId === owner.id && ["acceptable", "strong"].includes(row.verdict)));
    if (!selection.ready) blockers.push(`${owner.language}: approve its thumbnail before localization`);
  }
  const aiLocalized = selected.filter(row => row.subjectId !== source.id && row.isSelected && (row.generationKind === "localize" || (row.promptMode && row.promptMode !== "manual")));
  if (aiLocalized.length) {
    const master = selected.filter(row => row.subjectId === source.id && row.isSelected && row.status === "completed" && ["acceptable", "strong"].includes(row.verdict));
    const image = master.length === 1 ? master[0] : null;
    if (!image?.outputPath || !image.channelId) blockers.push("English image revision is unavailable for AI-localization verification");
    else {
      try {
        const fingerprint = await withTutorialAsset({ jobId: source.id, kind: "thumbnail", path: image.outputPath }, fingerprintStorageSource);
        const revision = englishThumbnailApprovalRevision({ sourceJobId: source.id, thumbnailId: image.id, sourcePath: image.outputPath, sha256: fingerprint.sha256, size: fingerprint.bytes }, image.channelId);
        const receipts = await db.select().from(tutorialThumbnailFanout).where(and(eq(tutorialThumbnailFanout.source_job_id, source.id), eq(tutorialThumbnailFanout.approval_revision, revision), eq(tutorialThumbnailFanout.state, "completed")));
        for (const locale of aiLocalized) if (!receipts.some(receipt => receipt.output_thumbnail_id === locale.id && receipt.source_thumbnail_id === image.id && receipt.target_channel_id === locale.channelId && receipt.target_language === locale.language)) blockers.push(`${locale.language}: AI thumbnail belongs to an older or unverified English master`);
      } catch { blockers.push("Exact English thumbnail bytes could not be verified; restore and approve them before localizing"); }
    }
  }
  if (blockers.length) return NextResponse.json({ error: "Thumbnail approval is required before localization.", reasons: blockers }, { status: 409 });

  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    return NextResponse.json({ error: "REDIS_URL not set" }, { status: 500 });
  }

  const enqueued: string[] = [];
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const queue = createTutorialTranslateQueue(conn);
    for (const lang of requested) {
      // Skip if a translation child already exists for this language.
      const languageMatches = existing.filter(
        (candidate) => normalizeTutorialLanguage(candidate.language) === lang,
      );
      if (languageMatches.length > 1) {
        return NextResponse.json(
          {
            error: `Translation variant ${lang} is ambiguous (${languageMatches.length} jobs)`,
          },
          { status: 409 },
        );
      }
      const child = languageMatches[0];
      if (child && child.status !== "AWAITING_THUMBNAILS" && child.status !== "CANCELLED" && !child.status.startsWith("FAILED")) continue;

      const queueId = `tutorial-translate-${sourceJobId}-${lang}`;
      const prior = await queue.getJob(queueId);
      if (prior) {
        const state = await prior.getState();
        if (state !== "completed" && state !== "failed") continue;
        await prior.remove();
      }

      await queue.add(
        "tutorial-translate",
        { sourceJobId, targetLanguage: lang,
          sourceRevision: tutorialSourceRevision({ recording_path: source.recordingPath, final_path: source.finalPath, script_text: source.scriptText, recorded_at: source.recordedAt }),
          thumbnailId: selected.find((row) => row.subjectId === child?.id && row.isSelected && row.status === "completed")?.id,
        },
        { jobId: queueId, attempts: 2 },
      );
      enqueued.push(lang);
    }
  } finally {
    await conn.quit();
  }

  return NextResponse.json({ enqueued });
}
