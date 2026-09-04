import type { Job, Queue } from "bullmq";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  TutorialTranslatePayload,
  TutorialSplicePayload,
  VoiceSettings,
} from "@repo/contracts";
import {
  TutorialTranslatePayloadSchema,
  TUTORIAL_PROVIDERS,
} from "@repo/contracts";
import type { DrizzleClient, ChannelVoice, TutorialJob } from "@repo/db";
import {
  getTutorialJobById,
  updateTutorialJob,
  createTutorialJob,
  getSecret,
  getTutorialSettings,
  getChannelVoice,
  getVoiceForLanguage,
  tutorialJobs,
  channels,
  eq,
  and,
} from "@repo/db";
import { generateScript } from "../../utils/tutorial/llm-registry.js";
import { generateTutorialUploadMetadata } from "../../utils/tutorial/upload-metadata.js";
import { sanitizeScriptText } from "../../utils/tutorial/sanitize-script.js";
import {
  createTutorialTTSProvider,
  formatTtsChainFailure,
} from "../../utils/tutorial/tts-registry.js";
import { withTTSSlot } from "../../utils/tts-gateway.js";
import { ai33TTSCircuitBreaker } from "../../utils/ai33-circuit-breaker.js";
import { isFinalAttempt } from "../../utils/tutorial/attempts.js";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const FFPROBE_BIN = process.env["FFPROBE_PATH"] ?? "ffprobe";

const LOCAL_MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

const CHUNK_SIZE = 2000;

/** Output ceiling for the narration translation — mirror the single-shot script
 * ceiling in generate.ts so a long translated script is never guillotined. */
const TRANSLATE_MAX_TOKENS = 32768;

/**
 * Target language code → human-readable name for the LLM. The stored
 * `language` column carries the short code (de/fr/es/ja/ko, matching the
 * Localize UI + the translate payload); the model needs the full name.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  de: "German",
  fr: "French",
  it: "Italian",
  es: "Spanish",
  nl: "Dutch",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  pt: "Portuguese",
  pl: "Polish",
  cs: "Czech",
  ru: "Russian",
  ar: "Arabic",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  id: "Indonesian",
};

/**
 * ffprobe the duration (seconds) of an audio file. Returns null (never throws)
 * — audio_duration_s is best-effort metrics data and must not fail the job.
 */
async function probeAudioDurationSeconds(
  filePath: string,
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) ? seconds : null;
  } catch {
    return null;
  }
}

/** Secret slots for internal fallback-chain providers absent from the UI list. */
const CHAIN_ONLY_SECRET_PROVIDER: Record<string, string> = {
  ai33_kokoro: "ai33",
};

/**
 * Map a provider id to the encrypted_secrets `provider` slot it uses. Copied
 * from generate.ts (not exported there) — keeps the same key-resolution path.
 */
function resolveSecretProvider(
  type: "llm" | "tts",
  providerId: string,
): string | null {
  const list = type === "llm" ? TUTORIAL_PROVIDERS.llm : TUTORIAL_PROVIDERS.tts;
  const found = list.find((p) => p.id === providerId)?.secretProvider;
  if (found !== undefined) return found;
  return CHAIN_ONLY_SECRET_PROVIDER[providerId] ?? null;
}

/** env-var name(s) that hold each secret slot's key. Copied from generate.ts. */
const SECRET_PROVIDER_ENV_NAMES: Record<string, string[]> = {
  ai33: ["AI33_API_KEY", "AI33_API_KEY_2"],
  fish_audio: ["FISH_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  inworld: ["INWORLD_API_KEY"],
  elevenlabs: ["ELEVENLABS_API_KEY"],
  google: ["GEMINI_API_KEY"],
};

function envNamesForSlot(slot: string): string[] {
  return SECRET_PROVIDER_ENV_NAMES[slot] ?? [`${slot.toUpperCase()}_API_KEY`];
}

/** Resolve the present keys among a candidate list (absent → chain-skip). */
async function presentKeys(
  db: DrizzleClient,
  names: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const name of names) {
    try {
      out.push(await getSecret(db, name));
    } catch {
      /* not configured — this fallback-chain link is skipped */
    }
  }
  return out;
}

