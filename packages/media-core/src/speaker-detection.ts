/**
 * Speaker Detection for Bundestag Parliamentary Videos
 *
 * Detects party affiliations from parliamentary footage by:
 * 1. Extracting frames at regular intervals from video
 * 2. Cropping to bottom-third (where lectern/party signs are visible)
 * 3. Running OCR (Tesseract.js) to extract text
 * 4. Matching text against party keywords (abbreviations + full names)
 * 5. Constructing timeline with party transitions
 *
 * Supports: SPD, CDU, AFD, Grüne, FDP, Die Linke
 *
 * Performance: ~6-11 minutes for 7-hour video at 5-second intervals
 */

import Tesseract from "tesseract.js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { tmpdir } from "node:os";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

// Configure FFmpeg binary path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Default frame extraction interval (5 seconds)
 */
const DEFAULT_FRAME_INTERVAL_SECONDS = 5;

/**
 * OCR processing batch size (process 10 frames concurrently)
 * Balances memory usage and speed for long videos
 */
const OCR_BATCH_SIZE = 10;

/**
 * Minimum confidence threshold for party detection
 * Detections below this threshold are marked as UNKNOWN
 */
const CONFIDENCE_THRESHOLD = 0.5;

/**
 * Maximum gap duration to fill between same-party segments (in seconds)
 * Gaps smaller than this will be merged into adjacent same-party segments
 */
const GAP_FILL_THRESHOLD_SECONDS = 10;

/**
 * Supported German parliamentary parties
 */
export type PartyAffiliation =
  | "SPD"
  | "CDU"
  | "AFD"
  | "GRUENE"
  | "FDP"
  | "LINKE"
  | "UNKNOWN";

/**
 * Input parameters for speaker detection
 */
export interface SpeakerDetectionInput {
  /** Absolute path to video file */
  videoFilePath: string;
  /** Frame extraction interval in seconds (default: 5) */
  frameIntervalSeconds?: number;
}

/**
 * Timeline segment representing continuous speaker/party
 */
export interface SpeakerSegment {
  /** Start time in seconds */
  start_time: number;
  /** End time in seconds */
  end_time: number;
  /** Detected party affiliation */
  party: PartyAffiliation;
  /** Speaker name (always "Unknown" in current implementation) */
  speaker: string;
  /** Detection confidence score (0.0-1.0) */
  confidence: number;
}

/**
 * Speaker detection output with timeline
 */
export interface SpeakerDetectionOutput {
  /** Timeline of party-affiliated segments */
  speaker_timeline: SpeakerSegment[];
}

/**
 * Extracted frame metadata
 */
interface ExtractedFrame {
  /** Absolute path to frame image file */
  filepath: string;
  /** Timestamp in seconds from video start */
  timestamp: number;
}

/**
 * OCR result for single frame
 */
interface FrameOCRResult {
  /** Extracted text from frame */
  text: string;
  /** OCR confidence (0.0-1.0) */
  confidence: number;
  /** Frame timestamp in seconds */
  timestamp: number;
}

/**
 * Party detection result
 */
interface PartyDetectionResult {
  /** Detected party (or UNKNOWN) */
  party: PartyAffiliation;
  /** Detection confidence (0.0-1.0) */
  confidence: number;
}

/**
 * Party keyword patterns for fuzzy matching
 * Handles abbreviations, full names, and common OCR variations
 */
const PARTY_PATTERNS: Record<string, RegExp[]> = {
  SPD: [
    /\bSPD\b/i,
    /S\.P\.D\./i,
    /S\s*P\s*D/i,
    /Sozialdemokrat/i,
    /SP0/i, // Common OCR error (O → 0)
  ],
  CDU: [
    /\bCDU\b/i,
    /C\.D\.U\./i,
    /C\s*D\s*U/i,
    /Christlich.*Demokrat/i,
    /CD0/i, // Common OCR error
  ],
  AFD: [
    /\bAFD\b/i,
    /\bAfD\b/i,
    /A\.f\.D\./i,
    /A\s*f\s*D/i,
    /Alternative.*f.*r.*Deutschland/i,
  ],
  GRUENE: [
    /Gr.*ne/i, // Matches Grüne, Gruene, Grünen
    /B.*ndnis.*90/i, // Bündnis 90
    /Die.*Gr.*nen/i,
  ],
  FDP: [
    /\bFDP\b/i,
    /F\.D\.P\./i,
    /F\s*D\s*P/i,
    /Freie.*Demokrat/i,
    /FD0/i, // Common OCR error
  ],
  LINKE: [/Die.*Linke/i, /\bLinke\b/i, /DIE.*LINKE/i],
};

