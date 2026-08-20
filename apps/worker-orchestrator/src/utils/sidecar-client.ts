import {
  z,
  FaceResultSchema,
  AudioClassResultSchema,
  EmbeddingResultSchema,
  SceneDetectionResultSchema,
  TranscriptSchema,
  type FaceResult,
  type AudioClassResult,
  type EmbeddingResult,
  type SceneDetectionResult,
  type Transcript,
} from "@repo/contracts";
import { createContextLogger } from "@repo/logger";
import http from "node:http";

const logger = createContextLogger("sidecar-client");

// ── Sidecar base URLs ────────────────────────────────────────────────────────

const VLM_SIDECAR_URL =
  process.env["VLM_SIDECAR_URL"] ?? "http://localhost:8765";

const AUDIO_FACE_SIDECAR_URL =
  process.env["AUDIO_FACE_SIDECAR_URL"] ?? "http://localhost:8766";

// ── Public error class ───────────────────────────────────────────────────────

export class SidecarError extends Error {
  constructor(
    public readonly operation: string,
    public readonly status: number,
    public readonly responseBody: string,
    public readonly url: string,
  ) {
    super(
      `SidecarError [${operation}]: HTTP ${status} from ${url}: ${responseBody.slice(0, 500)}`,
    );
    this.name = "SidecarError";
  }
}

// ── Inline Zod schema for VLM label response ─────────────────────────────────
// Not in @repo/contracts — this is sidecar-internal and includes clip_id.

const VlmLabelResponseSchema = z.object({
  clip_id: z.string(),
  description: z.string(),
  shot_scale: z.string(),
  dominant_mood: z.string(),
  tags_characters: z.array(z.string()),
  tags_mood: z.array(z.string()),
  tags_location: z.array(z.string()),
  tags_action: z.array(z.string()),
  confidence: z.number(),
});

// ── Internal helper ──────────────────────────────────────────────────────────

/**
 * POST JSON to a sidecar endpoint and validate the response with the given Zod schema.
 *
 * - Throws SidecarError on HTTP error responses (status >= 400)
 * - Lets ZodError propagate so callers can decide how to handle validation failures
 * - Logs at debug level only (these calls are high-frequency in production)
 */
async function postJson<T>(
  url: string,
  body: unknown,
  schema: z.ZodSchema<T>,
  operationName: string,
  timeoutMs = 120_000,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  logger.debug({ url, status: response.status }, operationName);

  if (!response.ok) {
    const responseBody = await response.text();
    throw new SidecarError(operationName, response.status, responseBody, url);
  }

  const json: unknown = await response.json();
  return schema.parse(json);
}

// ── Exported param + response types ─────────────────────────────────────────

export interface LabelClipParams {
  clip_id: string;
  source_video_path: string;
  start_ms: number;
  end_ms: number;
  library_tag_vocabulary: Record<string, string[]>;
}

export interface VlmLabelResponse {
  clip_id: string;
  description: string;
  shot_scale: string;
  dominant_mood: string;
  tags_characters: string[];
  tags_mood: string[];
  tags_location: string[];
  tags_action: string[];
  confidence: number;
}

export interface TranscribeClipParams {
  clip_id: string;
  source_video_path: string;
  start_ms: number;
  end_ms: number;
}

export interface RecognizeFacesParams {
  clip_id: string;
  source_video_path: string;
  start_ms: number;
  end_ms: number;
  known_characters: Array<{ name: string; centroid: number[] }>;
}

export interface ClassifyAudioParams {
  clip_id: string;
  source_video_path: string;
  start_ms: number;
  end_ms: number;
}

// ── VLM sidecar (port 8765) ──────────────────────────────────────────────────

/**
 * Ask the VLM sidecar to label a clip.
 *
 * The sidecar extracts frames from [start_ms, end_ms] of the source video,
 * runs Ollama vision inference, and returns structured labels including
 * shot scale, mood, and tag categories.
 */
export async function labelClip(
  params: LabelClipParams,
): Promise<VlmLabelResponse> {
  return postJson(
    `${VLM_SIDECAR_URL}/label`,
    params,
    VlmLabelResponseSchema,
    "labelClip",
  );
}

/**
 * Ask the audio-face sidecar to transcribe the audio track of a clip segment.
 *
 * Uses WhisperX for word-level alignment and optional speaker diarization.
 * Routes to audio-face sidecar (port 8766) — NOT the VLM sidecar.
 */
