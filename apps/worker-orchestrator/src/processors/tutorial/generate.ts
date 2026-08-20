import type { Job, Queue } from "bullmq";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TutorialGeneratePayload, VoiceSettings } from "@repo/contracts";
import {
  TutorialGeneratePayloadSchema,
  TUTORIAL_PROVIDERS,
} from "@repo/contracts";
import type { DrizzleClient, ChannelVoice } from "@repo/db";
import {
  getTutorialJobById,
  updateTutorialJob,
  getPromptPresetById,
  getSecret,
  getTutorialSettings,
  createTutorialJob,
  listTutorialJobsByParent,
  getChannelVoice,
} from "@repo/db";
import { generateScript } from "../../utils/tutorial/llm-registry.js";
import { generateTutorialUploadMetadata } from "../../utils/tutorial/upload-metadata.js";
import {
  buildOutlinePrompt,
  buildExpansionPrompt,
  parseOutline,
  splitPartIfTooLong,
} from "../../utils/tutorial/long-form.js";
import {
  buildAnswerFirstScriptPrompt,
  targetMinutesForMode,
  tierExpectsMarkers,
} from "../../utils/tutorial/script-prompt.js";
import { buildTranscriptRewritePrompt } from "../../utils/tutorial/transcript-rewrite-prompt.js";
import { sanitizeScriptText } from "../../utils/tutorial/sanitize-script.js";
import {
  resolveSourceTranscript,
  SourceTranscriptError,
  type ResolvedSourceTranscript,
} from "../../utils/tutorial/source-transcript.js";
import {
  extractScriptStructure,
  structureFromParts,
  type ScriptStructure,
} from "../../utils/tutorial/script-structure.js";
import { createTutorialTTSProvider } from "../../utils/tutorial/tts-registry.js";
import { withTTSSlot } from "../../utils/tts-gateway.js";
import { ai33TTSCircuitBreaker } from "../../utils/ai33-circuit-breaker.js";
import { isFinalAttempt } from "../../utils/tutorial/attempts.js";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";
const FFPROBE_BIN = process.env["FFPROBE_PATH"] ?? "ffprobe";

/**
 * ffprobe the duration (seconds) of an audio file. Returns null (never throws)
 * if ffprobe is unavailable or the output is unparseable — audio_duration_s is
 * best-effort metrics data and must not fail the job.
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

const LOCAL_MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

const CHUNK_SIZE = 2000;

/**
 * Output-token ceilings for script generation.
 *
 * These were 4096 (single-shot) / 8192 (allowLonger) and 4096 was too small.
 * `deepseek-v4-pro` — the provider every recent tutorial job uses — is a
 * REASONING model, so `max_tokens` bounds `completion_tokens` INCLUDING its
 * reasoning tokens, and that reasoning spend is not stable: measured against the
 * live API on one identical prompt it used 413 reasoning tokens on one call and
 * 1671 on the next. A ~1,500-word script is already ~2,000 output tokens, so a
 * reasoning spike pushed the total past 4096 and the answer was cut off
 * mid-sentence — which is why production held scripts ending "…Then you checked
 * the confirmation and" and why re-rolling by hand "fixed" it.
 *
 * These are CEILINGS, not targets: billing is per token actually generated, so
 * raising the headroom costs nothing on a script that finishes normally. Length
 * is governed by the prompt's LENGTH line, not by this number. Verified accepted
 * by the DeepSeek API (8192/16384/32768/65536 all return 200).
 *
 * 2026-08-02: single-shot raised 16384 -> 32768. Over 20 live generations run
 * for this session's evaluation, one ordinary 6-minute from-scratch script spent
 * 14,840 reasoning tokens and finished at completion_tokens=16,250 — 134 tokens
 * short of the 16,384 ceiling. It returned finish_reason "stop", so it was a
 * near-miss rather than a failure, but the reasoning spend on that provider has
 * no stable upper bound (measured range across those 20 calls: 929 -> 14,840,
 * a 16x swing on comparable prompts). A ceiling that a real generation came
 * within 1% of is not headroom.
 */
const SCRIPT_MAX_TOKENS_SINGLE_SHOT = 32768;
const SCRIPT_MAX_TOKENS_LONG = 32768;

/**
 * Strip formatting artefacts before the script is persisted, and LOG whenever
 * anything had to be stripped. script_text is spoken verbatim by TTS, so
 * markdown that survives is read aloud. The log line keeps the prompt-side
 * problem visible rather than quietly cleaning up after it forever.
 */
function cleanScript(raw: string, jobId: string, what: string): string {
  const { text, report } = sanitizeScriptText(raw);
  if (report.changed) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message:
          "Tutorial script contained formatting markers; stripped before TTS",
        job_id: jobId,
        part: what,
        removed: report.removed,
      }),
    );
  }
  return text;
}

/**
 * Pull the section structure out of a generated script and return the
 * marker-free prose that goes to TTS.
 *
 * `script_text` stays exactly what it always was — the spoken words, nothing
 * else. The structure rides alongside in `script_structure`, which is what makes
 * chapters, subtopic banners, per-section QA and (eventually) avatar segments
 * possible without a second generation pass. A writer that ignores the marker
 * format is logged, not failed: the script itself is still fine, and pretending
 * we had structure when we did not would be worse than recording that we didn't.
 */
