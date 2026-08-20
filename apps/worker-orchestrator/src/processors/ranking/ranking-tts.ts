import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DrizzleClient } from "@repo/db";
import { getTTSVoiceByDatabaseId } from "@repo/db/repositories";
import { getConfig } from "@repo/config";
import { requestTTS } from "../../utils/tts-gateway.js";
import { crossfadeStitchAndMaster } from "../../utils/ffmpeg-tts-splicing.js";
import { createContextLogger } from "@repo/logger";

const logger = createContextLogger("ranking-tts");

/**
 * Max characters per TTS chunk. Matches the drama pipeline's tuning — keeps
 * each provider call well inside its poll window so long scripts don't time
 * out mid-request.
 */
const CHUNK_SIZE = 1500;

/**
 * Split narration into <= CHUNK_SIZE chunks, breaking on sentence boundaries.
 * Mirrors long-form-drama/tts.ts::chunkScript so RANKING narration seams sit
 * at sentence ends, which the crossfade stitcher then smooths.
 */
function chunkScript(script: string): string[] {
  if (script.length <= CHUNK_SIZE) return [script];
  const chunks: string[] = [];
  let remaining = script;
  while (remaining.length > CHUNK_SIZE) {
    const window = remaining.slice(0, CHUNK_SIZE);
    const lastBreak = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
    );
    if (lastBreak > 0) {
      chunks.push(remaining.slice(0, lastBreak + 2).trim());
      remaining = remaining.slice(lastBreak + 2);
    } else {
      chunks.push(window.trim());
      remaining = remaining.slice(CHUNK_SIZE);
    }
  }
  if (remaining.trim().length > 0) chunks.push(remaining.trim());
  return chunks;
}

/**
 * Map a tts_voices `provider` to a tts-gateway engine. Same mapping the
 * generic TTS handler uses (ai-generation.ts): Fish voices → fish, AI33 /
 * Minimax → minimax, everything else → elevenlabs.
 */
function engineForProvider(
  provider: string,
): "elevenlabs" | "minimax" | "fish" {
  if (
    provider === "Fish" ||
    provider === "FishAudio" ||
    provider === "FISH_AUDIO"
  ) {
    return "fish";
  }
  if (provider === "AI33" || provider === "Minimax") return "minimax";
  return "elevenlabs";
}

export interface RankingWordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface RankingNarrationResult {
  /** Absolute local path to the stitched narration mp3. */
  audioPath: string;
  /**
   * Whisper word timings (seconds). NEVER empty — this function throws rather
   * than return a job that would render on fixed timing. See the Whisper block
   * below for why.
   */
  wordTimestamps: RankingWordTimestamp[];
}

interface GenerateRankingNarrationArgs {
  db: DrizzleClient;
  jobId: string;
  channelId: string;
  /** Clean narration prose (JSON fence already stripped by ranking-analysis). */
  script: string;
  /** tts_voices row UUID (metadata.voice_id ?? DEFAULT_VOICE_EN/DE). */
  voiceId: string;
  /** ISO language code for Whisper (e.g. "en", "de"). Auto-detect if omitted. */
  language?: string;
}

/**
 * Generate RANKING narration audio and write it to
 * `LOCAL_MEDIA_ROOT/<channelId>/<jobId>/narration.mp3`.
 *
 * Synchronous by design (like the drama TTS step) — the RANKING pipeline has
 * no dedicated TTS_GENERATING state, so asset-collection produces the audio
 * inline before advancing. Returns the absolute local path; the caller stores
 * it as `metadata.ranking.audioUrl = file://<path>` and the render worker
 * rewrites it to an HTTP URL for the composition.
 *
 * Throws on any failure — no silent fallback. A RANKING video without
 * narration is not shippable, so failing loud is correct.
 */