/**
 * Extract frames from video at specified intervals
 *
 * Crops video to bottom-third (where lectern/party signs are visible)
 * Saves frames to temporary directory for OCR processing
 *
 * @param videoFilePath - Absolute path to video file
 * @param frameIntervalSeconds - Interval between frames (default: 5)
 * @param tempDir - Temporary directory for frame storage
 * @returns Array of extracted frame metadata
 */
async function extractFrames(
  videoFilePath: string,
  frameIntervalSeconds: number,
  tempDir: string,
): Promise<ExtractedFrame[]> {
  console.log(
    `[SpeakerDetection] Extracting frames at ${frameIntervalSeconds}s intervals from: ${videoFilePath}`,
  );

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const frames: ExtractedFrame[] = [];

    ffmpeg(videoFilePath)
      // Crop to bottom-third of video (where lectern text appears)
      // Formula: crop=width:height:x:y
      // width=iw (input width), height=ih/3 (1/3 input height)
      // x=0 (left edge), y=ih*2/3 (start at 2/3 down)
      .videoFilters("crop=iw:ih/3:0:ih*2/3")
      // Extract frames at specified interval
      .outputOptions([`-vf fps=1/${frameIntervalSeconds}`])
      .output(join(tempDir, "frame_%04d.jpg"))
      .on("end", async () => {
        const extractTime = Date.now() - startTime;
        console.log(
          `[SpeakerDetection] Frame extraction completed in ${extractTime}ms`,
        );

        // Read extracted frame filenames
        const files = await readdir(tempDir);
        const frameFiles = files.filter((f) => f.startsWith("frame_"));

        // Calculate timestamps for each frame
        for (let i = 0; i < frameFiles.length; i++) {
          frames.push({
            filepath: join(tempDir, frameFiles[i]),
            timestamp: i * frameIntervalSeconds,
          });
        }

        console.log(`[SpeakerDetection] Extracted ${frames.length} frames`);
        resolve(frames);
      })
      .on("error", (err) => {
        console.error(`[SpeakerDetection] FFmpeg extraction failed:`, err);
        reject(new Error(`Frame extraction failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Perform OCR on single frame using Tesseract.js
 *
 * @param framePath - Absolute path to frame image
 * @param timestamp - Frame timestamp in seconds
 * @returns OCR result with text and confidence
 */
async function performOCR(
  framePath: string,
  timestamp: number,
): Promise<FrameOCRResult> {
  try {
    const result = await Tesseract.recognize(framePath, "deu", {
      // Use German language model for better accuracy.
      // tesseract.js 5.1.1's createWorker unconditionally calls `logger(...)`
      // without checking it's a function first — passing `logger: undefined`
      // (as opposed to omitting the key) throws "logger is not a function"
      // from inside the worker, which is an uncaught exception that crashes
      // the whole process. Pass a real no-op instead of suppressing via undefined.
      logger: () => {},
    });

    const text = result.data.text.trim();
    const confidence = result.data.confidence / 100; // Normalize to 0-1 range

    // Debug logging (helpful for troubleshooting party detection)
    if (text.length > 0) {
      console.log(
        `[SpeakerDetection] OCR @ ${timestamp}s (conf: ${confidence.toFixed(2)}): "${text.substring(0, 100)}"`,
      );
    }

    return { text, confidence, timestamp };
  } catch (error) {
    console.warn(
      `[SpeakerDetection] OCR failed for frame at ${timestamp}s:`,
      error,
    );
    return { text: "", confidence: 0, timestamp };
  }
}

/**
 * Process OCR on all frames in batches
 *
 * Processes frames in batches of OCR_BATCH_SIZE to balance memory and speed
 *
 * @param frames - Extracted frame metadata
 * @returns Array of OCR results
 */
async function processOCRBatch(
  frames: ExtractedFrame[],
): Promise<FrameOCRResult[]> {
  console.log(
    `[SpeakerDetection] Starting OCR processing for ${frames.length} frames (batch size: ${OCR_BATCH_SIZE})`,
  );

  const startTime = Date.now();
  const results: FrameOCRResult[] = [];

  // Process frames in batches
  for (let i = 0; i < frames.length; i += OCR_BATCH_SIZE) {
    const batch = frames.slice(i, i + OCR_BATCH_SIZE);
    console.log(
      `[SpeakerDetection] Processing OCR batch ${Math.floor(i / OCR_BATCH_SIZE) + 1}/${Math.ceil(frames.length / OCR_BATCH_SIZE)}`,
    );

    const batchResults = await Promise.all(
      batch.map((frame) => performOCR(frame.filepath, frame.timestamp)),
    );

    results.push(...batchResults);
  }

  const ocrTime = Date.now() - startTime;
  const avgTimePerFrame = ocrTime / frames.length;
  console.log(
    `[SpeakerDetection] OCR processing completed in ${ocrTime}ms (avg: ${avgTimePerFrame.toFixed(1)}ms/frame)`,
  );

  return results;
}

/**
 * Detect party affiliation from OCR text
 *
 * Uses fuzzy keyword matching against party patterns
 * Returns confidence score based on pattern strength and OCR confidence
 *
 * @param text - OCR extracted text
 * @param ocrConfidence - OCR confidence score
 * @returns Party detection result
 */
function detectParty(
  text: string,
  ocrConfidence: number,
): PartyDetectionResult {
  if (!text || text.length === 0) {
    return { party: "UNKNOWN", confidence: 0 };
  }

  // Try to match against each party's patterns
  for (const [partyKey, patterns] of Object.entries(PARTY_PATTERNS)) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        // Calculate confidence: combine pattern match confidence with OCR confidence
        // Full match in text = high confidence (0.9), partial = medium (0.7)
        const patternConfidence = match[0].length >= 3 ? 0.9 : 0.7;
        const combinedConfidence = (patternConfidence + ocrConfidence) / 2;

        return {
          party: partyKey as PartyAffiliation,
          confidence: combinedConfidence,
        };
      }
    }
  }

  // No party detected
  return { party: "UNKNOWN", confidence: 0 };
}

/**
 * Construct timeline from OCR results
 *
 * Groups consecutive frames with same party into segments
 * Applies confidence threshold and post-processing (merging, gap filling)
 *
 * @param ocrResults - Array of OCR results
 * @param frameIntervalSeconds - Frame extraction interval
 * @returns Array of speaker segments
 */
function constructTimeline(
  ocrResults: FrameOCRResult[],
  frameIntervalSeconds: number,
): SpeakerSegment[] {
  if (ocrResults.length === 0) {
    return [];
  }

  console.log(
    `[SpeakerDetection] Constructing timeline from ${ocrResults.length} OCR results`,
  );

  // Detect party for each frame
  const detections = ocrResults.map((result) => ({
    timestamp: result.timestamp,
    ...detectParty(result.text, result.confidence),
  }));

  // Group consecutive frames with same party into segments
  const rawSegments: SpeakerSegment[] = [];
  let currentSegment: SpeakerSegment | null = null;

  for (const detection of detections) {
    // Apply confidence threshold
    const party =
      detection.confidence >= CONFIDENCE_THRESHOLD
        ? detection.party
        : "UNKNOWN";

    if (!currentSegment || currentSegment.party !== party) {
      // Start new segment
      if (currentSegment) {
        rawSegments.push(currentSegment);
      }

      currentSegment = {
        start_time: detection.timestamp,
        end_time: detection.timestamp + frameIntervalSeconds,
        party,
        speaker: "Unknown",
        confidence: detection.confidence,
      };
    } else {
      // Extend current segment
      currentSegment.end_time = detection.timestamp + frameIntervalSeconds;
      // Update confidence (average)
      currentSegment.confidence =
        (currentSegment.confidence + detection.confidence) / 2;
    }
  }

  // Push final segment
  if (currentSegment) {
    rawSegments.push(currentSegment);
  }

  console.log(
    `[SpeakerDetection] Created ${rawSegments.length} raw segments before post-processing`,
  );

  // Post-process: fill gaps and merge adjacent segments
  const processedSegments = fillGapsAndMerge(rawSegments);

  console.log(
    `[SpeakerDetection] Final timeline has ${processedSegments.length} segments after post-processing`,
  );

  return processedSegments;
}

/**
 * Fill small gaps between same-party segments and merge adjacent segments
 *
 * Handles cases where OCR temporarily fails or detects UNKNOWN between two
 * segments of the same party. Fills gaps < GAP_FILL_THRESHOLD_SECONDS.
 *
 * @param segments - Raw timeline segments
 * @returns Post-processed segments
 */
function fillGapsAndMerge(segments: SpeakerSegment[]): SpeakerSegment[] {
  if (segments.length === 0) {
    return [];
  }

  const merged: SpeakerSegment[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const next = segments[i];
    const gap = next.start_time - current.end_time;

    // Check if next segment should be merged with current
    const shouldMerge =
      current.party === next.party ||
      (gap <= GAP_FILL_THRESHOLD_SECONDS &&
        current.party !== "UNKNOWN" &&
        next.party === current.party);

    if (shouldMerge) {
      // Merge segments
      current.end_time = next.end_time;
      current.confidence = (current.confidence + next.confidence) / 2;
    } else {
      // Push current and start new segment
      merged.push(current);
      current = { ...next };
    }
  }

  // Push final segment
  merged.push(current);

  return merged;
}

/**
 * Detect speakers and party affiliations from Bundestag video
 *
 * Main entry point for speaker detection pipeline:
 * 1. Extracts frames at intervals (cropped to bottom-third)
 * 2. Runs OCR on each frame
 * 3. Detects party keywords from OCR text
 * 4. Constructs timeline with party transitions
 * 5. Post-processes timeline (merges segments, fills gaps)
 *
 * @param input - Video file path and optional frame interval
 * @returns Speaker timeline with party-affiliated segments
 * @throws Error if video file missing, FFmpeg fails, or invalid parameters
 *
 * @example
 * ```typescript
 * const result = await detectSpeakers({
 *   videoFilePath: '/path/to/bundestag-stream.mp4',
 *   frameIntervalSeconds: 5,
 * });
 *
 * console.log(result.speaker_timeline);
 * // [
 * //   { start_time: 0, end_time: 120, party: "SPD", speaker: "Unknown", confidence: 0.85 },
 * //   { start_time: 120, end_time: 300, party: "CDU", speaker: "Unknown", confidence: 0.92 },
 * // ]
 * ```
 */
export async function detectSpeakers(
  input: SpeakerDetectionInput,
): Promise<SpeakerDetectionOutput> {
  const {
    videoFilePath,
    frameIntervalSeconds = DEFAULT_FRAME_INTERVAL_SECONDS,
  } = input;

  // Validate parameters
  if (!videoFilePath || videoFilePath.trim().length === 0) {
    throw new Error("Video file path is required");
  }

  if (frameIntervalSeconds <= 0) {
    throw new Error(
      `Frame interval must be positive, got: ${frameIntervalSeconds}`,
    );
  }

  console.log(
    `[SpeakerDetection] Starting speaker detection for: ${videoFilePath}`,
  );
  console.log(`[SpeakerDetection] Frame interval: ${frameIntervalSeconds}s`);

  const overallStartTime = Date.now();

  // Create temporary directory for frame extraction
  const tempDir = await mkdtemp(join(tmpdir(), "speaker-detection-"));
  console.log(`[SpeakerDetection] Created temp directory: ${tempDir}`);

  try {
    // Step 1: Extract frames
    const frames = await extractFrames(
      videoFilePath,
      frameIntervalSeconds,
      tempDir,
    );

    if (frames.length === 0) {
      console.warn(
        `[SpeakerDetection] No frames extracted from video: ${videoFilePath}`,
      );
      return { speaker_timeline: [] };
    }

    // Step 2: Run OCR on frames
    const ocrResults = await processOCRBatch(frames);

    // Step 3: Construct timeline
    const timeline = constructTimeline(ocrResults, frameIntervalSeconds);

    const overallTime = Date.now() - overallStartTime;
    console.log(
      `[SpeakerDetection] Speaker detection completed in ${overallTime}ms`,
    );
    console.log(
      `[SpeakerDetection] Detected ${timeline.length} party segments`,
    );

    return { speaker_timeline: timeline };
  } finally {
    // Always clean up temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
      console.log(`[SpeakerDetection] Cleaned up temp directory: ${tempDir}`);
    } catch (error) {
      console.warn(
        `[SpeakerDetection] Failed to clean up temp directory ${tempDir}:`,
        error,
      );
    }
  }
}