function splitScriptStructure(
  script: string,
  jobId: string,
  what: string,
  /**
   * Whether markers were ASKED FOR. SHORT-tier scripts (3-6 min) are deliberately
   * not asked for section markers — chapters are useless at that length and the
   * quota made the model manufacture sections to fill it. Without this flag every
   * short job logged a warning about structure nobody requested.
   */
  expectMarkers = true,
): { text: string; structure: ScriptStructure } {
  const { text, structure } = extractScriptStructure(script);
  const missing = structure.source === "none" && expectMarkers;
  console.log(
    JSON.stringify({
      level: missing ? "warn" : "info",
      message: missing
        ? "Tutorial script carried no section markers; structure unavailable"
        : "Tutorial script structure extracted",
      job_id: jobId,
      part: what,
      structure_source: structure.source,
      markers_requested: expectMarkers,
      section_count: structure.sections.length,
      subtopics: structure.sections.filter((s) => s.kind === "subtopic").length,
    }),
  );
  return { text, structure };
}

/**
 * Multi-language seam. When a job requests a non-English target language, append
 * a hard instruction so the LLM writes every spoken word in that language. Empty
 * or English (default) is a no-op — the base prompts already write English.
 */
function applyLanguage(prompt: string, language?: string | null): string {
  const lang = language?.trim();
  if (!lang || /^english$/i.test(lang)) return prompt;
  return `${prompt}\n\nWRITE THE ENTIRE SCRIPT IN ${lang}. Every spoken word must be in ${lang}.`;
}

/**
 * Split script text into chunks of at most CHUNK_SIZE characters,
 * breaking at sentence boundaries (period/exclamation/question + space).
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
 * Map a provider id (e.g. "ai33_elevenlabs", "minimax_llm") to the
 * encrypted_secrets `provider` slot it uses (e.g. "ai33", "minimax").
 * Returns null when the provider needs no stored key (e.g. gemini_pool).
 */
function resolveSecretProvider(
  type: "llm" | "tts",
  providerId: string,
): string | null {
  const list = type === "llm" ? TUTORIAL_PROVIDERS.llm : TUTORIAL_PROVIDERS.tts;
  const found = list.find((p) => p.id === providerId)?.secretProvider;
  if (found !== undefined) return found;
  // Chain-only providers that never appear in the UI provider list but do
  // need a key slot (e.g. the ai33_kokoro fallback uses the shared "ai33" key).
  return CHAIN_ONLY_SECRET_PROVIDER[providerId] ?? null;
}

/** Secret slots for internal fallback-chain providers absent from the UI list. */
const CHAIN_ONLY_SECRET_PROVIDER: Record<string, string> = {
  ai33_kokoro: "ai33",
};

/**
 * TTS fallback chain — tried in order after the user's selected provider
 * fails or has no key configured. Same-provider duplicates are deduped.
 * Each link is skipped silently if no API key is saved for it. After all
 * links fail, the job goes to FAILED_AUDIO with a combined error message.
 */
const TTS_FALLBACK_CHAIN = [
  // Fish Audio is THE primary TTS and must lead the chain. It is what actually
  // produces the work — 1,829 tutorial jobs vs 188 on ai33_minimax, and it is
  // the only link still used (last job today; the ai33 ones stop 2026-06-18).
  //
  // AI33 is mostly abolished, and leaving ai33_minimax at the head was actively
  // harmful: its key is dead (401 on every health poll), so the circuit breaker
  // below stripped every ai33_* link and dropped jobs onto minimax_official /
  // inworld_tts — i.e. the "default" TTS silently resolved to a third-choice
  // provider instead of Fish. Fish first fixes that; the rest stay purely as
  // failover and are skipped automatically when no key is configured.
  "fish_audio",
  "ai33_minimax",
  "ai33_kokoro",
  "minimax_official",
  "inworld_tts",
];

/** A Fish Audio voice is selected by `reference_id`: a 32-hex model id. */
const FISH_REF_RE = /^[0-9a-f]{32}$/i;

/**
 * The channel's bound voice (channels.voice_id → tts_voices, migration 0060),
 * but only if it belongs to the provider we are about to call — a channel bound
 * to an ElevenLabs voice must NOT have its id shipped to Fish. Fish is the only
 * provider whose voice-id format we can actually validate (32-hex reference_id),
 * and it is the primary provider, so the binding applies there only; every other
 * link in the fallback chain keeps its existing behaviour unchanged.
 */
function channelVoiceFor(
  providerId: string,
  channelVoice: ChannelVoice | null,
): string | null {
  if (!channelVoice) return null;
  if (providerId !== "fish_audio") return null;
  if (channelVoice.provider.toLowerCase() !== "fish") return null;
  return FISH_REF_RE.test(channelVoice.voice_id) ? channelVoice.voice_id : null;
}

