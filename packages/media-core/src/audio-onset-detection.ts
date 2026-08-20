/**
 * Audio Onset Detection for Precise Cut Timing
 *
 * Uses FFmpeg's silencedetect filter to find exact moments when audio starts
 * after pauses. This provides more precise cut timing than Whisper timestamps
 * alone, which don't account for pauses between sentences.
 *
 * Problem: Whisper gives sentence start/end times, but doesn't track pauses.
 * If a sentence ends at 5.0s and next starts at 6.0s, there's a 1s pause.
 * Using sentence end time (5.0s) for the cut causes audio/video drift.
 *
 * Solution: Detect silence periods, use silence_end as the actual start time.
 */

import { execa } from "execa";

export interface SilencePeriod {
  start: number; // Silence start time in seconds
  end: number; // Silence end time in seconds (= audio onset)
  duration: number; // Silence duration in seconds
}

/**
 * Detect silence periods in an audio file using FFmpeg's silencedetect filter.
 *
 * @param audioPath Absolute path to audio file (MP3, WAV, etc.)
 * @param noiseThreshold Threshold in dB (default: -50dB). Lower = more sensitive.
 *                       -50dB catches breathing pauses, -40dB only catches full silence.
 * @param minDuration Minimum silence duration in seconds (default: 0.3s)
 * @returns Array of silence periods sorted by start time
 * @throws Error if FFmpeg fails or times out
 */
export async function detectSilencePeriods(
  audioPath: string,
  noiseThreshold: number = -50,
  minDuration: number = 0.3,
): Promise<SilencePeriod[]> {
  try {
    // Run FFmpeg silencedetect filter
    // Output format:
    //   [silencedetect @ ...] silence_start: 1.23
    //   [silencedetect @ ...] silence_end: 2.45 | silence_duration: 1.22
    const result = await execa(
      "ffmpeg",
      [
        "-i",
        audioPath,
        "-af",
        `silencedetect=n=${noiseThreshold}dB:d=${minDuration}`,
        "-f",
        "null",
        "-",
      ],
      {
        timeout: 30000, // 30 second timeout
        encoding: "utf8",
        reject: false, // Don't throw on non-zero exit (FFmpeg writes to stderr)
      },
    );

    // Parse stderr for silence events
    const output = result.stderr;
    const silencePeriods: SilencePeriod[] = [];
    let currentStart: number | null = null;

    const lines = output.split("\n");
    for (const line of lines) {
      // Match: [silencedetect @ ...] silence_start: 1.234
      const startMatch = line.match(/silence_start:\s*(\d+\.?\d*)/);
      if (startMatch) {
        currentStart = parseFloat(startMatch[1]);
        continue;
      }

      // Match: [silencedetect @ ...] silence_end: 2.456 | silence_duration: 1.222
      const endMatch = line.match(
        /silence_end:\s*(\d+\.?\d*).*silence_duration:\s*(\d+\.?\d*)/,
      );
      if (endMatch && currentStart !== null) {
        const end = parseFloat(endMatch[1]);
        const duration = parseFloat(endMatch[2]);

        silencePeriods.push({
          start: currentStart,
          end,
          duration,
        });

        currentStart = null;
      }
    }

    // Sort by start time
    silencePeriods.sort((a, b) => a.start - b.start);

    console.log(
      `[Onset Detection] Found ${silencePeriods.length} silence periods in ${audioPath}`,
    );

    return silencePeriods;
  } catch (error) {
    throw new Error(
      `Silence detection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Refine Whisper word timestamps by snapping them to nearest audio onsets.
 *
 * This corrects for pauses between sentences that Whisper doesn't track.
 * If a word's Whisper timestamp is 5.0s but there's a silence period ending
 * at 5.8s, the actual audio onset is 5.8s, not 5.0s.
 *
 * @param whisperTimestamps Original Whisper word timestamps (start, end, word)
 * @param silencePeriods Detected silence periods from detectSilencePeriods()
 * @param snapThreshold Maximum time difference to snap to onset (default: 1.0s)
 * @returns Refined timestamps with start times snapped to nearest onsets
 */
export function refineTimestampsWithOnsets(
  whisperTimestamps: Array<{ start: number; end: number; word: string }>,
  silencePeriods: SilencePeriod[],
  snapThreshold: number = 1.0,
): Array<{ start: number; end: number; word: string }> {
  if (silencePeriods.length === 0) {
    console.warn(
      "[Onset Detection] No silence periods found - returning original timestamps",
    );
    return whisperTimestamps;
  }

  const refined = whisperTimestamps.map((ts) => {
    // Find nearest silence_end (onset) before or near this word's start
    let nearestOnset: number | null = null;
    let minDistance = Infinity;

    for (const silence of silencePeriods) {
      // Only consider onsets that are before or very close to the word start
      if (silence.end > ts.start + snapThreshold) break; // Periods are sorted

      const distance = Math.abs(ts.start - silence.end);
      if (distance < minDistance && distance < snapThreshold) {
        minDistance = distance;
        nearestOnset = silence.end;
      }
    }

    // If we found a nearby onset, snap to it
    if (nearestOnset !== null) {
      return {
        ...ts,
        start: nearestOnset,
      };
    }

    // Otherwise, keep original timestamp
    return ts;
  });

  const refinedCount = refined.filter(
    (r, i) => r.start !== whisperTimestamps[i].start,
  ).length;

  console.log(
    `[Onset Detection] Refined ${refinedCount}/${whisperTimestamps.length} word timestamps`,
  );

  return refined;
}

/**
 * Get precise sentence start times by analyzing audio onsets.
 *
 * This is the high-level function to use in the pacing calculator.
 * It detects silence periods and uses them to find exact sentence boundaries.
 *
 * @param audioPath Path to TTS audio file
 * @param approximateStarts Approximate sentence starts (e.g., from Whisper matching)
 * @param searchWindow How far to look for onset near each start (default: 1.0s)
 * @returns Refined sentence start times accounting for pauses
 */
export async function getPreciseSentenceStarts(
  audioPath: string,
  approximateStarts: number[],
  searchWindow: number = 1.0,
): Promise<number[]> {
  const silencePeriods = await detectSilencePeriods(audioPath);

  return approximateStarts.map((approxStart, idx) => {
    // Find silence period ending nearest to this approximate start
    let bestOnset = approxStart; // Fallback to approximate
    let minDistance = Infinity;

    for (const silence of silencePeriods) {
      const distance = Math.abs(silence.end - approxStart);

      // Only consider onsets within search window
      if (distance < searchWindow && distance < minDistance) {
        minDistance = distance;
        bestOnset = silence.end;
      }
    }

    const adjusted = bestOnset !== approxStart;
    if (adjusted) {
      console.log(
        `[Onset Detection] Sentence ${idx}: ${approxStart.toFixed(2)}s → ${bestOnset.toFixed(2)}s (Δ${(bestOnset - approxStart).toFixed(2)}s)`,
      );
    }

    return bestOnset;
  });
}
