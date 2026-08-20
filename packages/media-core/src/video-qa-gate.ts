/**
 * Output QA gate — the last cheap check before a rendered video reaches a human
 * or Google Drive.
 *
 * ## Why this exists
 *
 * On 2026-07-09 this project rendered a RANKING video that held ONE STATIC
 * FRAME from 48s to 298s — 84% of its runtime. It rendered without error, the
 * job transitioned to AWAITING_UPLOADER, and every health signal stayed green.
 * The only reason anyone knew was that a human eventually watched it. The same
 * class of defect (black screen, silent audio, a duration that disagrees with
 * the content) is invisible to every check the pipeline had.
 *
 * This gate is deliberately BASIC. It is a safety net, not an aesthetic judge:
 * it answers "is this a broken file?", never "is this a good video?". Anything
 * requiring taste belongs to the VA review flow, not here.
 *
 * ## Design rules
 *
 *  - **Format-agnostic.** It probes an mp4. It knows nothing about RANKING,
 *    TUTORIAL, tiers or scripts. Every format gets the same floor.
 *  - **Cheap.** One ffmpeg decode pass drives freeze/black/volume detection
 *    together, plus one ffprobe. No frame dumps, no Python, no ML.
 *  - **Measurement and judgement are separate.** `measureVideoQa` shells out;
 *    `evaluateVideoQa` is pure. The thresholds are therefore testable exactly,
 *    without ffmpeg, against the real 2026-07-09 numbers.
 *  - **It never deletes anything.** It reports. A human decides what happens to
 *    a failed render — see the owner's instruction in the overnight plan.
 *  - **No synthetic fallbacks.** If the file cannot be probed, this THROWS. It
 *    does not return "probably fine". A check that guesses is worse than no
 *    check, because it launders a broken file as verified.
 */

import { execa as defaultExeca } from "execa";
import { probeMedia, type MediaProbeResult } from "./ffmpeg/full-probe.js";

export type ExecFn = typeof defaultExeca;

/** ffmpeg analysis timeout. Long videos decode slowly; 10 min is generous. */
const QA_TIMEOUT_MS = 600_000;

// ── Thresholds ───────────────────────────────────────────────────────────────

export interface VideoQaThresholds {
  /** Fail if any single frozen run is at least this long. */
  maxFrozenRunSeconds: number;
  /** Fail if frozen frames total more than this fraction of runtime. */
  maxFrozenFraction: number;
  /** Fail if any single black run is at least this long. */
  maxBlackRunSeconds: number;
  /** The opening and closing seconds must not be black. */
  edgeCheckSeconds: number;
  /** Fail when peak audio never exceeds this (dBFS) — effectively silent. */
  silenceMaxVolumeDb: number;
  /** Warn when integrated loudness deviates from target by more than this. */
  loudnessToleranceLu: number;
  /** Target integrated loudness (LUFS). */
  targetLufs: number;
  /** Fail when actual duration differs from expected by more than this. */
  maxDurationDriftFraction: number;
}

/**
 * Defaults are the overnight plan's suggested values, which come from the real
 * defects observed on this pipeline rather than from a spec:
 *
 *  - 5s frozen run / 20% frozen total — the 2026-07-09 render had a 250s run at
 *    84%, so this catches it by a factor of 50 and still tolerates a legitimate
 *    held title card.
 *  - 2s black run — longer than any intentional fade here.
 *  - -14 LUFS ±3 LU — the same YouTube target used elsewhere in media-core. The
 *    one real ranking render measured -21.5 LUFS, i.e. 7.5 LU under, so this is
 *    a live defect and not a hypothetical. It WARNS rather than fails: quiet
 *    audio is fixable in one pass and is not a reason to block a good video.
 */
export const DEFAULT_VIDEO_QA_THRESHOLDS: VideoQaThresholds = {
  maxFrozenRunSeconds: 5,
  maxFrozenFraction: 0.2,
  maxBlackRunSeconds: 2,
  edgeCheckSeconds: 1,
  silenceMaxVolumeDb: -50,
  loudnessToleranceLu: 3,
  targetLufs: -14,
  maxDurationDriftFraction: 0.1,
};