async function resolveTtsApiKey(
  db: DrizzleClient,
  providerId: string,
): Promise<{ apiKey: string; secretProvider: string | null }> {
  const secretProvider = resolveSecretProvider("tts", providerId);
  if (!secretProvider) return { apiKey: "", secretProvider: null };
  const keys = await presentKeys(db, envNamesForSlot(secretProvider));
  if (keys.length === 0) return { apiKey: "", secretProvider };
  const picked = keys[Math.floor(Math.random() * keys.length)]!;
  return { apiKey: picked, secretProvider };
}

/** TTS fallback chain — identical to generate.ts. */
const TTS_FALLBACK_CHAIN = [
  "fish_audio",
  "ai33_minimax",
  "ai33_kokoro",
  "minimax_official",
  "inworld_tts",
];

const FISH_REF_RE = /^[0-9a-f]{32}$/i;

function channelVoiceFor(
  providerId: string,
  channelVoice: ChannelVoice | null,
): string | null {
  if (!channelVoice) return null;
  if (providerId !== "fish_audio") return null;
  if (channelVoice.provider.toLowerCase() !== "fish") return null;
  return FISH_REF_RE.test(channelVoice.voice_id) ? channelVoice.voice_id : null;
}

/** Provider-specific voice resolution — copied from generate.ts. */
function resolveVoiceForProvider(
  providerId: string,
  originalVoice: string,
  channelVoice: ChannelVoice | null = null,
  settingsDefaultVoice = "",
): string {
  if (providerId === "ai33_elevenlabs") return originalVoice;
  if (providerId === "elevenlabs_official") {
    return originalVoice.replace(/^elevenlabs_/, "");
  }
  if (providerId === "ai33_kokoro") {
    return process.env["TUTORIAL_KOKORO_VOICE"] ?? "kokoro_bm_lewis";
  }
  if (providerId === "ai33_minimax") {
    return process.env["TUTORIAL_MINIMAX_VOICE"] ?? "minimax_209533299589189";
  }
  if (providerId === "inworld_tts") {
    return process.env["TUTORIAL_INWORLD_VOICE"] ?? "Tyler";
  }
  if (providerId === "minimax_official") {
    return process.env["TUTORIAL_MINIMAX_FALLBACK_VOICE"] ?? "male-qn-qingse";
  }
  if (providerId === "fish_audio") {
    const jobChoseVoice =
      FISH_REF_RE.test(originalVoice) &&
      originalVoice.trim() !== settingsDefaultVoice.trim();
    if (jobChoseVoice) return originalVoice;
    const bound = channelVoiceFor(providerId, channelVoice);
    if (bound) return bound;
    return (
      process.env["TUTORIAL_FISH_VOICE"] ?? "b7204d4e40ef4a548c7c8547b7f73492"
    );
  }
  return originalVoice;
}

/**
 * Normalise a `tts_voices.provider` value (which may be a human label like
 * "ElevenLabs"/"Fish" set via the Settings → Voices UI, or already a canonical
 * TTSProviderId) to the worker's TTSProviderId. Returns null when it can't be
 * mapped, so the caller falls back to the source/channel voice.
 */
function normalizeTtsProviderId(raw: string): string | null {
  const v = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const KNOWN = new Set([
    "fish_audio",
    "ai33_minimax",
    "ai33_kokoro",
    "ai33_elevenlabs",
    "minimax_official",
    "inworld_tts",
    "elevenlabs_official",
    "google_tts",
    "openai_tts",
  ]);
  if (KNOWN.has(v)) return v;
  const ALIASES: Record<string, string> = {
    fish: "fish_audio",
    fishaudio: "fish_audio",
    elevenlabs: "elevenlabs_official",
    eleven_labs: "elevenlabs_official",
    eleven: "elevenlabs_official",
    minimax: "minimax_official",
    inworld: "inworld_tts",
    google: "google_tts",
    googletts: "google_tts",
    gcp: "google_tts",
    openai: "openai_tts",
    ai33: "ai33_elevenlabs",
    ai33_official: "ai33_elevenlabs",
  };
  return ALIASES[v] ?? null;
}