export async function transcribeClip(
  params: TranscribeClipParams,
): Promise<Transcript> {
  return postJson(
    `${AUDIO_FACE_SIDECAR_URL}/transcribe`,
    params,
    TranscriptSchema,
    "transcribeClip",
    300_000, // 5 min — Whisper large-v3 on a 20s clip can take 2+ min on CPU
  );
}

// ── Audio-face sidecar (port 8766) ───────────────────────────────────────────

/**
 * Recognize known characters in a clip via ArcFace embeddings.
 *
 * Pass known_characters with pre-computed centroids (512-dim ArcFace vectors).
 * Returns per-detection bounding boxes, matched character names, and confidences.
 * The optional 512-dim embedding in FaceResult is used for centroid updates only.
 */
export async function recognizeFaces(
  params: RecognizeFacesParams,
): Promise<FaceResult[]> {
  return postJson(
    `${AUDIO_FACE_SIDECAR_URL}/faces`,
    params,
    z.array(FaceResultSchema),
    "recognizeFaces",
  );
}

/**
 * Classify the dominant audio class of a clip segment.
 *
 * Returns a dominant class (dialogue, music_only, speech_over_music, etc.)
 * plus a millisecond-resolution timeline of per-frame audio class predictions.
 */
export async function classifyAudio(
  params: ClassifyAudioParams,
): Promise<AudioClassResult> {
  return postJson(
    `${AUDIO_FACE_SIDECAR_URL}/audio-class`,
    params,
    AudioClassResultSchema,
    "classifyAudio",
  );
}

/**
 * Embed a text string using the dense+sparse hybrid embedding model.
 *
 * Returns a 1024-dim dense embedding and a sparse (SPLADE) embedding for
 * hybrid semantic + keyword retrieval in the clip library.
 * Routes to audio-face sidecar (port 8766) where BGE-M3 runs — NOT VLM sidecar.
 */
export async function embedText(text: string): Promise<EmbeddingResult> {
  return postJson(
    `${AUDIO_FACE_SIDECAR_URL}/embed`,
    { text },
    EmbeddingResultSchema,
    "embedText",
  );
}

/**
 * Run scene detection on a full source video via the audio-face sidecar.
 *
 * Uses node:http directly with a 35-minute socket timeout — TransNetV2 on
 * long (90-min) videos can take 20+ minutes, which exceeds undici's default
 * 5-minute headersTimeout. Throws on any failure; no fallback by design.
 */
export function detectScenes(
  sourceVideoPath: string,
): Promise<SceneDetectionResult> {
  const urlStr = `${AUDIO_FACE_SIDECAR_URL}/detect-scenes`;
  const parsed = new URL(urlStr);
  const body = JSON.stringify({ source_video_path: sourceVideoPath });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port) || 80,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () => {
          logger.debug({ url: urlStr, status: res.statusCode }, "detectScenes");
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new SidecarError("detectScenes", res.statusCode, raw, urlStr),
            );
            return;
          }
          try {
            const json: unknown = JSON.parse(raw);
            resolve(SceneDetectionResultSchema.parse(json));
          } catch (err) {
            reject(err);
          }
        });
      },
    );

    // 90 minutes — 92-min AV1 videos take ~50 min for TransNetV2 on CPU.
    req.setTimeout(90 * 60 * 1000, () => {
      req.destroy(
        new Error("detectScenes: HTTP request timed out after 90 minutes"),
      );
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Health-check both sidecars.
 *
 * Never throws — catches all errors and returns false for that sidecar.
 * Intended for startup checks and monitoring, not for request routing.
 */
export async function checkSidecarHealth(): Promise<{
  vlm: boolean;
  audioFace: boolean;
}> {
  const check = async (baseUrl: string): Promise<boolean> => {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      const ok = response.ok;
      logger.debug(
        { url: baseUrl, status: response.status, ok },
        "checkSidecarHealth",
      );
      return ok;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug(
        { url: baseUrl, error: msg },
        "checkSidecarHealth: unreachable",
      );
      return false;
    }
  };

  const [vlm, audioFace] = await Promise.all([
    check(VLM_SIDECAR_URL),
    check(AUDIO_FACE_SIDECAR_URL),
  ]);

  return { vlm, audioFace };
}