export async function generateRankingNarration(
  args: GenerateRankingNarrationArgs,
): Promise<RankingNarrationResult> {
  const { db, jobId, channelId, script, voiceId, language } = args;

  const trimmed = script.trim();
  if (trimmed.length < 10) {
    throw new Error(
      `ranking-tts: narration script too short (${trimmed.length} chars) for job ${jobId}`,
    );
  }

  const voice = await getTTSVoiceByDatabaseId(db, voiceId);
  if (!voice) {
    throw new Error(
      `ranking-tts: voice ${voiceId} not found in tts_voices (job ${jobId})`,
    );
  }
  const engine = engineForProvider(voice.provider);
  const speed = (voice.settings as { speed?: number } | null)?.speed;

  const outputDir = join(getConfig().LOCAL_MEDIA_ROOT, channelId, jobId);
  await mkdir(outputDir, { recursive: true });
  const audioPath = join(outputDir, "narration.mp3");

  const chunks = chunkScript(trimmed);
  const tmpBase = join(tmpdir(), `ranking-tts-${jobId}`);
  const chunkPaths: string[] = [];

  logger.info(
    { jobId, engine, provider: voice.provider, chunk_count: chunks.length },
    "generating RANKING narration",
  );

  try {
    for (let i = 0; i < chunks.length; i++) {
      const buffer = await requestTTS(chunks[i]!, voice.voice_id, {
        format: "RANKING",
        engine,
        speed,
        context: `ranking:${jobId}`,
      });
      const chunkPath = `${tmpBase}-chunk-${i}.mp3`;
      await writeFile(chunkPath, buffer);
      chunkPaths.push(chunkPath);
    }

    // Single ffmpeg pass: crossfade chunk seams + loudnorm to -14 LUFS.
    await crossfadeStitchAndMaster(chunkPaths, audioPath, { loudnormTp: -2 });
  } finally {
    for (const p of chunkPaths) {
      await unlink(p).catch(() => {});
    }
  }

  logger.info({ jobId, audio_path: audioPath }, "RANKING narration saved");

  // ── Word-level timings — REQUIRED, not best-effort ────────────────────────
  //
  // These are not a UI nicety. Every downstream RANKING timing decision is
  // derived from them:
  //
  //   - narration anchoring writes each item's real spoken span
  //     [narrationStartMs, narrationEndMs] from this word stream;
  //   - the render switches to anchored timing ALL-OR-NOTHING
  //     (`allItemsAnchored`), and without it reverts to the fixed
  //     ~8.5s-per-item cadence;
  //   - the B-Roll Studio sizes the VA's trim bar from the same window.
  //
  // Real narration runs ~40s per item. A job that loses its word timings
  // therefore renders successfully and is completely desynced: shots cut every
  // 8.5s while the voice is still on item 1. It looks broken, it is
  // unuploadable, and nothing failed — the exact silent-fallback pattern this
  // codebase forbids (see feedback-no-synthetic-fallbacks /
  // feedback-word-aligned-pacing-no-fallback).
  //
  // So: throw, with the diagnostics needed to fix it. The narration mp3 is
  // already written to disk, so a retry after Whisper is restored does not
  // re-pay for TTS.
  let wordTimestamps: RankingWordTimestamp[];
  try {
    const { runWhisper } = await import("@repo/media-core");
    const raw = (await runWhisper(audioPath, language)) as Array<
      Record<string, unknown>
    >;
    // NOTE the absent `?? 0`. `start` used to default to zero when Whisper
    // omitted it, which silently placed that word at the very beginning of the
    // narration. Anchoring takes an item's start time from its first matched
    // word, so one untimed word could pin an item's whole segment to t=0 and
    // desync every shot after it — a fabricated timing of exactly the kind this
    // file's own Whisper-failure path (three lines below) refuses to produce.
    // A word we have no timing for is DROPPED: omitting unknown data is honest,
    // inventing a position for it is not.
    const num = (v: unknown): number =>
      v === undefined || v === null ? Number.NaN : Number(v);
    wordTimestamps = raw
      .map((w) => ({
        word: String(w["word"] ?? "").trim(),
        start: num(w["start"] ?? w["start_time"]),
        end: num(w["end"] ?? w["end_time"]),
      }))
      .filter(
        (w) =>
          w.word.length > 0 &&
          Number.isFinite(w.start) &&
          Number.isFinite(w.end),
      );

    const droppedForMissingTimings = raw.length - wordTimestamps.length;
    if (droppedForMissingTimings > 0) {
      logger.warn(
        {
          jobId,
          dropped: droppedForMissingTimings,
          total: raw.length,
        },
        "RANKING narration: dropped words with no usable Whisper timing rather than placing them at t=0",
      );
    }
    if (wordTimestamps.length === 0) {
      throw new Error(
        `ranking-tts: Whisper returned ${raw.length} words for job ${jobId} but none carried usable ` +
          `start/end timings. RANKING derives every shot boundary from these, so there is nothing to ` +
          `anchor to. Narration audio is already saved at ${audioPath} and will not be regenerated.`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { jobId, audio_path: audioPath, language, err: message },
      "RANKING narration Whisper FAILED — refusing to continue on fixed timing",
    );
    throw new Error(
      `ranking-tts: Whisper transcription failed for job ${jobId} — ${message}. ` +
        `RANKING cannot be rendered without word-level timings: the composition ` +
        `would fall back to a fixed ~8.5s-per-item cadence while the narration ` +
        `runs ~40s per item, producing a video that renders but is completely ` +
        `desynced. Narration audio is already at ${audioPath} (a retry will not ` +
        `re-pay for TTS). Fix: verify the Whisper runtime is installed and ` +
        `reachable on this worker (see @repo/media-core runWhisper), then retry ` +
        `the job.`,
    );
  }

  if (wordTimestamps.length === 0) {
    logger.error(
      { jobId, audio_path: audioPath, language },
      "RANKING narration Whisper returned zero usable words",
    );
    throw new Error(
      `ranking-tts: Whisper returned zero usable word timings for job ${jobId} ` +
        `(audio: ${audioPath}, language: ${language ?? "auto"}). RANKING timing ` +
        `is derived entirely from this word stream; continuing would render a ` +
        `fixed-cadence, desynced video. Check that the narration mp3 is not ` +
        `silent and that the language hint matches the spoken language, then ` +
        `retry.`,
    );
  }

  logger.info(
    { jobId, word_count: wordTimestamps.length },
    "RANKING narration word-timings computed",
  );

  return { audioPath, wordTimestamps };
}