/**
 * Split script text into chunks of at most CHUNK_SIZE characters, breaking at
 * sentence boundaries. Copied from generate.ts.
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
 * Synthesise TTS for the translated script into
 * `<LOCAL_MEDIA_ROOT>/tutorial/<childId>/tts.mp3`. Replicates the `tts` stage of
 * generate.ts: provider fallback chain + circuit breaker + gateway admission +
 * ffmpeg concat/loudnorm. Throws if every provider fails (never a placeholder).
 */
async function synthesizeTranslatedTts(
  db: DrizzleClient,
  args: {
    childId: string;
    scriptText: string;
    ttsProvider: string;
    ttsVoice: string;
    voiceSettings: Record<string, unknown> | null;
    channelId: string | null;
  },
): Promise<{
  audioPath: string;
  providerUsed: string;
  audioDurationS: number | null;
}> {
  const {
    childId,
    scriptText,
    ttsProvider,
    ttsVoice,
    voiceSettings,
    channelId,
  } = args;

  const tutorialSettingsRow = await getTutorialSettings(db);
  const defaultVs = (tutorialSettingsRow.default_voice_settings ??
    {}) as Record<string, unknown>;
  const jobVs = (voiceSettings ?? {}) as Record<string, unknown>;
  const mergedVs: VoiceSettings = { ...defaultVs, ...jobVs } as VoiceSettings;

  const channelVoice = channelId ? await getChannelVoice(db, channelId) : null;

  const outputDir = join(LOCAL_MEDIA_ROOT, "tutorial", childId);
  await mkdir(outputDir, { recursive: true });

  const chunks = chunkScript(scriptText);

  const rawChain: string[] =
    ttsProvider === TTS_FALLBACK_CHAIN[0]
      ? [...TTS_FALLBACK_CHAIN]
      : [ttsProvider];

  const circuitOpen = ai33TTSCircuitBreaker.isOpen();
  const providerChain = circuitOpen
    ? rawChain.filter((p) => !p.startsWith("ai33_"))
    : rawChain;

  let chunkPaths: string[] = [];
  let providerUsed = "";
  const fallbackErrors: Array<{ provider: string; error: string }> = [];

  for (const providerId of providerChain) {
    const { apiKey, secretProvider } = await resolveTtsApiKey(db, providerId);
    if (secretProvider && !apiKey) {
      fallbackErrors.push({
        provider: providerId,
        error: "no API key configured",
      });
      continue;
    }

    const voice = resolveVoiceForProvider(
      providerId,
      ttsVoice,
      channelVoice,
      tutorialSettingsRow.default_tts_voice,
    );

    const attemptPaths: string[] = [];
    let attemptOk = true;
    try {
      const provider = createTutorialTTSProvider(providerId, apiKey, {
        voice,
        settings: mergedVs,
      });
      for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks[i]!;
        const audioBuffer = await withTTSSlot(
          {
            format: "TUTORIAL_STUDIO",
            provider: providerId,
            context: `tutorial-translate:${childId}:chunk${i}`,
            textLength: chunkText.length,
          },
          () => provider.generateChunk(chunkText, voice),
        );
        const chunkPath = join(outputDir, `tts-chunk-${i}.mp3`);
        await writeFile(chunkPath, audioBuffer);
        attemptPaths.push(chunkPath);
      }
    } catch (err) {
      attemptOk = false;
      const msg = err instanceof Error ? err.message : String(err);
      fallbackErrors.push({ provider: providerId, error: msg.slice(0, 300) });
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "Tutorial translate TTS provider failed, trying next link",
          child_job_id: childId,
          provider: providerId,
          error: msg.slice(0, 300),
        }),
      );
      if (providerId.startsWith("ai33_")) {
        void ai33TTSCircuitBreaker.onError(apiKey);
      }
      for (const p of attemptPaths) {
        await unlink(p).catch(() => {});
      }
    }

    if (attemptOk) {
      chunkPaths = attemptPaths;
      providerUsed = providerId;
      break;
    }
  }

  if (chunkPaths.length === 0) {
    throw new Error(formatTtsChainFailure(fallbackErrors));
  }

  const audioPath = join(outputDir, "tts.mp3");
  const concatListPath = join(outputDir, "tts-concat.txt");
  try {
    await writeFile(
      concatListPath,
      chunkPaths.map((p) => `file '${p}'`).join("\n"),
    );
    await execFileAsync(FFMPEG_BIN, [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-af",
      "loudnorm=I=-14:TP=-2:LRA=11",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      "-y",
      audioPath,
    ]);
    await unlink(concatListPath).catch(() => {});
  } finally {
    for (const p of chunkPaths) {
      await unlink(p).catch(() => {});
    }
  }

  const audioDurationS = await probeAudioDurationSeconds(audioPath);
  return { audioPath, providerUsed, audioDurationS };
}

