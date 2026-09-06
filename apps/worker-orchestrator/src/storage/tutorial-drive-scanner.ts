import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { normalizeTutorialLanguage } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import {
  getTutorialJobById,
  tutorialJobs,
  tutorialSettings,
  channels,
  thumbnails,
  storageArtifacts,
} from "@repo/db";
import {
  ArtifactStore,
  buildMetadataSidecarV2,
  buildUploadSheet,
  buildTranscriptDoc,
  collectFinishedTutorialArtifacts,
  planTutorialFolder,
  planTutorialArchiveFolder,
  tutorialCompletionDate,
  wordCount,
  ARTIFACT_FILENAMES,
  TUTORIAL_ARCHIVE_FOLDER_NAME,
  TranscriptUnavailableError,
  ensureArtifactRow,
  getArtifact,
  markSkipped,
  resetForRetry,
  type FinishedTutorialRow,
} from "@repo/storage";
import { logger } from "@repo/logger";
import { writeFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Tutorial Drive scanner.
 *
 * Tutorials are a SEPARATE operation (D7): they live in their own `_Tutorials/`
 * tree and additionally archive the raw screen recording, because a laptop
 * translation pipeline consumes raw video + transcript. The finished tutorial's
 * script IS the transcript (tts_script_exact) — we synthesised the audio from
 * it, so no re-transcription is needed.
 *
 * `tutorial_jobs.delivered_to_drive` is the fast "already done" flag (GD-12);
 * `storage_artifacts` stays the source of truth.
 */

interface TutorialCandidate extends FinishedTutorialRow {
  channel_name: string | null;
  /** Output QA verdict (migration 0064). NULL = never checked. */
  output_qa_status: string | null;
  /** TTS length = the EXPECTED finished length. Often null; see passesOutputQa. */
  audio_duration_s: string | number | null;
  is_uploaded: boolean;
  source_job_id: string | null;
}

/**
 * `tutorial_settings.drive_autoupload_enabled` — the operator's on/off switch
 * for THIS lane (content jobs are unaffected).
 *
 * It was previously a column the Studio UI could set and nothing read: a
 * toggle that did nothing. It now gates the tutorial pass, which is what its
 * name always claimed.
 *
 * It DEFAULTS TO FALSE in the database, so a freshly authenticated Drive will
 * upload content jobs and skip tutorials until it is flipped. That is the
 * honest reading of an explicit opt-in switch, but it is also exactly the kind
 * of thing that looks like a broken uploader — so the caller logs the reason
 * and the exact SQL every time it declines. No settings row at all means "not
 * configured yet", which we treat as ON: absence of an opinion must not
 * silently disable delivery.
 */
async function tutorialAutoUploadEnabled(db: DrizzleClient): Promise<boolean> {
  const [row] = await db
    .select({ enabled: tutorialSettings.drive_autoupload_enabled })
    .from(tutorialSettings)
    .limit(1);
  return row === undefined ? true : row.enabled;
}

/**
 * Default ceiling on delivery attempts per artefact.
 *
 * The content lane already treats an artefact as SETTLED once it is uploaded,
 * skipped, or failed `maxAttemptsPerArtifact` times
 * (`finished-job-scanner.ts`). The tutorial lane was copied from it and lost
 * the ceiling, so a tutorial whose upload fails permanently — a corrupt file, a
 * path that no longer exists — was retried on every pass, forever, occupying a
 * batch slot and burning Drive quota while healthy jobs queued behind it.
 */
const DEFAULT_MAX_ATTEMPTS_PER_ARTIFACT = 5;

async function findTutorialCandidates(
  db: DrizzleClient,
  batchSize: number,
  maxAttemptsPerArtifact: number,
): Promise<TutorialCandidate[]> {
  // DERIVED eligibility, matching the content lane. `delivered_to_drive` stays
  // as the cheap UI flag, but it is a hand-written boolean with a history of
  // being set without an upload actually happening, so it must not be the only
  // thing standing between a job and a redundant re-upload.
  const settled = db
    .select({ job_id: storageArtifacts.job_id })
    .from(storageArtifacts)
    .where(
      and(
        eq(storageArtifacts.kind, "final_video"),
        eq(storageArtifacts.owner_kind, "tutorial_job"),
        or(
          eq(storageArtifacts.state, "uploaded"),
          eq(storageArtifacts.state, "skipped"),
          and(
            eq(storageArtifacts.state, "failed"),
            gte(storageArtifacts.attempts, maxAttemptsPerArtifact),
          ),
        ),
      ),
    );

  const rows = await db
    .select({
      id: tutorialJobs.id,
      status: tutorialJobs.status,
      channel_id: tutorialJobs.channel_id,
      channel_name: channels.name,
      title: tutorialJobs.title,
      language: tutorialJobs.language,
      final_path: tutorialJobs.final_path,
      recording_path: tutorialJobs.recording_path,
      recording_duration_s: tutorialJobs.recording_duration_s,
      script_text: tutorialJobs.script_text,
      script_provider: tutorialJobs.script_provider,
      script_model: tutorialJobs.script_model,
      created_at: tutorialJobs.created_at,
      script_done_at: tutorialJobs.script_done_at,
      source_job_id: tutorialJobs.source_job_id,
      output_qa_status: tutorialJobs.output_qa_status,
      audio_duration_s: tutorialJobs.audio_duration_s,
      description: tutorialJobs.description,
      tags: tutorialJobs.tags,
      is_uploaded: tutorialJobs.is_uploaded,
    })
    .from(tutorialJobs)
    .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
    .where(
      and(
        eq(tutorialJobs.status, "COMPLETED"),
        eq(tutorialJobs.delivered_to_drive, false),
        isNotNull(tutorialJobs.final_path),
        // A video already held by output QA is excluded in SQL, not just
        // skipped in code: otherwise a permanently-broken render would occupy
        // a slot in every batch forever and starve healthy jobs behind it.
        // NULL means "never checked" and must stay eligible — the 2,037
        // tutorials that predate the gate are not retroactively failed.
        or(
          isNull(tutorialJobs.output_qa_status),
          ne(tutorialJobs.output_qa_status, "failed"),
        ),
        notInArray(tutorialJobs.id, settled),
      ),
    )
    .orderBy(desc(tutorialJobs.created_at))
    .limit(batchSize);

  return rows.map((r) => ({
    ...r,
    recording_duration_s:
      r.recording_duration_s !== null ? Number(r.recording_duration_s) : null,
  })) as TutorialCandidate[];
}

/**
 * Resolve the thumbnail to ship for a tutorial.
 *
 * `thumbnails` is polymorphic (`subject_kind` + `subject_id`, no FK), so this
 * cannot be a join on tutorial_jobs and there is no thumbnail column to read.
 * That is precisely why tutorial thumbnails were generated and then never
 * delivered: nothing in the Drive path knew where to look.
 *
 * Only the operator/rule-selected completed thumbnail for this exact language
 * and channel is eligible. Returns null when ownership is missing or ambiguous;
 * no latest-completed or cross-language fallback is allowed.
 */
async function findTutorialThumbnail(
  db: DrizzleClient,
  tutorialJobId: string,
  jobLanguage: string | null,
  channelId: string | null,
): Promise<string | null> {
  const language = normalizeTutorialLanguage(jobLanguage);
  if (!language || !channelId) return null;
  const rows = await db
    .select({
      id: thumbnails.id,
      output_path: thumbnails.output_path,
      language: thumbnails.language,
      channel_id: thumbnails.channel_id,
    })
    .from(thumbnails)
    .where(
      and(
        eq(thumbnails.subject_kind, "tutorial_job"),
        eq(thumbnails.subject_id, tutorialJobId),
        eq(thumbnails.status, "completed"),
        eq(thumbnails.is_selected, true),
        isNotNull(thumbnails.output_path),
      ),
    );

  const owned = rows.filter(
    (row) =>
      normalizeTutorialLanguage(row.language) === language &&
      row.channel_id === channelId,
  );
  if (owned.length !== 1) {
    logger.warn(
      {
        jobId: tutorialJobId,
        language,
        channelId,
        selectedCount: owned.length,
      },
      "tutorial thumbnail ownership is missing or ambiguous; Drive delivery skipped",
    );
    return null;
  }
  return owned[0]!.output_path;
}

/** Recorded on the settled row, and the handle for undoing this in one SQL. */
const ARTIFACT_MISSING_REASON =
  "artifact missing on disk — the media was collected before it was ever " +
  "delivered to Drive, so there is nothing left to upload";

/**
 * SETTLE a tutorial whose video file no longer exists.
 *
 * The bug this fixes, measured on production: the scanner logged
 * "tutorial artifact MISSING on disk" 33,188 times into a 14 MB log and every
 * single pass reported `jobs:25 uploaded:0 failed:0 skipped:25`. It had made
 * exactly zero progress for weeks and would never have made any.
 *
 * WHY it span forever: eligibility is derived (`findTutorialCandidates`), and a
 * job leaves the candidate set only when a `storage_artifacts` row says the
 * final video is uploaded, skipped, or failed `maxAttemptsPerArtifact` times.
 * The missing-file branch above returns BEFORE `pushTutorial` calls
 * `putFinalArtifact`, so no artefact row was ever created — the one mechanism
 * that could have settled these jobs was the mechanism being skipped. 1,174
 * rows therefore stayed permanently eligible, and because the batch is ordered
 * newest-first and every healthy job is already delivered, all 25 slots in
 * every pass were consumed by the same dead rows.
 *
 * WHY 'skipped' and not a QA failure or a status change:
 *  - `output_qa_status = 'failed'` would say the video is BAD. There is no
 *    video. The comment above this function already argues that at length and
 *    it is still right — this does not touch that column.
 *  - `delivered_to_drive = true` would be a lie: nothing was delivered.
 *  - There is no terminal enum value that means "completed, media gone", and
 *    inventing one would rewrite history for 1,174 finished videos that really
 *    were produced. `tutorial_jobs.status` stays COMPLETED because it is true.
 *
 * `skipped` is the lane's own existing word for "settled, deliberately not
 * uploaded" (939 tutorial artefacts already carry it) and it keeps the reason
 * in `error_message`, so the state is honest and legible rather than silent.
 *
 * REVERSIBLE in one statement — the rows become candidates again immediately:
 *   DELETE FROM storage_artifacts
 *   WHERE owner_kind = 'tutorial_job' AND kind = 'final_video'
 *     AND state = 'skipped' AND error_message LIKE 'artifact missing on disk%';
 *
 * No backfill script and no migration is needed: the scanner drains itself at
 * 25 rows per pass once this ships.
 */
async function settleMissingArtifact(
  db: DrizzleClient,
  job: TutorialCandidate,
  videoPath: string,
): Promise<void> {
  try {
    const row = await ensureArtifactRow(db, {
      job_id: job.id,
      kind: "final_video",
      filename: ARTIFACT_FILENAMES.final_video,
      vps_path: videoPath,
      channel_id: job.channel_id,
      owner_kind: "tutorial_job",
      language: job.language ?? null,
      source_job_id: null,
    });
    await markSkipped(db, row.id, ARTIFACT_MISSING_REASON);
    logger.warn(
      { jobId: job.id, videoPath, artifactId: row.id },
      "tutorial artifact MISSING on disk — settled as skipped so it stops " +
        "being retried; no QA verdict recorded (no video is not a bad video)",
    );
  } catch (err) {
    // Settling is best-effort. If it fails the job simply stays eligible and
    // we are no worse off than before — but say so, loudly, because a
    // persistent failure here brings the infinite retry back.
    logger.error(
      {
        jobId: job.id,
        videoPath,
        err: err instanceof Error ? err.message : String(err),
      },
      "tutorial artifact MISSING on disk and could NOT be settled — this job " +
        "will be retried on the next pass",
    );
  }
}

/**
 * Output QA gate — the last thing between a rendered tutorial and Google Drive.
 *
 * Returns true when delivery may proceed. A `false` return means the file was
 * probed and found broken (frozen picture, black screen, silent audio); the
 * verdict is persisted so the VA review tab can show the reason and so the next
 * scan pass does not re-decode the same file.
 *
 * Deliberate choices:
 *  - A video that has ALREADY passed is not re-probed (`output_qa_status`).
 *  - The video is never deleted or failed. It simply does not ship, and a human
 *    decides — per the owner's instruction that nothing auto-deletes.
 *  - If the probe THROWS (unreadable file, ffmpeg missing) delivery is blocked
 *    and the error recorded. Shipping an unprobeable file would defeat the gate;
 *    "we could not check it" is not "it is fine".
 */
async function passesOutputQa(
  db: DrizzleClient,
  job: TutorialCandidate,
  mediaRoot: string,
): Promise<boolean> {
  if (job.output_qa_status === "passed") return true;
  if (job.output_qa_status === "failed") {
    logger.warn(
      { jobId: job.id },
      "tutorial held by output QA — not delivering to Drive",
    );
    return false;
  }

  const artifacts = collectFinishedTutorialArtifacts(job, mediaRoot);
  const finalVideo = artifacts.find((a) => a.kind === "final_video");
  if (!finalVideo) return true; // nothing to check; the push loop reports it

  // A MISSING FILE IS NOT A QUALITY VERDICT.
  //
  // Found the hard way on production: 1,177 tutorials are COMPLETED with a
  // final_path whose file no longer exists on disk. The first version of this
  // gate ran ffprobe on them, got "Command failed", and recorded
  // output_qa_status='failed' — which is wrong twice over. It says the video is
  // bad when the truth is there is no video, and because failed rows are
  // excluded from the candidate query it buried 1,177 rows behind a label that
  // misdescribes them.
  //
  // Artifact existence belongs to the upload path, which has always reported it
  // (and now settles it via the attempt ceiling). This gate only judges files
  // it can actually see.
  try {
    await stat(finalVideo.localPath);
  } catch {
    await settleMissingArtifact(db, job, finalVideo.localPath);
    return false;
  }

  const { runVideoQaGate, logVideoQaResult, SCREEN_RECORDING_QA_THRESHOLDS } =
    await import("@repo/media-core");

  let verdict: Awaited<ReturnType<typeof runVideoQaGate>> | null = null;
  let probeError: string | null = null;
  try {
    // Screen-recording thresholds: the frozen check is off because a static
    // screen is the expected picture for a tutorial (see the preset's doc).
    // Duration, black, silence and stream checks all still apply — and it is
    // duration that catches the real tutorial defect.
    // NO duration expectation from `recording_duration_s`.
    //
    // That column is the length of the VA's SOURCE RECORDING, not the expected
    // length of the finished video. Splice deliberately TIME-SCALES the
    // recording to fit the narration
    // (`factor = ttsDuration / effectiveRecording`, splice.ts), so the output is
    // legitimately longer than the recording — measured across production, the
    // average stretch is 1.78x and the range is 0.78x to 2.51x.
    //
    // Comparing the two flagged three tutorials at "~97% longer than expected"
    // and would have flagged essentially every tutorial as the backlog drained:
    // the same class of false positive as the frozen thresholds, from the same
    // root cause — a format-agnostic gate fed a format-inappropriate input.
    //
    // `audio_duration_s` IS the expected output length, but it is populated on
    // only 190 of 2,037 completed jobs, so it is used when present and the check
    // is skipped otherwise. A skipped check is honest; a check that fires on
    // everything gets ignored, or worse, blocks everything.
    verdict = await runVideoQaGate(
      finalVideo.localPath,
      {
        ...(job.audio_duration_s != null
          ? { durationSeconds: Number(job.audio_duration_s) }
          : {}),
        requireAudio: true,
      },
      SCREEN_RECORDING_QA_THRESHOLDS,
    );
    logVideoQaResult(verdict, {
      jobId: job.id,
      format: "TUTORIAL",
      videoPath: finalVideo.localPath,
    });
  } catch (err) {
    probeError = err instanceof Error ? err.message : String(err);
  }

  // A PROBE THAT THREW IS NOT A QUALITY VERDICT EITHER.
  //
  // Same class of bug as the missing-file case above, one step further along.
  // `stat` succeeds while ffmpeg is still muxing final.mp4, so the file is
  // there but not yet readable as a container — ffprobe fails, and the first
  // version of this recorded output_qa_status='failed'. Because the candidate
  // query excludes failed rows, that verdict is permanent: the job is never
  // re-probed, so a video that became perfectly readable seconds later is
  // quarantined forever.
  //
  // Measured on production: six tutorials sat held this way, every one of them
  // probing clean (h264 1920x1080, full duration, audio present) when checked
  // by hand, and every one with output_qa_checked_at 8-21 SECONDS BEFORE its
  // own completed_at.
  //
  // So: an unprobeable file still blocks THIS pass — "we could not check it" is
  // not "it is fine" — but the status stays NULL so the next pass checks again.
  // Only a verdict the gate actually reached is written down.
  if (verdict === null) {
    await db
      .update(tutorialJobs)
      .set({
        output_qa_detail: {
          summary: `Output QA could not probe the file (will retry): ${probeError}`,
          checks: [],
        } as unknown,
        output_qa_checked_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(tutorialJobs.id, job.id));
    logger.warn(
      { jobId: job.id, videoPath: finalVideo.localPath, probeError },
      "tutorial output QA could not probe the file — holding, will retry",
    );
    return false;
  }

  const passed = verdict.passed;
  await db
    .update(tutorialJobs)
    .set({
      output_qa_status: passed ? "passed" : "failed",
      output_qa_detail: {
        summary: verdict.summary,
        checks: verdict.checks.map((c) => ({
          id: c.id,
          status: c.status,
          detail: c.detail,
          ...(c.measured ?? {}),
        })),
      } as unknown,
      output_qa_checked_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(tutorialJobs.id, job.id));

  if (!passed) {
    logger.error(
      {
        jobId: job.id,
        videoPath: finalVideo.localPath,
        summary: verdict.summary,
        failedChecks: verdict.failures.map((f) => f.id),
      },
      "tutorial FAILED output QA — blocked from Drive, awaiting a human",
    );
  }
  return passed;
}

/**
 * Ship thumbnails that finished AFTER their video was already delivered.
 *
 * A tutorial leaves the main path exactly once: `findTutorialCandidates`
 * excludes anything whose `final_video` artefact is settled, so a job is
 * visited a single time and never revisited. The thumbnail is generated by a
 * different worker on its own schedule, and in practice it loses that race —
 * measured across four days of production, 121 of 150 tutorial thumbnails
 * completed AFTER the video had already shipped. `findTutorialThumbnail`
 * returned null for every one of them and the folder went to the VA with no
 * image. The 29 that happened to finish first all shipped correctly, which is
 * why the delivery code looked fine: it is, it was just asked too early.
 *
 * So this is a second, narrow pass: jobs whose video is already in Drive, that
 * have a completed thumbnail, and no thumbnail artefact yet. It uploads that
 * one file into the folder the video is already in — `planTutorialFolder` is
 * deterministic on (id, title, channel, completion date), so it resolves to the
 * same leaf rather than making a new one.
 *
 * Gating on the video's artefact rather than on `delivered_to_drive` is
 * deliberate: the boolean has a history of being set without an upload actually
 * happening, and putting a thumbnail in a folder with no video is the empty
 * promise the QA gate exists to prevent.
 */
async function backfillLateThumbnails(
  db: DrizzleClient,
  store: ArtifactStore,
  batchSize: number,
): Promise<number> {
  const alreadyShipped = db
    .select({ job_id: storageArtifacts.job_id })
    .from(storageArtifacts)
    .where(
      and(
        eq(storageArtifacts.kind, "thumbnail"),
        eq(storageArtifacts.owner_kind, "tutorial_job"),
        eq(storageArtifacts.state, "uploaded"),
      ),
    );

  const videoLanded = db
    .select({ job_id: storageArtifacts.job_id })
    .from(storageArtifacts)
    .where(
      and(
        eq(storageArtifacts.kind, "final_video"),
        eq(storageArtifacts.owner_kind, "tutorial_job"),
        eq(storageArtifacts.state, "uploaded"),
      ),
    );

  const rows = await db
    .select({
      id: tutorialJobs.id,
      title: tutorialJobs.title,
      channel_id: tutorialJobs.channel_id,
      channel_name: channels.name,
      created_at: tutorialJobs.created_at,
      script_done_at: tutorialJobs.script_done_at,
      thumbnail_path: thumbnails.output_path,
      thumbnail_id: thumbnails.id,
      source_job_id: tutorialJobs.source_job_id,
      language: tutorialJobs.language,
    })
    .from(tutorialJobs)
    .innerJoin(
      thumbnails,
      and(
        eq(thumbnails.subject_id, tutorialJobs.id),
        eq(thumbnails.subject_kind, "tutorial_job"),
        eq(thumbnails.status, "completed"),
        eq(thumbnails.is_selected, true),
        eq(thumbnails.channel_id, tutorialJobs.channel_id),
        sql`CASE lower(trim(${thumbnails.language}))
          WHEN 'english' THEN 'en'
          WHEN 'german' THEN 'de'
          WHEN 'french' THEN 'fr'
          WHEN 'italian' THEN 'it'
          WHEN 'dutch' THEN 'nl'
          WHEN 'swedish' THEN 'sv'
          ELSE lower(trim(${thumbnails.language}))
        END = CASE lower(trim(${tutorialJobs.language}))
          WHEN 'english' THEN 'en'
          WHEN 'german' THEN 'de'
          WHEN 'french' THEN 'fr'
          WHEN 'italian' THEN 'it'
          WHEN 'dutch' THEN 'nl'
          WHEN 'swedish' THEN 'sv'
          ELSE lower(trim(${tutorialJobs.language}))
        END`,
        inArray(thumbnails.review_verdict, ["acceptable", "strong"]),
        isNotNull(thumbnails.output_path),
      ),
    )
    .leftJoin(channels, eq(channels.id, tutorialJobs.channel_id))
    .where(
      and(
        eq(tutorialJobs.status, "COMPLETED"),
        notInArray(tutorialJobs.id, alreadyShipped),
        inArray(tutorialJobs.id, videoLanded),
      ),
    )
    .orderBy(desc(tutorialJobs.created_at))
    .limit(batchSize);

  const rowsByJob = new Map<string, typeof rows>();
  for (const row of rows) {
    const matches = rowsByJob.get(row.id) ?? [];
    matches.push(row);
    rowsByJob.set(row.id, matches);
  }
  const unambiguousRows = [...rowsByJob.values()].flatMap((matches) => {
    if (matches.length === 1) return matches;
    logger.warn(
      { jobId: matches[0]?.id, selectedCount: matches.length },
      "late thumbnail delivery blocked by multiple selected completed assets",
    );
    return [];
  });

  let uploaded = 0;
  for (const row of unambiguousRows) {
    const localPath = row.thumbnail_path;
    if (localPath === null || localPath === "") continue;
    try {
      // The image is written by the thumbnail worker on this same box; if it is
      // gone there is nothing to ship and nothing to retry.
      await stat(localPath);
    } catch {
      continue;
    }
    const completedAt = row.script_done_at ?? row.created_at;
    const source = row.source_job_id
      ? await getTutorialJobById(db, row.source_job_id)
      : null;
    const bundleCompletedAt =
      source?.completed_at ?? source?.created_at ?? completedAt;
    try {
      const existing = await getArtifact(db, row.id, "thumbnail");
      if (
        existing?.error_kind === "thumbnail_replaced" &&
        existing.drive_file_id
      ) {
        const deleted = await store.deleteArtifactFromDrive(existing.id);
        if (!deleted)
          throw new Error("Could not delete the previous Drive thumbnail");
        await resetForRetry(db, existing.id);
      }
      const result = await store.putFinalArtifact({
        jobId: row.id,
        channelId: row.channel_id,
        channelName: row.channel_name,
        title: row.title,
        completedAt,
        kind: "thumbnail",
        localPath,
        ownerKind: "tutorial_job",
        folderPlan: planTutorialFolder({
          jobId: row.id,
          title: row.title,
          channelName: row.channel_name,
          completedAt: bundleCompletedAt,
          sourceJobId: source?.id ?? null,
          sourceTitle: source?.title ?? null,
          languageCode: row.language ?? "en",
          bundleFolderName: "Upload Bundles",
        }),
      });
      if (result.outcome === "uploaded") uploaded += 1;
    } catch (err) {
      logger.error(
        {
          job_id: row.id,
          err: err instanceof Error ? err.message : String(err),
        },
        "tutorial-drive-scanner: late thumbnail backfill failed",
      );
    }
  }

  if (uploaded > 0) {
    logger.info(
      { uploaded },
      "tutorial-drive-scanner: shipped thumbnails that finished after their video",
    );
  }
  return uploaded;
}

async function pushTutorial(
  db: DrizzleClient,
  store: ArtifactStore,
  job: TutorialCandidate,
  mediaRoot: string,
): Promise<{ uploaded: number; failed: number; skipped: number }> {
  const tally = { uploaded: 0, failed: 0, skipped: 0 };

  // Gate BEFORE any byte is uploaded — including the raw recording and the
  // sidecar. A held video must not leave a half-populated folder in Drive that
  // a VA might try to publish from.
  //
  // This also covers the 1,177 tutorials whose video file no longer exists on
  // disk. Without the gate they still produced a Drive folder: the transcript,
  // the metadata sidecar and an upload sheet are all built in memory from
  // script_text, so they upload happily while final_video and raw_recording
  // silently skip. That is 1,177 folders a VA can open, read an upload sheet
  // in, and find no video to upload — an empty promise generated at scale.
  if (!(await passesOutputQa(db, job, mediaRoot))) {
    tally.skipped += 1;
    return tally;
  }

  const completedAt = tutorialCompletionDate(job);
  const language = job.language ?? "en";
  const source = job.source_job_id
    ? await getTutorialJobById(db, job.source_job_id)
    : null;
  const bundleCompletedAt =
    source?.completed_at ?? source?.created_at ?? completedAt;

  const plan = planTutorialFolder({
    jobId: job.id,
    title: job.title,
    channelName: job.channel_name,
    completedAt: bundleCompletedAt,
    sourceJobId: source?.id ?? null,
    sourceTitle: source?.title ?? null,
    languageCode: language,
    bundleFolderName: "Upload Bundles",
  });

  // Resolve the thumbnail before collecting artefacts, so it ships alongside
  // the video instead of living only in the app.
  const thumbnailPath = await findTutorialThumbnail(
    db,
    job.id,
    job.language,
    job.channel_id,
  );
  const fileArtifacts = collectFinishedTutorialArtifacts(
    { ...job, thumbnail_path: thumbnailPath },
    mediaRoot,
  );
  let allLanded = fileArtifacts.length > 0;
  let finalVpsPath = "";

  // The raw screen recording is 83% of all bytes and exists for the laptop
  // TRANSLATION pipeline, not for the person publishing. Keeping it beside
  // final_video.mp4 meant the leaf held two mp4s — the larger one being a raw,
  // unedited capture — so "which mp4 do I upload?" was a question a VA had to
  // ask, with a publishable-looking wrong answer. It now goes one level down.
  const archivePlan = planTutorialArchiveFolder(plan);

  for (const artifact of fileArtifacts) {
    const result = await store.putFinalArtifact({
      jobId: job.id,
      channelId: job.channel_id,
      channelName: job.channel_name,
      title: job.title,
      completedAt,
      kind: artifact.kind,
      localPath: artifact.localPath,
      ownerKind: "tutorial_job",
      folderPlan: artifact.kind === "raw_recording" ? archivePlan : plan,
    });
    if (artifact.kind === "final_video") finalVpsPath = artifact.localPath;
    if (result.outcome === "uploaded") tally.uploaded += 1;
    else if (result.outcome === "already_uploaded") {
      /* fine */
    } else if (result.outcome === "skipped") {
      tally.skipped += 1;
      allLanded = false;
    } else {
      tally.failed += 1;
      allLanded = false;
    }
  }

  // Transcript (script_text) + v2 metadata, materialised to temp files.
  const tmpDir = join(tmpdir(), "cf-tutorial-docs", job.id);
  let transcriptFile: string | null = null;
  let words: number | null = null;
  try {
    await mkdir(tmpDir, { recursive: true });
    try {
      const doc = buildTranscriptDoc({
        jobId: job.id,
        language,
        scriptText: job.script_text,
        durationSeconds: job.recording_duration_s,
      });
      words = wordCount(doc);
      const p = join(tmpDir, ARTIFACT_FILENAMES.transcript);
      await writeFile(p, JSON.stringify(doc, null, 2), "utf8");
      const r = await store.putFinalArtifact({
        jobId: job.id,
        channelId: job.channel_id,
        channelName: job.channel_name,
        title: job.title,
        completedAt,
        kind: "transcript",
        localPath: p,
        ownerKind: "tutorial_job",
        folderPlan: plan,
      });
      if (r.outcome === "uploaded") {
        tally.uploaded += 1;
        transcriptFile = ARTIFACT_FILENAMES.transcript;
      } else if (r.outcome === "already_uploaded") {
        transcriptFile = ARTIFACT_FILENAMES.transcript;
      } else if (r.outcome === "failed") {
        tally.failed += 1;
        allLanded = false;
      }
    } catch (err) {
      if (!(err instanceof TranscriptUnavailableError)) throw err;
    }

    const sidecar = buildMetadataSidecarV2({
      content_forge_job_id: job.id,
      owner_kind: "tutorial_job",
      title: job.title,
      description: job.description ?? null,
      tags: job.tags ?? null,
      format: "TUTORIAL",
      channel_id: job.channel_id,
      channel_name: job.channel_name,
      language,
      word_count: words,
      transcript_file: transcriptFile,
      transcript_language: transcriptFile !== null ? language : null,
      raw_recording_file: fileArtifacts.some((a) => a.kind === "raw_recording")
        ? `${TUTORIAL_ARCHIVE_FOLDER_NAME}/${ARTIFACT_FILENAMES.raw_recording}`
        : null,
      recording_duration_s: job.recording_duration_s,
      script_provider: job.script_provider ?? null,
      script_model: job.script_model ?? null,
      render_completed_at: completedAt.toISOString(),
      vps_path: finalVpsPath,
    });
    const metaPath = join(tmpDir, ARTIFACT_FILENAMES.metadata);
    await writeFile(metaPath, JSON.stringify(sidecar, null, 2), "utf8");
    const m = await store.putFinalArtifact({
      jobId: job.id,
      channelId: job.channel_id,
      channelName: job.channel_name,
      title: job.title,
      completedAt,
      kind: "metadata",
      localPath: metaPath,
      ownerKind: "tutorial_job",
      folderPlan: plan,
    });
    if (m.outcome === "uploaded") tally.uploaded += 1;
    else if (m.outcome === "failed") {
      tally.failed += 1;
      allLanded = false;
    }

    // The human-facing sheet. metadata.json is for machines; this is what the
    // VA reads with the YouTube upload form open in the next tab. Without it
    // the folder's only title was the lowercase folder slug, so "open Drive
    // and upload" meant "open Drive, then open the app anyway".
    const uploadSheet = buildUploadSheet({
      jobId: job.id,
      title: job.title,
      description: job.description ?? null,
      tags: job.tags ?? null,
      channelName: job.channel_name,
      language,
      videoFilename: ARTIFACT_FILENAMES.final_video,
      thumbnailFilename: fileArtifacts.some((a) => a.kind === "thumbnail")
        ? ARTIFACT_FILENAMES.thumbnail
        : null,
      durationSeconds: job.recording_duration_s,
    });
    const sheetPath = join(tmpDir, ARTIFACT_FILENAMES.upload_sheet);
    await writeFile(sheetPath, uploadSheet, "utf8");
    const u = await store.putFinalArtifact({
      jobId: job.id,
      channelId: job.channel_id,
      channelName: job.channel_name,
      title: job.title,
      completedAt,
      kind: "upload_sheet",
      localPath: sheetPath,
      ownerKind: "tutorial_job",
      folderPlan: plan,
    });
    if (u.outcome === "uploaded") tally.uploaded += 1;
    else if (u.outcome === "failed") {
      tally.failed += 1;
      allLanded = false;
    }
  } catch (err) {
    logger.warn(
      { job_id: job.id, err: err instanceof Error ? err.message : String(err) },
      "tutorial-drive-scanner: could not build/upload transcript or metadata",
    );
    tally.failed += 1;
    allLanded = false;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  // Flip the fast flag ONLY when everything landed. storage_artifacts remains
  // the source of truth; this is just a cheap "skip on the next pass" marker.
  if (allLanded && tally.failed === 0) {
    await db
      .update(tutorialJobs)
      .set({
        delivered_to_drive: true,
        uploader_status: job.is_uploaded
          ? "uploaded"
          : "waiting_to_be_uploaded",
      })
      .where(eq(tutorialJobs.id, job.id));
  }

  return tally;
}

/** Repeat the "switched off" line every N passes rather than every pass. */
const DISABLED_LOG_EVERY_N_PASSES = 12;
let disabledPasses = 0;

/** One tutorial pass. Never throws — a bad tutorial must not stop the loop. */
export async function runTutorialScanOnce(
  db: DrizzleClient,
  store: ArtifactStore,
  opts: {
    batchSize: number;
    mediaRoot: string;
    maxAttemptsPerArtifact?: number;
  },
): Promise<{
  jobs: number;
  uploaded: number;
  failed: number;
  skipped: number;
}> {
  if (!(await tutorialAutoUploadEnabled(db))) {
    if (disabledPasses % DISABLED_LOG_EVERY_N_PASSES === 0) {
      logger.warn(
        {
          enable_sql:
            "UPDATE tutorial_settings SET drive_autoupload_enabled = true;",
        },
        "tutorial-drive-scanner: tutorial Drive delivery is OFF " +
          "(tutorial_settings.drive_autoupload_enabled = false). No tutorial " +
          "is being uploaded. Turn it on in Tutorial Studio settings or with " +
          "the SQL above.",
      );
    }
    disabledPasses += 1;
    return { jobs: 0, uploaded: 0, failed: 0, skipped: 0 };
  }
  disabledPasses = 0;

  const backfilled = await backfillLateThumbnails(db, store, opts.batchSize);

  const candidates = await findTutorialCandidates(
    db,
    opts.batchSize,
    opts.maxAttemptsPerArtifact ?? DEFAULT_MAX_ATTEMPTS_PER_ARTIFACT,
  );
  const totals = {
    jobs: candidates.length,
    uploaded: backfilled,
    failed: 0,
    skipped: 0,
  };

  for (const job of candidates) {
    try {
      const t = await pushTutorial(db, store, job, opts.mediaRoot);
      totals.uploaded += t.uploaded;
      totals.failed += t.failed;
      totals.skipped += t.skipped;
    } catch (err) {
      logger.error(
        {
          job_id: job.id,
          err: err instanceof Error ? err.message : String(err),
        },
        "tutorial-drive-scanner: unexpected error",
      );
      totals.failed += 1;
    }
  }

  if (totals.jobs > 0) {
    logger.info(totals, "tutorial-drive-scanner: pass complete");
  }
  return totals;
}