/**
 * Different providers expect different voice-id formats. The user's
 * stored voice id is whatever they typed in the form for the *primary*
 * provider; we translate when falling back so the chain doesn't blow up
 * on voice mismatches.
 *
 * `channelVoice` is the voice bound to the job's channel. It sits BELOW an
 * explicit per-job voice (a VA typing a real Fish id still wins) and ABOVE the
 * env/hardcoded defaults — which is what makes "this channel uses this voice"
 * automatic without anyone touching the create form.
 *
 * `settingsDefaultVoice` is tutorial_settings.default_tts_voice. The create form
 * ALWAYS fills tts_voice, falling back to that setting, so a job carrying the
 * settings default is "the VA chose nothing", not an explicit override — and it
 * must not outrank the channel binding. Without this, someone setting the
 * settings default to a real Fish id would silently mute every channel binding
 * at once, which is exactly the class of surprise this work is removing.
 */
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
    // Kokoro is AI33 v3 (local, reliable). Voice ids are prefixed "kokoro_".
    return process.env["TUTORIAL_KOKORO_VOICE"] ?? "kokoro_bm_lewis";
  }
  if (providerId === "ai33_minimax") {
    // AI33 v3 Minimax voice ids are prefixed "minimax_". The user's stored
    // ElevenLabs voice won't work, so use an env-configured / default voice.
    return process.env["TUTORIAL_MINIMAX_VOICE"] ?? "minimax_209533299589189";
  }
  if (providerId === "inworld_tts") {
    return process.env["TUTORIAL_INWORLD_VOICE"] ?? "Tyler";
  }
  if (providerId === "minimax_official") {
    return process.env["TUTORIAL_MINIMAX_FALLBACK_VOICE"] ?? "male-qn-qingse";
  }
  if (providerId === "fish_audio") {
    // Fish Audio voice = reference_id (32-hex model id).
    //   1. an explicit per-job Fish id wins (unless it is merely the settings
    //      default, i.e. nobody actually chose it);
    //   2. else the channel's bound voice (channels.voice_id, migration 0060);
    //   3. else the configured/default voice (Alok).
    // Step 2 is what stopped every channel sounding identical: the stored job
    // voice is normally the settings default, which is NOT a Fish id.
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
 * Per-VA encrypted keys were ABOLISHED (Decision §2.1 / D3). Keys now live in
 * the ONE secrets area (encrypted_secrets, keyed by env-var name) resolved via
 * getSecret(). This maps a `secretProvider` slot to the env-var name(s) that
 * hold its key; when several are listed we load-balance across the present ones.
 */
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

/** Resolve the present keys among a candidate list. getSecret throws on absent, so
 * an absent candidate is treated as "not configured for this link" (chain-skip),
 * NOT a silent data fallback. */
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

/**
 * Look up an API key for a TTS provider via the global secrets area, trying the
 * env-var name(s) mapped to its secret slot and picking one at random when more
 * than one is present (load-balancing). Returns empty string only when the
 * provider needs no key (`secretProvider` is null) or none is configured — the
 * TTS fallback chain then skips this link.
 */
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

/**
 * Tutorial Generate Processor
 *
 * Handles two stages of tutorial generation:
 *   - "script": Fetches prompt preset, decrypts LLM API key, calls LLM to generate script,
 *               saves script_text + dispatches "tts" stage.
 *   - "tts": Decrypts TTS API key, generates audio in chunks via TTSProvider,
 *             concatenates with ffmpeg, saves audio_path + dispatches splice queue.
 */
/**
 * Word-count based segmenter for SIX_MIN_STITCH mode.
 * Splits a master script into segments of ~SEGMENT_WORDS words,
 * breaking at paragraph or sentence boundaries.
 */
const SEGMENT_WORDS = 900; // ~6 min at ~150 words/min

function segmentScriptByWords(script: string): string[] {
  const paragraphs = script.split(/\n\n+/);
  const segments: string[] = [];
  let current: string[] = [];
  let wordCount = 0;

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/).filter(Boolean).length;
    if (wordCount > 0 && wordCount + paraWords > SEGMENT_WORDS) {
      // Flush current segment
      segments.push(current.join("\n\n").trim());
      current = [para];
      wordCount = paraWords;
    } else {
      current.push(para);
      wordCount += paraWords;
    }
  }
  if (current.length > 0) {
    segments.push(current.join("\n\n").trim());
  }

  // If we ended up with a single segment anyway, return it
  if (segments.length === 0) return [script.trim()];
  return segments;
}