/**
 * Thresholds for SCREEN RECORDINGS (the TUTORIAL lane).
 *
 * ## Why the frozen check is off here
 *
 * A screen-recorded tutorial is *legitimately* mostly static. The narrator
 * explains a settings page while that settings page sits on screen; nothing
 * moves for thirty seconds and that is the medium working correctly, not a
 * defect. Measured on real production tutorials: 87–98% of runtime reads as
 * "frozen" to `freezedetect`, on videos that are completely fine to publish.
 *
 * The defaults are calibrated for motion graphics (RANKING), where a still
 * frame means something broke. Applying them to tutorials would have blocked
 * essentially every tutorial from Drive — the gate causing the outage it exists
 * to prevent.
 *
 * EVERY OTHER CHECK STILL APPLIES, and they are the ones that matter here.
 * Duration in particular: it caught three real tutorials whose finished video
 * ran ~97% longer than the recording it was made from (394s vs 199s, 353s vs
 * 181s, 375s vs 190s). Black frames, silent audio and missing streams are all
 * still failures for a screen recording.
 */
export const SCREEN_RECORDING_QA_THRESHOLDS: VideoQaThresholds = {
  ...DEFAULT_VIDEO_QA_THRESHOLDS,
  // Effectively disabled — a static screen is the expected picture.
  maxFrozenRunSeconds: Number.POSITIVE_INFINITY,
  maxFrozenFraction: 1,
};

/** What the caller believes the output should be. All optional. */
export interface VideoQaExpectations {
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  /** Set false for formats that legitimately ship without an audio track. */
  requireAudio?: boolean;
}

// ── Measurements ─────────────────────────────────────────────────────────────