/**
 * Tutorial Translate Processor
 *
 * One job per target language. Steps:
 *   1. Load the source job; require COMPLETED with recording_path + script_text.
 *   2. LLM-translate the narration, title, and upload metadata.
 *   3. Re-synthesise TTS in the target language.
 *   4. Create (or reuse) a CHILD tutorial_job that reuses the SOURCE recording.
 *   5. Enqueue the existing TUTORIAL_SPLICE lane for the child — splice + the
 *      Drive scanner finish it.
 */
export function createTutorialTranslateProcessor(
  db: DrizzleClient,
  queues: {
    tutorialSplice: Queue<TutorialSplicePayload>;
  },
) {
  return async (job: Job<TutorialTranslatePayload>) => {
    const { sourceJobId, targetLanguage } =
      TutorialTranslatePayloadSchema.parse(job.data);
    const languageName = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;

    console.log(
      JSON.stringify({
        level: "info",
        message: "Tutorial translate processor started",
        source_job_id: sourceJobId,
        target_language: targetLanguage,
      }),
    );

    // Resolved as soon as the child exists — so the catch block can mark it
    // FAILED_AUDIO on the final attempt instead of leaving it half-built.
    let childId: string | null = null;

    try {
      const source = await getTutorialJobById(db, sourceJobId);
      if (!source) {
        throw new Error(`Source tutorial job ${sourceJobId} not found`);
      }
      if (source.status !== "COMPLETED") {
        throw new Error(
          `Source tutorial job ${sourceJobId} is ${source.status}, not COMPLETED — cannot translate`,
        );
      }
      if (!source.recording_path) {
        throw new Error(
          `Source tutorial job ${sourceJobId} has no recording_path — nothing to reuse`,
        );
      }
      if (!source.script_text) {
        throw new Error(
          `Source tutorial job ${sourceJobId} has no script_text — nothing to translate`,
        );
      }

      // Idempotency: a BullMQ retry re-runs this whole processor. Reuse an
      // existing child for (source, language) so a retry never creates a
      // duplicate translated job.
      const [existingChild] = (await db
        .select()
        .from(tutorialJobs)
        .where(
          and(
            eq(tutorialJobs.source_job_id, source.id),
            eq(tutorialJobs.language, targetLanguage),
          ),
        )
        .limit(1)) as TutorialJob[];

      if (existingChild && existingChild.status === "COMPLETED") {
        console.log(
          JSON.stringify({
            level: "info",
            message: "Tutorial translate: child already COMPLETED — skipping",
            source_job_id: sourceJobId,
            target_language: targetLanguage,
            child_job_id: existingChild.id,
          }),
        );
        return;
      }

      // Resolve the LLM key exactly as generate.ts does (per-VA keys abolished).
      const llmSecretProvider = resolveSecretProvider(
        "llm",
        source.script_provider,
      );
      let llmApiKey = "";
      if (llmSecretProvider) {
        const keys = await presentKeys(db, envNamesForSlot(llmSecretProvider));
        llmApiKey = keys[0] ?? "";
      }

      // 1) Translate the narration.
      const rawTranslated = await generateScript({
        provider: source.script_provider,
        model: source.script_model ?? undefined,
        apiKey: llmApiKey,
        maxTokens: TRANSLATE_MAX_TOKENS,
        prompt:
          `Translate the following software-tutorial narration into ${languageName}. ` +
          `Output ONLY the spoken words, no notes, no markdown.\n\n${source.script_text}`,
      });
      const { text: translatedScript } = sanitizeScriptText(rawTranslated);
      if (!translatedScript.trim()) {
        throw new Error(
          `Translation returned empty narration for ${sourceJobId} → ${targetLanguage}`,
        );
      }

      // 2) Translate the title (short call). A source-language title is not a
      // valid fallback for a localized publication job: fail this attempt and
      // retry instead of creating a plausible-looking mixed-language child.
      let translatedTitle: string;
      try {
        const rawTitle = await generateScript({
          provider: source.script_provider,
          model: source.script_model ?? undefined,
          apiKey: llmApiKey,
          maxTokens: 500,
          prompt:
            `Translate this software-tutorial video title into ${languageName}. ` +
            `Output ONLY the translated title, nothing else.\n\n${source.title}`,
        });
        const cleaned = rawTitle
          .trim()
          .replace(/^["'`]+|["'`]+$/g, "")
          .split("\n")[0]
          ?.trim();
        if (!cleaned) {
          throw new Error("title translation returned no usable text");
        }
        translatedTitle = cleaned;
      } catch (titleErr) {
        throw new Error(
          `Title translation failed for ${targetLanguage}: ${
            titleErr instanceof Error ? titleErr.message : String(titleErr)
          }`,
        );
      }

      // 3) Translated upload metadata (non-fatal — mirrors generate.ts).
      const uploadMeta = await generateTutorialUploadMetadata({
        title: translatedTitle,
        scriptText: translatedScript,
        provider: source.script_provider,
        apiKey: llmApiKey,
        model: source.script_model ?? undefined,
        language: languageName,
      });

      // 3b) Resolve a NATIVE per-language voice. If the friend configured a
      //     voice for this target language in Settings → Voices, synthesize the
      //     localized audio in that native voice/provider instead of reusing the
      //     English source voice. No per-language voice configured → keep the
      //     source (and channel) voice exactly as before.
      let ttsProvider = source.tts_provider;
      let ttsVoice = source.tts_voice;
      const langVoice = await getVoiceForLanguage(db, targetLanguage);
      if (langVoice) {
        const mappedProvider = normalizeTtsProviderId(langVoice.provider);
        if (mappedProvider) {
          ttsProvider = mappedProvider;
          ttsVoice = langVoice.voice_id;
          console.log(
            JSON.stringify({
              level: "info",
              message: "Tutorial translate: using native per-language voice",
              source_job_id: sourceJobId,
              target_language: targetLanguage,
              provider: mappedProvider,
              voice_id: langVoice.voice_id,
            }),
          );
        }
      }

      // 3c) Route the child to the TARGET-LANGUAGE channel (e.g. German
      //     translations → the German channel) so Drive filing and the future
      //     uploader target the right brand. Falls back to the source channel.
      let targetChannelId = source.channel_id;
      const [langChannel] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(
          and(
            eq(channels.language, targetLanguage),
            eq(channels.accepts_tutorials, true),
          ),
        )
        .limit(1);
      if (langChannel) targetChannelId = langChannel.id;

      // 4) Create or reuse the CHILD job (reuses the SOURCE recording).
      if (existingChild) {
        childId = existingChild.id;
        await updateTutorialJob(db, childId, {
          title: translatedTitle,
          script_text: translatedScript,
          script_done_at: new Date(),
          description: uploadMeta.description,
          tags: uploadMeta.tags,
          thumbnail_text_top: uploadMeta.thumbnailTextTop,
          thumbnail_text_bottom: uploadMeta.thumbnailTextBottom,
          tts_provider: ttsProvider,
          tts_voice: ttsVoice,
          channel_id: targetChannelId,
          recording_path: source.recording_path,
          recorded_at: new Date(),
          status: "GENERATING_AUDIO",
          progress: 50,
        });
      } else {
        const child = await createTutorialJob(db, {
          created_by: source.created_by,
          title: translatedTitle,
          mode: source.mode,
          steps_input: "",
          source_job_id: source.id,
          language: targetLanguage,
          script_text: translatedScript,
          script_done_at: new Date(),
          description: uploadMeta.description,
          tags: uploadMeta.tags,
          thumbnail_text_top: uploadMeta.thumbnailTextTop,
          thumbnail_text_bottom: uploadMeta.thumbnailTextBottom,
          script_provider: source.script_provider,
          script_model: source.script_model,
          tts_provider: ttsProvider,
          tts_voice: ttsVoice,
          voice_settings: source.voice_settings ?? undefined,
          channel_id: targetChannelId,
          recording_path: source.recording_path,
          recorded_at: new Date(),
          status: "GENERATING_AUDIO",
          progress: 50,
        });
        childId = child.id;
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Tutorial translate: child job ready, synthesising TTS",
          source_job_id: sourceJobId,
          target_language: targetLanguage,
          child_job_id: childId,
        }),
      );

      // 5) Re-synthesise TTS in the target language.
      const { audioPath, providerUsed, audioDurationS } =
        await synthesizeTranslatedTts(db, {
          childId,
          scriptText: translatedScript,
          ttsProvider,
          ttsVoice,
          voiceSettings: source.voice_settings ?? null,
          channelId: source.channel_id,
        });

      // 6) Mark the child ready for splice (AWAITING_UPLOAD is the state
      //    publishRecording lands non-LONG_FORM jobs in before enqueueing
      //    splice — the entry state the splice processor expects).
      await updateTutorialJob(db, childId, {
        audio_path: audioPath,
        audio_done_at: new Date(),
        tts_provider_used: providerUsed,
        ...(audioDurationS !== null
          ? { audio_duration_s: audioDurationS.toFixed(3) }
          : {}),
        status: "AWAITING_UPLOAD",
        progress: 90,
      });

      // 7) Hand off to the existing splice lane (idempotent BullMQ job id).
      await queues.tutorialSplice.add(
        "tutorial-splice",
        { jobId: childId },
        { jobId: `tutorial-splice-${childId}`, attempts: 2 },
      );

      console.log(
        JSON.stringify({
          level: "info",
          message: "Tutorial translate processor complete — splice enqueued",
          source_job_id: sourceJobId,
          target_language: targetLanguage,
          child_job_id: childId,
          tts_provider_used: providerUsed,
        }),
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const finalAttempt = isFinalAttempt(job);

      console.error(
        JSON.stringify({
          level: finalAttempt ? "error" : "warn",
          message: finalAttempt
            ? "Tutorial translate processor failed"
            : "Tutorial translate attempt failed — retrying",
          source_job_id: sourceJobId,
          target_language: targetLanguage,
          child_job_id: childId,
          attempt: (job.attemptsMade ?? 0) + 1,
          max_attempts: job.opts?.attempts ?? 1,
          error: errorMessage,
        }),
      );

      // Only surface FAILED_* on the last attempt, and only if the child
      // exists — mirrors generate.ts. Never fabricate an output.
      if (finalAttempt && childId) {
        try {
          await updateTutorialJob(db, childId, {
            status: "FAILED_AUDIO",
            error_stage: "translate",
            error_message: errorMessage.slice(0, 500),
            error_detail: JSON.stringify({
              stage: "translate",
              target_language: targetLanguage,
              message: errorMessage,
              at: new Date().toISOString(),
            }),
          });
        } catch {
          // no-op
        }
      }
      throw err;
    }
  };
}