export function createTutorialGenerateProcessor(
  db: DrizzleClient,
  queues: {
    tutorialGenerate: Queue<TutorialGeneratePayload>;
  },
) {
  return async (job: Job<TutorialGeneratePayload>) => {
    const { jobId, stage } = TutorialGeneratePayloadSchema.parse(job.data);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Tutorial generate processor started",
        job_id: jobId,
        stage,
      }),
    );

    const tutorialJob = await getTutorialJobById(db, jobId);
    if (!tutorialJob) {
      throw new Error(`Tutorial job ${jobId} not found`);
    }

    try {
      if (stage === "script") {
        await updateTutorialJob(db, jobId, {
          status: "GENERATING_SCRIPT",
          progress: 10,
        });

        // Fetch prompt text
        let promptText = tutorialJob.custom_prompt ?? "";
        if (!promptText && tutorialJob.prompt_preset_id) {
          const preset = await getPromptPresetById(
            db,
            tutorialJob.prompt_preset_id,
          );
          if (!preset) {
            throw new Error(
              `Prompt preset ${tutorialJob.prompt_preset_id} not found`,
            );
          }
          promptText = preset.system_prompt;
        }
        if (!promptText) {
          throw new Error(`No prompt found for tutorial job ${jobId}`);
        }

        // The VA's text box (`steps_input`) used to be concatenated onto the
        // preset here and handed over as `baseInstructions` — which the script
        // prompt frames as "TONE, EXPERTISE and TOPIC only" and declares
        // overridden "without exception". So a VA asking for tips or things to
        // watch out for was making a structural request inside the one block
        // that discards structural requests, and it was silently dropped
        // (VA-reported 2026-08-05). It now travels separately and outranks the
        // preset. LONG_FORM already passed it separately to the outline prompt.
        const vaInstructions = tutorialJob.steps_input?.trim() || null;

        // ── Source transcript (TRANSCRIPT_REWRITE) ──────────────────────────
        // The VA used to hand-copy the reference video's transcript into a
        // textarea; if they left it blank the job silently fell through to the
        // from-scratch prompt and produced a script that was never grounded in
        // the video it was supposed to beat. Now the worker fetches the captions
        // itself from `reference_url` (same yt-dlp binary/cookies as the footage
        // stack) and FAILS LOUDLY when it cannot — a rewrite without its source
        // is not a rewrite.
        let sourceTranscript: ResolvedSourceTranscript | null = null;
        if (tutorialJob.source_mode === "TRANSCRIPT_REWRITE") {
          try {
            sourceTranscript = await resolveSourceTranscript({
              referenceTranscript: tutorialJob.reference_transcript,
              referenceUrl: tutorialJob.reference_url,
              language: tutorialJob.language,
            });
          } catch (err) {
            if (err instanceof SourceTranscriptError) {
              // Deterministic — retrying cannot conjure captions that do not
              // exist, so surface it immediately with the operator-facing text.
              throw new Error(
                `Reference transcript unavailable (${err.code}): ${err.message}`,
              );
            }
            throw err;
          }

          console.log(
            JSON.stringify({
              level: "info",
              message: "Tutorial reference transcript resolved",
              job_id: jobId,
              transcript_source: sourceTranscript.source,
              word_count: sourceTranscript.word_count,
              reference_url: tutorialJob.reference_url,
              source_video_seconds: sourceTranscript.video_seconds ?? null,
            }),
          );

          // Persist what we fetched so the VA can see it in the studio, a retry
          // does not re-hit YouTube, and `ref_video_seconds` (collected by the
          // form but never populated automatically) reflects the real source.
          if (sourceTranscript.source !== "provided") {
            await updateTutorialJob(db, jobId, {
              reference_transcript: sourceTranscript.transcript,
              reference_transcript_source: sourceTranscript.source,
              reference_transcript_fetched_at: new Date(),
              ...(sourceTranscript.video_seconds &&
              sourceTranscript.video_seconds > 0 &&
              !tutorialJob.ref_video_seconds
                ? {
                    ref_video_seconds: Math.round(
                      sourceTranscript.video_seconds,
                    ),
                  }
                : {}),
            });
          }
        }

        /** Source runtime for length targeting — fetched value wins over stale. */
        const refVideoSeconds =
          sourceTranscript?.video_seconds && sourceTranscript.video_seconds > 0
            ? Math.round(sourceTranscript.video_seconds)
            : (tutorialJob.ref_video_seconds ?? null);

        // Resolve the LLM API key from the ONE secrets area by env-var name
        // (per-VA keys abolished). Providers routed through a pool
        // (claude_pool / gemini_pool) need no per-call key -> "".
        const llmSecretProvider = resolveSecretProvider(
          "llm",
          tutorialJob.script_provider,
        );
        let llmApiKey = "";
        if (llmSecretProvider) {
          const keys = await presentKeys(
            db,
            envNamesForSlot(llmSecretProvider),
          );
          llmApiKey = keys[0] ?? "";
        }

        // ── LONG_FORM parent branch ─────────────────────────────────────────
        if (
          tutorialJob.mode === "LONG_FORM" &&
          tutorialJob.parent_job_id === null
        ) {
          const partMinutes = tutorialJob.part_length_minutes ?? 8;
          const targetMinutes = tutorialJob.target_minutes ?? 40;
          const nParts = Math.max(1, Math.ceil(targetMinutes / partMinutes));

          // Fold the operator's optional extra context/instructions into the
          // base guidance so it shapes BOTH the outline and every part expansion.
          // For TRANSCRIPT_REWRITE, the reference transcript rides along as
          // extra reference context (the LONG_FORM builders already treat
          // extra_context as transcript-style source material).
          const longFormContextParts: string[] = [];
          // The title is the phrase the viewer searched for; it was never sent
          // to the model on this path either (same gap as the single-shot one).
          if (tutorialJob.title?.trim()) {
            longFormContextParts.push(
              `VIDEO TITLE (the exact phrase the viewer searched for): ${tutorialJob.title.trim()}`,
            );
          }
          if (tutorialJob.extra_context?.trim()) {
            longFormContextParts.push(
              `ADDITIONAL CONTEXT & INSTRUCTIONS (from the operator):\n${tutorialJob.extra_context.trim()}`,
            );
          }
          if (sourceTranscript) {
            longFormContextParts.push(
              `SOURCE TRANSCRIPT (reference only — cover what it covers, but never copy its wording, ordering, or phrasing; rewrite everything in your own voice and improve on it):\n${sourceTranscript.transcript}`,
            );
          }
          const baseInstructions = applyLanguage(
            longFormContextParts.length > 0
              ? `${promptText}\n\n${longFormContextParts.join("\n\n")}`
              : promptText,
            tutorialJob.language,
          );

          // 1) Outline
          const outlineRaw = await generateScript({
            provider: tutorialJob.script_provider,
            prompt: buildOutlinePrompt(
              baseInstructions,
              tutorialJob.steps_input ?? "",
              nParts,
              partMinutes,
              {
                // The title is the promise the outline has to keep. Without it
                // the planner cannot tell an "Advanced" video from a "Complete
                // Course", which is how we shipped a 45-minute Advanced video
                // whose only advanced chapter started at minute 44.
                title: tutorialJob.title,
                totalMinutes: nParts * partMinutes,
              },
            ),
            apiKey: llmApiKey,
            model: tutorialJob.script_model ?? undefined,
            // A truncated outline is worse than a short script: parseOutline
            // would fail on the half-written JSON and kill the whole job.
            maxTokens: SCRIPT_MAX_TOKENS_SINGLE_SHOT,
          });
          const outline = parseOutline(outlineRaw);

          // 2) Expand each outline part, then sentence-bounded overflow split.
          //    Each chapter is written position-aware (the first opens the video,
          //    the last closes it, middle chapters flow on) and is told which
          //    chapters were already covered, so the stitched video reads as one
          //    continuous, non-repetitive tutorial.
          const parts: string[] = [];
          /**
           * Chapter title per emitted part. The outline was the ONLY structured
           * intermediate this pipeline ever produced and it was destroyed one
           * line later by `parts.join("\n\n")`. Keeping the titles alongside the
           * parts is what lets `structureFromParts` rebuild the same flat text
           * AND record where each chapter starts — the prerequisite for
           * chapters, banners and per-section QA.
           */
          const partTitles: Array<string | null> = [];
          const outlineParts = outline.parts;
          for (let pi = 0; pi < outlineParts.length; pi++) {
            const part = outlineParts[pi]!;
            const expanded = await generateScript({
              provider: tutorialJob.script_provider,
              prompt: buildExpansionPrompt(
                baseInstructions,
                part,
                partMinutes,
                { index: pi, total: outlineParts.length },
                outlineParts.slice(0, pi),
              ),
              apiKey: llmApiKey,
              model: tutorialJob.script_model ?? undefined,
              maxTokens: SCRIPT_MAX_TOKENS_SINGLE_SHOT,
            });
            const chunks = splitPartIfTooLong(
              cleanScript(expanded, jobId, `long_form_part_${pi + 1}`),
              partMinutes,
            );
            for (let ci = 0; ci < chunks.length; ci++) {
              parts.push(chunks[ci]!);
              partTitles.push(
                ci === 0 ? part.title : `${part.title} (continued)`,
              );
            }
          }

          // 3) Save assembled script on the parent; await recordings.
          //    `text` here is byte-identical to the old `parts.join("\n\n")` —
          //    structureFromParts joins the same trimmed parts the same way —
          //    so the TTS/child-part path is untouched; we just also keep the
          //    chapter boundaries instead of throwing them away.
          const longForm = structureFromParts(
            parts.map((text, i) => ({ title: partTitles[i] ?? null, text })),
          );
          // Upload metadata alongside the script, so Drive carries a real
          // description and tags instead of just a lowercase slug. Non-fatal by
          // design: a good script with no description still ships (the upload
          // sheet prints "(NOT GENERATED)"), whereas failing the job here would
          // throw away the expensive part over the cheap part.
          const uploadMeta = await generateTutorialUploadMetadata({
            title: tutorialJob.title ?? "",
            scriptText: longForm.text,
            provider: tutorialJob.script_provider,
            apiKey: llmApiKey,
            model: tutorialJob.script_model ?? undefined,
            language: tutorialJob.language,
          });

          await updateTutorialJob(db, jobId, {
            script_text: longForm.text,
            script_structure: longForm.structure,
            script_done_at: new Date(),
            description: uploadMeta.description,
            tags: uploadMeta.tags,
            status: "AWAITING_RECORDINGS",
            progress: 50,
          });

          // 4) One child per part; dispatch each child's TTS stage.
          for (let i = 0; i < parts.length; i++) {
            const child = await createTutorialJob(db, {
              created_by: tutorialJob.created_by,
              channel_id: tutorialJob.channel_id,
              parent_job_id: jobId,
              segment_index: i,
              title: `${tutorialJob.title} — Part ${i + 1}`,
              mode: "LONG_FORM",
              status: "GENERATING_AUDIO",
              steps_input: "",
              prompt_preset_id: tutorialJob.prompt_preset_id,
              custom_prompt: tutorialJob.custom_prompt,
              script_provider: tutorialJob.script_provider,
              script_model: tutorialJob.script_model,
              tts_provider: tutorialJob.tts_provider,
              tts_voice: tutorialJob.tts_voice,
              voice_settings: tutorialJob.voice_settings ?? undefined,
              script_text: parts[i],
              script_done_at: new Date(),
            });
            await queues.tutorialGenerate.add(
              "tutorial-generate",
              { jobId: child.id, stage: "tts" },
              { jobId: `tutorial-generate-tts-${child.id}`, attempts: 3 },
            );
          }

          console.log(
            JSON.stringify({
              level: "info",
              message: "Tutorial LONG_FORM: created child parts",
              parent_job_id: jobId,
              part_count: parts.length,
            }),
          );
          await job.updateProgress(50);
          return;
        }
        // ── End LONG_FORM parent branch ─────────────────────────────────────

        // Generate script via LLM registry. Single-shot modes (THREE_MIN,
        // SIX_MIN, and the SIX_MIN_STITCH master) get an answer-first, length-
        // targeted wrapper — without it the (terse) DeepSeek provider produced
        // scripts too short for the chosen length, and bloated ones for topics
        // that only needed a couple of minutes. LONG_FORM returned earlier and
        // is unaffected.
        const {
          targetMinutes: scriptTargetMinutes,
          allowLonger,
          tier: scriptTier,
        } = targetMinutesForMode(
          tutorialJob.mode,
          tutorialJob.target_minutes,
          refVideoSeconds,
        );
        // Source-mode branch: TRANSCRIPT_REWRITE rewrites the reference video's
        // transcript into our own unique script (the transcript is guaranteed
        // present here — resolveSourceTranscript threw otherwise); otherwise
        // research-based answer-first write. applyLanguage() folds in the
        // multi-language seam on whichever prompt we build.
        const singleShotPrompt = sourceTranscript
          ? buildTranscriptRewritePrompt({
              baseInstructions: promptText,
              vaInstructions,
              transcript: sourceTranscript.transcript,
              targetMinutes: scriptTargetMinutes,
              allowLonger,
              tier: scriptTier,
              title: tutorialJob.title,
              sourceVideoSeconds: refVideoSeconds,
              transcriptQuality:
                sourceTranscript.source === "youtube_auto_captions"
                  ? "auto"
                  : sourceTranscript.source === "youtube_manual_captions"
                    ? "human"
                    : "unknown",
            })
          : buildAnswerFirstScriptPrompt(promptText, scriptTargetMinutes, {
              allowLonger,
              tier: scriptTier,
              title: tutorialJob.title,
              vaInstructions,
            });
        console.log(
          JSON.stringify({
            level: "info",
            message: "Tutorial script prompt built",
            job_id: jobId,
            mode: tutorialJob.mode,
            source_mode: tutorialJob.source_mode,
            target_minutes: scriptTargetMinutes,
            tier: scriptTier,
            prompt_chars: singleShotPrompt.length,
          }),
        );
        const { text: scriptText, structure: scriptStructure } =
          splitScriptStructure(
            cleanScript(
              await generateScript({
                provider: tutorialJob.script_provider,
                prompt: applyLanguage(singleShotPrompt, tutorialJob.language),
                apiKey: llmApiKey,
                model: tutorialJob.script_model ?? undefined,
                maxTokens: allowLonger
                  ? SCRIPT_MAX_TOKENS_LONG
                  : SCRIPT_MAX_TOKENS_SINGLE_SHOT,
              }),
              jobId,
              "single_shot",
            ),
            jobId,
            "single_shot",
            tierExpectsMarkers(scriptTier),
          );

        // ── SIX_MIN_STITCH parent branch ────────────────────────────────────
        // Guard: only enter this branch when this job IS the parent
        // (mode == SIX_MIN_STITCH AND parent_job_id IS NULL).
        if (
          tutorialJob.mode === "SIX_MIN_STITCH" &&
          tutorialJob.parent_job_id === null
        ) {
          // Save master script on the parent, move parent to AWAITING_UPLOAD
          // (it waits for all child recordings to be spliced & COMPLETED).
          // Upload metadata alongside the script, so Drive carries a real
          // description and tags instead of just a lowercase slug. Non-fatal by
          // design: a good script with no description still ships (the upload
          // sheet prints "(NOT GENERATED)"), whereas failing the job here would
          // throw away the expensive part over the cheap part.
          const uploadMeta = await generateTutorialUploadMetadata({
            title: tutorialJob.title ?? "",
            scriptText: scriptText,
            provider: tutorialJob.script_provider,
            apiKey: llmApiKey,
            model: tutorialJob.script_model ?? undefined,
            language: tutorialJob.language,
          });

          await updateTutorialJob(db, jobId, {
            script_text: scriptText,
            script_structure: scriptStructure,
            script_done_at: new Date(),
            description: uploadMeta.description,
            tags: uploadMeta.tags,
            status: "AWAITING_UPLOAD",
          });

          // Split master script into word-capped segments
          const segments = segmentScriptByWords(scriptText);

          console.log(
            JSON.stringify({
              level: "info",
              message: "Tutorial SIX_MIN_STITCH: creating child segments",
              parent_job_id: jobId,
              segment_count: segments.length,
            }),
          );

          // Create a child job per segment and immediately dispatch its TTS stage
          for (let i = 0; i < segments.length; i++) {
            const child = await createTutorialJob(db, {
              created_by: tutorialJob.created_by,
              channel_id: tutorialJob.channel_id,
              parent_job_id: jobId,
              segment_index: i,
              title: `${tutorialJob.title} — Part ${i + 1}`,
              mode: "SIX_MIN",
              status: "GENERATING_AUDIO",
              steps_input: "",
              prompt_preset_id: tutorialJob.prompt_preset_id,
              custom_prompt: tutorialJob.custom_prompt,
              script_provider: tutorialJob.script_provider,
              script_model: tutorialJob.script_model,
              tts_provider: tutorialJob.tts_provider,
              tts_voice: tutorialJob.tts_voice,
              voice_settings: tutorialJob.voice_settings ?? undefined,
              script_text: segments[i],
              script_done_at: new Date(),
            });

            await queues.tutorialGenerate.add(
              "tutorial-generate",
              { jobId: child.id, stage: "tts" },
              { jobId: `tutorial-generate-tts-${child.id}`, attempts: 3 },
            );
          }

          await job.updateProgress(50);
          // Parent processing is complete for now — it waits for children
          return;
        }
        // ── End SIX_MIN_STITCH parent branch ────────────────────────────────

        // Upload metadata alongside the script, so Drive carries a real
        // description and tags instead of just a lowercase slug. Non-fatal by
        // design: a good script with no description still ships (the upload
        // sheet prints "(NOT GENERATED)"), whereas failing the job here would
        // throw away the expensive part over the cheap part.
        const uploadMeta = await generateTutorialUploadMetadata({
          title: tutorialJob.title ?? "",
          scriptText: scriptText,
          provider: tutorialJob.script_provider,
          apiKey: llmApiKey,
          model: tutorialJob.script_model ?? undefined,
          language: tutorialJob.language,
        });

        await updateTutorialJob(db, jobId, {
          script_text: scriptText,
          script_structure: scriptStructure,
          script_done_at: new Date(),
          description: uploadMeta.description,
          tags: uploadMeta.tags,
          status: "GENERATING_AUDIO",
          progress: 50,
        });

        console.log(
          JSON.stringify({
            level: "info",
            message: "Tutorial script generated",
            job_id: jobId,
            script_length: scriptText.length,
            structure_source: scriptStructure.source,
            section_count: scriptStructure.sections.length,
          }),
        );

        // Dispatch TTS stage. Append Date.now() to the BullMQ job id so a
        // regenerate-script call (which itself uses a timestamped id) can
        // re-dispatch TTS without BullMQ deduping against the original
        // run's `tutorial-generate-tts-${jobId}` job id. Without this the
        // regen would complete the script stage, silently drop the TTS
        // enqueue, and leave the job stuck in GENERATING_AUDIO forever.
        await job.updateProgress(50);
        await queues.tutorialGenerate.add(
          "tutorial-generate",
          { jobId, stage: "tts" },
          {
            jobId: `tutorial-generate-tts-${jobId}-${Date.now()}`,
            attempts: 3,
          },
        );
      } else {
        // stage === "tts"
        await updateTutorialJob(db, jobId, {
          status: "GENERATING_AUDIO",
          progress: 50,
        });

        const scriptText = tutorialJob.script_text;
        if (!scriptText) {
          throw new Error(
            `Tutorial job ${jobId} has no script_text for TTS stage`,
          );
        }

        // Merge default_voice_settings from settings with job-level voice_settings.
        // Job-level wins over defaults.
        const tutorialSettingsRow = await getTutorialSettings(db);
        const defaultVs = (tutorialSettingsRow.default_voice_settings ??
          {}) as Record<string, unknown>;
        const jobVs = (tutorialJob.voice_settings ?? {}) as Record<
          string,
          unknown
        >;
        const mergedVs: VoiceSettings = {
          ...defaultVs,
          ...jobVs,
        } as VoiceSettings;

        // The channel's bound narration voice (migration 0060). Null when the
        // job has no channel or the channel has none bound — in that case the
        // existing default chain applies unchanged. Never substitutes another
        // channel's voice.
        const channelVoice = tutorialJob.channel_id
          ? await getChannelVoice(db, tutorialJob.channel_id)
          : null;

        const outputDir = join(LOCAL_MEDIA_ROOT, "tutorial", jobId);
        await mkdir(outputDir, { recursive: true });

        const chunks = chunkScript(scriptText);

        // Build the provider chain. Picking the PRIMARY provider (the head of
        // TTS_FALLBACK_CHAIN, now fish_audio) opts into the full chain; any
        // other explicit selection runs exactly that provider, unchanged.
        //
        // This was hardcoded to "ai33_minimax". Once Fish became the default,
        // that meant the default path got NO failover at all while a provider
        // nobody selects kept the chain. Deriving it from the chain head keeps
        // the original intent — primary gets failover, explicit override does
        // not — and stays correct the next time the primary changes.
        //
        // If the AI33 TTS circuit breaker is open (key dead / service down),
        // strip all ai33_* providers so we go straight to the reliable fallback
        // instead of burning time on 401s for every job.
        const rawChain: string[] =
          tutorialJob.tts_provider === TTS_FALLBACK_CHAIN[0]
            ? [...TTS_FALLBACK_CHAIN]
            : [tutorialJob.tts_provider];

        const circuitOpen = ai33TTSCircuitBreaker.isOpen();
        const providerChain = circuitOpen
          ? rawChain.filter((p) => !p.startsWith("ai33_"))
          : rawChain;

        if (circuitOpen && rawChain.some((p) => p.startsWith("ai33_"))) {
          console.log(
            JSON.stringify({
              level: "warn",
              message:
                "AI33 TTS circuit open — skipping ai33 providers, jumping to fallback",
              job_id: jobId,
              skipped: rawChain.filter((p) => p.startsWith("ai33_")),
              effective_chain: providerChain,
            }),
          );
        }

        // Try each provider in turn. On success, return the chunk paths.
        // On failure, log + cleanup partial chunks + try next link.
        let chunkPaths: string[] = [];
        let providerUsed = "";
        const fallbackErrors: Array<{ provider: string; error: string }> = [];

        for (const providerId of providerChain) {
          const { apiKey, secretProvider } = await resolveTtsApiKey(
            db,
            providerId,
          );
          if (secretProvider && !apiKey) {
            // Provider needs a key but none is saved — quietly skip.
            fallbackErrors.push({
              provider: providerId,
              error: "no API key configured",
            });
            continue;
          }

          const voice = resolveVoiceForProvider(
            providerId,
            tutorialJob.tts_voice,
            channelVoice,
            tutorialSettingsRow.default_tts_voice,
          );

          console.log(
            JSON.stringify({
              level: "info",
              message: "Tutorial TTS voice resolved",
              job_id: jobId,
              provider: providerId,
              voice,
              job_tts_voice: tutorialJob.tts_voice,
              channel_id: tutorialJob.channel_id,
              channel_voice: channelVoice
                ? `${channelVoice.name} (${channelVoice.voice_id})`
                : null,
              source:
                channelVoice && voice === channelVoice.voice_id
                  ? "channel"
                  : voice === tutorialJob.tts_voice
                    ? "job"
                    : "default",
            }),
          );

          const attemptPaths: string[] = [];
          let attemptOk = true;
          try {
            // Construct INSIDE the try: an unknown provider id (e.g. a chain
            // member with no factory case) must skip to the next rung, never
            // throw outside the loop and abort the whole chain (T3/V21).
            const provider = createTutorialTTSProvider(providerId, apiKey, {
              voice,
              settings: mergedVs,
            });
            for (let i = 0; i < chunks.length; i++) {
              console.log(
                JSON.stringify({
                  level: "info",
                  message: "Generating TTS chunk",
                  job_id: jobId,
                  provider: providerId,
                  chunk_index: i,
                  chunk_count: chunks.length,
                }),
              );
              // Admission through the global TTS gateway queue: tutorial
              // has top priority (120), so this never waits on bulk
              // formats — but bulk can no longer bypass the shared cap.
              const chunkText = chunks[i]!;
              const audioBuffer = await withTTSSlot(
                {
                  format: "TUTORIAL_STUDIO",
                  provider: providerId,
                  context: `tutorial:${jobId}:chunk${i}`,
                  textLength: chunkText.length,
                },
                () => provider.generateChunk(chunkText, voice),
              );
              const chunkPath = join(outputDir, `tts-chunk-${i}.mp3`);
              await writeFile(chunkPath, audioBuffer);
              attemptPaths.push(chunkPath);

              // Progress: TTS runs 50% → 90% of overall job, mapped
              // linearly across chunks.
              const ttsProgress =
                50 + Math.floor(((i + 1) / chunks.length) * 40);
              await updateTutorialJob(db, jobId, {
                progress: ttsProgress,
              }).catch(() => {});
            }
          } catch (err) {
            attemptOk = false;
            const msg = err instanceof Error ? err.message : String(err);
            fallbackErrors.push({
              provider: providerId,
              error: msg.slice(0, 300),
            });
            console.warn(
              JSON.stringify({
                level: "warn",
                message: "Tutorial TTS provider failed, trying next link",
                job_id: jobId,
                provider: providerId,
                error: msg.slice(0, 300),
              }),
            );
            // If the failed provider is an AI33 provider, trigger circuit
            // breaker health check — on 401 it will open the circuit so
            // subsequent jobs skip AI33 entirely.
            if (providerId.startsWith("ai33_")) {
              void ai33TTSCircuitBreaker.onError(apiKey);
            }
            // Clean up partial chunk files before retrying with next provider.
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
          throw new Error(
            `All TTS providers failed:\n${fallbackErrors
              .map((e) => `  - ${e.provider}: ${e.error}`)
              .join("\n")}`,
          );
        }

        if (providerUsed !== tutorialJob.tts_provider) {
          console.log(
            JSON.stringify({
              level: "info",
              message: "Tutorial TTS used fallback provider",
              job_id: jobId,
              requested: tutorialJob.tts_provider,
              used: providerUsed,
            }),
          );
        }

        try {
          const audioPath = join(outputDir, "tts.mp3");
          const concatListPath = join(outputDir, "tts-concat.txt");
          await writeFile(
            concatListPath,
            chunkPaths.map((p) => `file '${p}'`).join("\n"),
          );
          // Concat all chunks AND normalise loudness to -14 LUFS in one pass
          // (same target as the drama pipeline) so output volume is consistent
          // across TTS providers. Works for a single chunk too.
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
          const { unlink } = await import("node:fs/promises");
          await unlink(concatListPath).catch(() => {});

          // T2: persist audio_duration_s. It was NEVER written, yet it is the
          // fallback in the minutes metric (tutorial-repository durExpr), so
          // LONG_FORM minutes silently under-counted. ffprobe the final audio.
          const audioDurationS = await probeAudioDurationSeconds(audioPath);

          await updateTutorialJob(db, jobId, {
            audio_path: audioPath,
            audio_done_at: new Date(),
            // Record the provider that actually generated this audio. Until
            // now a fallback win existed only in a log line, so there was no
            // way to tell whether a finished video was voiced by Fish or by
            // AI33. Always written (not just on mismatch) so the field means
            // "this is what made the audio" rather than "something odd
            // happened".
            tts_provider_used: providerUsed,
            ...(audioDurationS !== null
              ? { audio_duration_s: audioDurationS.toFixed(3) }
              : {}),
            status: "READY_TO_RECORD",
            // Pre-recording stages done; the next bump comes during splice
            // (90 → 100%).
            progress: 90,
          });

          // LONG_FORM: when every sibling part has audio, concat (copy) the
          // per-part tts.mp3 files into the parent's long_audio_path. This is a
          // pure stream copy — TTS is NEVER regenerated.
          if (tutorialJob.mode === "LONG_FORM" && tutorialJob.parent_job_id) {
            const siblings = await listTutorialJobsByParent(
              db,
              tutorialJob.parent_job_id,
            );
            const allHaveAudio =
              siblings.length > 0 && siblings.every((s) => s.audio_path);
            if (allHaveAudio) {
              const parentDir = join(
                LOCAL_MEDIA_ROOT,
                "tutorial",
                tutorialJob.parent_job_id,
              );
              await mkdir(parentDir, { recursive: true });
              const longAudioPath = join(parentDir, "long-audio.mp3");
              const listPath = join(parentDir, "long-audio-concat.txt");
              await writeFile(
                listPath,
                siblings.map((s) => `file '${s.audio_path}'`).join("\n"),
              );
              await execFileAsync(FFMPEG_BIN, [
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                listPath,
                "-c",
                "copy",
                "-y",
                longAudioPath,
              ]);
              await unlink(listPath).catch(() => {});
              await updateTutorialJob(db, tutorialJob.parent_job_id, {
                long_audio_path: longAudioPath,
              });
            }
          }

          console.log(
            JSON.stringify({
              level: "info",
              message: "Tutorial TTS audio saved",
              job_id: jobId,
              audio_path: audioPath,
            }),
          );
        } finally {
          // Clean up chunk files
          for (const p of chunkPaths) {
            const { unlink } = await import("node:fs/promises");
            await unlink(p).catch(() => {});
          }
        }
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Tutorial generate processor complete",
          job_id: jobId,
          stage,
        }),
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStage = stage === "script" ? "FAILED_SCRIPT" : "FAILED_AUDIO";

      // Only report FAILED_* once BullMQ has no retry left. DeepSeek hitting
      // its 120s per-call timeout is the single most common first-attempt
      // failure here (43 occurrences in one day of prod logs) and the retry
      // usually succeeds — but the failed status was written immediately, so
      // the VA saw a red "Script Generation Failed" card that then vanished.
      const finalAttempt = isFinalAttempt(job);

      console.error(
        JSON.stringify({
          level: finalAttempt ? "error" : "warn",
          message: finalAttempt
            ? "Tutorial generate processor failed"
            : "Tutorial generate attempt failed — retrying",
          job_id: jobId,
          stage,
          attempt: (job.attemptsMade ?? 0) + 1,
          max_attempts: job.opts?.attempts ?? 1,
          error: errorMessage,
        }),
      );

      if (finalAttempt) {
        try {
          await updateTutorialJob(db, jobId, {
            status: errorStage as "FAILED_SCRIPT" | "FAILED_AUDIO",
            error_stage: stage,
            error_message: errorMessage.slice(0, 500),
            // T8: error_detail was never written by any processor, so the VA
            // could not self-diagnose. Persist the full diagnostic (for TTS the
            // message already includes the per-provider chain attempted).
            error_detail: JSON.stringify({
              stage,
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