export interface QaInterval {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface VideoQaMeasurements {
  probe: MediaProbeResult;
  frozen: QaInterval[];
  black: QaInterval[];
  /** null when volumedetect produced no reading (e.g. no audio stream). */
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
  /** null when ebur128 produced no summary. Loudness is warn-only. */
  integratedLufs: number | null;
}

// ── Verdict ──────────────────────────────────────────────────────────────────

export type QaCheckId =
  | "streams"
  | "dimensions"
  | "duration"
  | "frozen"
  | "black"
  | "audio_silence"
  | "loudness";

export type QaCheckStatus = "pass" | "warn" | "fail" | "skipped";

export interface QaCheck {
  id: QaCheckId;
  status: QaCheckStatus;
  /** One line, written for a human reading a job page at 2am. */
  detail: string;
  measured?: Record<string, number | string | boolean | null>;
}

export interface VideoQaResult {
  /** True when no check FAILED. Warnings do not block. */
  passed: boolean;
  checks: QaCheck[];
  failures: QaCheck[];
  warnings: QaCheck[];
  /** Single-line reason, suitable for error_message / a UI badge. */
  summary: string;
  measurements: VideoQaMeasurements;
}

// ── Pure parsers (unit-testable without ffmpeg) ───────────────────────────────

/**
 * Parse freezedetect output.
 *
 * freezedetect logs one line per event:
 *   [freezedetect @ 0x..] lavfi.freezedetect.freeze_start: 48.0
 *   [freezedetect @ 0x..] lavfi.freezedetect.freeze_duration: 250.04
 *   [freezedetect @ 0x..] lavfi.freezedetect.freeze_end: 298.04
 *
 * A freeze still open when the stream ends emits a start with no end, which is
 * exactly the 2026-07-09 shape, so an unterminated run is closed at the file
 * duration rather than discarded.
 */
export function parseFreezeIntervals(
  stderr: string,
  durationSeconds: number,
): QaInterval[] {
  const intervals: QaInterval[] = [];
  let pendingStart: number | null = null;

  for (const line of stderr.split(/\r?\n/)) {
    const start = /freeze_start:\s*([\d.]+)/.exec(line);
    if (start) {
      pendingStart = parseFloat(start[1]!);
      continue;
    }
    const end = /freeze_end:\s*([\d.]+)/.exec(line);
    if (end && pendingStart !== null) {
      const endSeconds = parseFloat(end[1]!);
      intervals.push({
        startSeconds: pendingStart,
        endSeconds,
        durationSeconds: Math.max(0, endSeconds - pendingStart),
      });
      pendingStart = null;
    }
  }

  // Freeze still running at EOF — the file ends frozen.
  if (pendingStart !== null && durationSeconds > pendingStart) {
    intervals.push({
      startSeconds: pendingStart,
      endSeconds: durationSeconds,
      durationSeconds: durationSeconds - pendingStart,
    });
  }

  return intervals;
}

/**
 * Parse blackdetect output:
 *   [blackdetect @ 0x..] black_start:0 black_end:3.2 black_duration:3.2
 */
export function parseBlackIntervals(stderr: string): QaInterval[] {
  const intervals: QaInterval[] = [];
  const re =
    /black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)\s+black_duration:\s*([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    intervals.push({
      startSeconds: parseFloat(m[1]!),
      endSeconds: parseFloat(m[2]!),
      durationSeconds: parseFloat(m[3]!),
    });
  }
  return intervals;
}

/**
 * Parse volumedetect output:
 *   [Parsed_volumedetect_0 @ 0x..] mean_volume: -23.5 dB
 *   [Parsed_volumedetect_0 @ 0x..] max_volume: -0.5 dB
 */
export function parseVolumeDetect(stderr: string): {
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
} {
  const mean = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(stderr);
  const max = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(stderr);
  return {
    meanVolumeDb: mean ? parseFloat(mean[1]!) : null,
    maxVolumeDb: max ? parseFloat(max[1]!) : null,
  };
}

/** Parse the ebur128 summary: "Integrated loudness: -21.5 LUFS". */
export function parseIntegratedLufs(stderr: string): number | null {
  const m = /Integrated loudness:[\s\S]{0,40}?I:\s*(-?[\d.]+)\s*LUFS/.exec(
    stderr,
  );
  if (m) return parseFloat(m[1]!);
  const flat = /Integrated loudness:\s*(-?[\d.]+)\s*LUFS/.exec(stderr);
  return flat ? parseFloat(flat[1]!) : null;
}

// ── Measurement (shells out) ─────────────────────────────────────────────────

/**
 * Probe a finished video and collect every QA measurement in ONE ffmpeg pass.
 *
 * Throws if the file cannot be probed at all — an unreadable output is itself a
 * failure, and returning a cheerful default here would be the exact silent
 * fallback this gate exists to prevent.
 */
export async function measureVideoQa(
  videoPath: string,
  thresholds: VideoQaThresholds = DEFAULT_VIDEO_QA_THRESHOLDS,
  execFn: ExecFn = defaultExeca,
): Promise<VideoQaMeasurements> {
  const probe = await probeMedia(videoPath);
  const ffmpegBin = process.env.FFMPEG_PATH ?? "ffmpeg";

  // freezedetect's `d` is the MINIMUM run it will report. Set it below the
  // failing threshold so we can also measure the cumulative frozen fraction
  // from many short freezes, not just one long one.
  const freezeMinRun = Math.max(
    0.5,
    Math.min(2, thresholds.maxFrozenRunSeconds / 2),
  );
  const blackMinRun = Math.max(
    0.1,
    Math.min(1, thresholds.maxBlackRunSeconds / 2),
  );

  const videoFilters = [
    `freezedetect=n=-60dB:d=${freezeMinRun}`,
    `blackdetect=d=${blackMinRun}:pix_th=0.10`,
  ].join(",");

  const args = ["-hide_banner", "-nostats", "-i", videoPath];
  if (probe.video) args.push("-vf", videoFilters);
  if (probe.audio) args.push("-af", "volumedetect,ebur128");
  args.push("-f", "null", "-");

  const result = await execFn(ffmpegBin, args, {
    timeout: QA_TIMEOUT_MS,
    reject: false, // analysis filters write to stderr; exit code is not the signal
  });

  const stderr = String(result.stderr ?? "");
  const volume = probe.audio
    ? parseVolumeDetect(stderr)
    : { meanVolumeDb: null, maxVolumeDb: null };

  return {
    probe,
    frozen: probe.video
      ? parseFreezeIntervals(stderr, probe.durationSeconds)
      : [],
    black: probe.video ? parseBlackIntervals(stderr) : [],
    meanVolumeDb: volume.meanVolumeDb,
    maxVolumeDb: volume.maxVolumeDb,
    integratedLufs: probe.audio ? parseIntegratedLufs(stderr) : null,
  };
}

// ── Judgement (pure) ─────────────────────────────────────────────────────────

/**
 * Turn measurements into a verdict. Pure — no I/O, no clock, no ffmpeg — so
 * every threshold is testable against exact numbers.
 */
export function evaluateVideoQa(
  measurements: VideoQaMeasurements,
  expectations: VideoQaExpectations = {},
  thresholds: VideoQaThresholds = DEFAULT_VIDEO_QA_THRESHOLDS,
): VideoQaResult {
  const { probe } = measurements;
  const checks: QaCheck[] = [];
  const requireAudio = expectations.requireAudio ?? true;
  const duration = probe.durationSeconds;

  // 1. Streams present.
  const hasVideo = Boolean(probe.video);
  const hasAudio = Boolean(probe.audio);
  if (!hasVideo || (requireAudio && !hasAudio)) {
    checks.push({
      id: "streams",
      status: "fail",
      detail: !hasVideo
        ? "No video stream — the file is not a video."
        : "No audio stream, but this format expects narration.",
      measured: { has_video: hasVideo, has_audio: hasAudio },
    });
  } else {
    checks.push({
      id: "streams",
      status: "pass",
      detail: `Video${hasAudio ? " + audio" : ""} present.`,
      measured: { has_video: hasVideo, has_audio: hasAudio },
    });
  }

  // 2. Dimensions / fps, only when the caller stated an expectation.
  const dimIssues: string[] = [];
  if (probe.video) {
    if (expectations.width && probe.video.width !== expectations.width)
      dimIssues.push(`width ${probe.video.width} ≠ ${expectations.width}`);
    if (expectations.height && probe.video.height !== expectations.height)
      dimIssues.push(`height ${probe.video.height} ≠ ${expectations.height}`);
    // fps is fractional in containers; a 1% window absorbs 29.97 vs 30.
    if (
      expectations.fps &&
      Math.abs(probe.video.fps - expectations.fps) / expectations.fps > 0.01
    )
      dimIssues.push(`fps ${probe.video.fps} ≠ ${expectations.fps}`);
  }
  if (!expectations.width && !expectations.height && !expectations.fps) {
    checks.push({
      id: "dimensions",
      status: "skipped",
      detail: "No expected resolution or fps supplied.",
    });
  } else {
    checks.push({
      id: "dimensions",
      status: dimIssues.length ? "fail" : "pass",
      detail: dimIssues.length
        ? `Output geometry does not match the render config: ${dimIssues.join(", ")}.`
        : "Resolution and fps match the render config.",
      measured: {
        width: probe.video?.width ?? null,
        height: probe.video?.height ?? null,
        fps: probe.video?.fps ?? null,
      },
    });
  }

  // 3. Duration sanity. A freeze shows up here too: the file is far longer than
  //    the content that went into it.
  if (expectations.durationSeconds && expectations.durationSeconds > 0) {
    const drift =
      Math.abs(duration - expectations.durationSeconds) /
      expectations.durationSeconds;
    checks.push({
      id: "duration",
      status: drift > thresholds.maxDurationDriftFraction ? "fail" : "pass",
      detail:
        drift > thresholds.maxDurationDriftFraction
          ? `Duration ${duration.toFixed(1)}s differs from the expected ` +
            `${expectations.durationSeconds.toFixed(1)}s by ${(drift * 100).toFixed(0)}%.`
          : `Duration ${duration.toFixed(1)}s matches expectation.`,
      measured: {
        actual_seconds: Number(duration.toFixed(2)),
        expected_seconds: Number(expectations.durationSeconds.toFixed(2)),
        drift_fraction: Number(drift.toFixed(4)),
      },
    });
  } else {
    checks.push({
      id: "duration",
      status: "skipped",
      detail: "No expected duration supplied.",
    });
  }

  // 4. Frozen video — THE check that would have caught 2026-07-09.
  if (!probe.video) {
    checks.push({
      id: "frozen",
      status: "skipped",
      detail: "No video stream to analyse.",
    });
  } else {
    const longestRun = measurements.frozen.reduce(
      (max, i) => Math.max(max, i.durationSeconds),
      0,
    );
    const totalFrozen = measurements.frozen.reduce(
      (sum, i) => sum + i.durationSeconds,
      0,
    );
    const frozenFraction = duration > 0 ? totalFrozen / duration : 0;
    const runFails = longestRun >= thresholds.maxFrozenRunSeconds;
    const fractionFails = frozenFraction > thresholds.maxFrozenFraction;
    const worst = measurements.frozen.find(
      (i) => i.durationSeconds === longestRun,
    );

    checks.push({
      id: "frozen",
      status: runFails || fractionFails ? "fail" : "pass",
      detail:
        runFails || fractionFails
          ? `Video is frozen for ${longestRun.toFixed(1)}s in one run ` +
            `(from ${worst ? worst.startSeconds.toFixed(1) : "?"}s) and ` +
            `${(frozenFraction * 100).toFixed(0)}% of runtime in total. ` +
            `A frozen picture is what shipped on 2026-07-09.`
          : `No significant freeze (longest ${longestRun.toFixed(1)}s, ` +
            `${(frozenFraction * 100).toFixed(0)}% of runtime).`,
      measured: {
        longest_run_seconds: Number(longestRun.toFixed(2)),
        total_frozen_seconds: Number(totalFrozen.toFixed(2)),
        frozen_fraction: Number(frozenFraction.toFixed(4)),
        interval_count: measurements.frozen.length,
      },
    });
  }

  // 5. Black frames, including the opening and closing seconds.
  if (!probe.video) {
    checks.push({
      id: "black",
      status: "skipped",
      detail: "No video stream to analyse.",
    });
  } else {
    const longestBlack = measurements.black.reduce(
      (max, i) => Math.max(max, i.durationSeconds),
      0,
    );
    const edge = thresholds.edgeCheckSeconds;
    const opensBlack = measurements.black.some((i) => i.startSeconds < edge);
    const endsBlack = measurements.black.some(
      (i) => i.endSeconds > duration - edge,
    );
    const runFails = longestBlack >= thresholds.maxBlackRunSeconds;
    const reasons: string[] = [];
    if (runFails) reasons.push(`a ${longestBlack.toFixed(1)}s black run`);
    if (opensBlack) reasons.push(`the first ${edge}s are black`);
    if (endsBlack) reasons.push(`the last ${edge}s are black`);

    checks.push({
      id: "black",
      status: reasons.length ? "fail" : "pass",
      detail: reasons.length
        ? `Blank picture: ${reasons.join(", ")}.`
        : "No sustained black frames.",
      measured: {
        longest_black_seconds: Number(longestBlack.toFixed(2)),
        opens_black: opensBlack,
        ends_black: endsBlack,
        interval_count: measurements.black.length,
      },
    });
  }

  // 6. Silent audio.
  if (!hasAudio) {
    checks.push({
      id: "audio_silence",
      status: requireAudio ? "fail" : "skipped",
      detail: requireAudio
        ? "No audio stream at all."
        : "Format does not require audio.",
    });
  } else if (measurements.maxVolumeDb === null) {
    // Audio exists but volumedetect gave nothing — we did not measure it, so we
    // must not claim it is fine.
    checks.push({
      id: "audio_silence",
      status: "fail",
      detail:
        "Audio stream present but volume could not be measured — treating as unverified rather than assuming it is audible.",
      measured: { max_volume_db: null },
    });
  } else {
    const silent = measurements.maxVolumeDb <= thresholds.silenceMaxVolumeDb;
    checks.push({
      id: "audio_silence",
      status: silent ? "fail" : "pass",
      detail: silent
        ? `Audio is effectively silent (peak ${measurements.maxVolumeDb.toFixed(1)} dBFS).`
        : `Audio present (peak ${measurements.maxVolumeDb.toFixed(1)} dBFS).`,
      measured: {
        max_volume_db: measurements.maxVolumeDb,
        mean_volume_db: measurements.meanVolumeDb,
      },
    });
  }

  // 7. Loudness — WARN only. Quiet audio is a one-pass fix, not a reason to
  //    block an otherwise good video.
  if (measurements.integratedLufs === null) {
    checks.push({
      id: "loudness",
      status: "skipped",
      detail: "Integrated loudness not measured.",
    });
  } else {
    const deviation = Math.abs(
      measurements.integratedLufs - thresholds.targetLufs,
    );
    checks.push({
      id: "loudness",
      status: deviation > thresholds.loudnessToleranceLu ? "warn" : "pass",
      detail:
        deviation > thresholds.loudnessToleranceLu
          ? `Integrated loudness ${measurements.integratedLufs.toFixed(1)} LUFS is ` +
            `${deviation.toFixed(1)} LU from the ${thresholds.targetLufs} LUFS target.`
          : `Loudness ${measurements.integratedLufs.toFixed(1)} LUFS is on target.`,
      measured: {
        integrated_lufs: measurements.integratedLufs,
        target_lufs: thresholds.targetLufs,
        deviation_lu: Number(deviation.toFixed(2)),
      },
    });
  }

  const failures = checks.filter((c) => c.status === "fail");
  const warnings = checks.filter((c) => c.status === "warn");

  return {
    passed: failures.length === 0,
    checks,
    failures,
    warnings,
    summary: failures.length
      ? `QA FAILED: ${failures.map((f) => f.detail).join(" ")}`
      : warnings.length
        ? `QA passed with ${warnings.length} warning(s): ${warnings.map((w) => w.detail).join(" ")}`
        : "QA passed.",
    measurements,
  };
}

/**
 * Measure and judge in one call. This is what callers use.
 *
 * Throws only when the file itself cannot be read — every other outcome is a
 * structured verdict the caller records and acts on.
 */
export async function runVideoQaGate(
  videoPath: string,
  expectations: VideoQaExpectations = {},
  thresholds: VideoQaThresholds = DEFAULT_VIDEO_QA_THRESHOLDS,
  execFn: ExecFn = defaultExeca,
): Promise<VideoQaResult> {
  const measurements = await measureVideoQa(videoPath, thresholds, execFn);
  return evaluateVideoQa(measurements, expectations, thresholds);
}

/**
 * One structured log line per check, so "how many videos failed QA this week"
 * is a query rather than an archaeology dig.
 */
export function logVideoQaResult(
  result: VideoQaResult,
  context: { jobId: string; format?: string | null; videoPath: string },
): void {
  for (const check of result.checks) {
    if (check.status === "skipped") continue;
    console.log(
      JSON.stringify({
        level: check.status === "fail" ? "error" : "info",
        message: "video_qa_check",
        job_id: context.jobId,
        format: context.format ?? null,
        video_path: context.videoPath,
        check: check.id,
        status: check.status,
        detail: check.detail,
        ...check.measured,
      }),
    );
  }
}
