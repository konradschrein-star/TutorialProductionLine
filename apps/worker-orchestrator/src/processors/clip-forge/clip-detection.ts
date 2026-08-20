import { join } from "node:path";
import type { Job, Queue } from "bullmq";
import {
  ClipForgeClipDetectionPayloadSchema,
  type ClipForgeClipDetectionPayload,
} from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { cfSources, cfRawClips, eq } from "@repo/db";
import { getConfig } from "@repo/config";
import { requestLLMText } from "../../utils/llm-client.js";
import { runSourceDetection } from "./run-detection.js";

/**
 * Clip Forge — Clip Detection.
 *
 * Loads the transcribed source, asks DeepSeek to find clippable moments, and
 * inserts one cf_raw_clips row per moment above the score threshold. Each
 * insertion enqueues a raw-render job.
 */
export function createCfClipDetectionProcessor(
  db: DrizzleClient,
  queues: { cfRawRender: Queue },
) {
  return async (job: Job<ClipForgeClipDetectionPayload>) => {
    const { source_id } = ClipForgeClipDetectionPayloadSchema.parse(job.data);
    const [source] = await db
      .select()
      .from(cfSources)
      .where(eq(cfSources.id, source_id))
      .limit(1);
    if (!source) throw new Error(`cf_sources row not found: ${source_id}`);
    if (source.status !== "transcribed") {
      throw new Error(
        `cf_sources ${source_id} is in status ${source.status}, expected 'transcribed'`,
      );
    }

    const detectionStartedAt = new Date().toISOString();
    await db
      .update(cfSources)
      .set({
        progress: {
          phase: "detecting_clips",
          started_at: detectionStartedAt,
          deepseek_pass: 1,
          updated_at: detectionStartedAt,
        },
      })
      .where(eq(cfSources.id, source_id))
      .catch(() => {});

    const words = (source.word_timings ?? []) as Array<{
      w: string;
      t0: number;
      t1: number;
    }>;
    if (words.length < 10) {
      throw new Error(
        `source ${source_id} has only ${words.length} word timings — refusing to detect clips`,
      );
    }

    if (!process.env["DEEPSEEK_API_KEY"])
      throw new Error(
        "DEEPSEEK_API_KEY env var is not set — clip detection cannot run",
      );

    const threshold = Number(process.env["CF_SCORE_THRESHOLD"] ?? 0.3);

    // Compose a compact transcript with word indices for the model to cite.
    const transcript = words.map((w, i) => `${i}:${w.w}`).join(" ");

    // Language drives the OUTPUT language of suggestedCaption + reason,
    // and tells DeepSeek what to expect in the transcript so it doesn't
    // try to "translate" before judging.
    const language =
      (source.language ?? "en").toLowerCase().slice(0, 8) || "en";
    const langName = languageNameOf(language);

    // Minimum acceptable clip duration (seconds). Below this, the segment
    // is too short to land on TikTok/IG/YT Shorts without feeling clipped.
    // Above 12s is the prompt target; the post-filter floor sits at 15s to
    // tolerate a small word-boundary slip.
    const MIN_CLIP_SEC = 15;
    const MAX_CLIP_SEC = 90;
    // Yield target per source. The first DeepSeek pass asks for 12–16 clips;
    // if fewer than this land, a follow-up "find more" pass runs.
    const TARGET_CLIPS = 8;

    type DetectedClip = {
      startWordIdx: number;
      endWordIdx: number;
      score: number;
      reasonCategory: string;
      suggestedCaption: string;
      reason: string;
    };

    const userPromptDe = `Titel der Quelle: ${source.title}\nDauer: ${source.duration_sec}s\nSprache: ${langName}\nTranskript:\n${transcript}`;
    const userPromptEn = `Source title: ${source.title}\nDuration: ${source.duration_sec}s\nLanguage: ${langName}\nTranscript:\n${transcript}`;
    const userPrompt = language === "de" ? userPromptDe : userPromptEn;

    const buildSystemPromptEn = (
      clipCount: { lo: number; hi: number },
      exclude?: string,
    ) =>
      [
        "You are a clip-mining LLM for a short-form video pipeline.",
        `The transcript is in ${langName} (ISO 639-1: ${language}). Do NOT translate it.`,
        "Read the transcript (each token is `index:word`) and return JSON only.",
        "Find clippable moments — controversial takes, punchlines, wisdom, hot takes, stories with a clean in/out.",
        `Each moment MUST: land on word boundaries, be 18–55 seconds long (target ~25–35s), and stand alone without prior context.`,
        "Do NOT propose clips shorter than 18 seconds — the rendered short feels cut off if it lands under 15s.",
        "Output strict JSON with shape:",
        `{"clips":[{"startWordIdx":<int>,"endWordIdx":<int>,"score":<0..1>,"reasonCategory":"controversial|wisdom|funny|story|educational|hot_take|hype|insight|reaction|rant|wholesome|other","suggestedCaption":"<short caption in ${langName}>","reason":"<one short sentence in ${langName}>"}]}`,
        `Write \`suggestedCaption\` and \`reason\` in ${langName} so they match the spoken language.`,
        "Score = how likely this clip is to perform on TikTok/IG/YT Shorts in its native market.",
        `Return between ${clipCount.lo} and ${clipCount.hi} clips. Cover different topics and pacing — don't all be from the same 5-minute window.`,
        exclude ?? "",
        "JSON only — no markdown, no commentary.",
      ]
        .filter(Boolean)
        .join("\n");

    // German variant. Same schema, same constraints — only the instruction
    // language changes so DeepSeek stays anchored in the target language
    // and doesn't drift into English-ish German for suggestedCaption / reason.
    const buildSystemPromptDe = (
      clipCount: { lo: number; hi: number },
      exclude?: string,
    ) =>
      [
        "Du bist ein Clip-Mining-LLM für eine Short-Form-Video-Pipeline.",
        "Das Transkript ist auf Deutsch (ISO 639-1: de). NICHT übersetzen.",
        "Lies das Transkript (jedes Token ist `index:wort`) und gib ausschließlich JSON zurück.",
        "Finde clip-würdige Momente — kontroverse Aussagen, Pointen, Weisheiten, hot takes, Geschichten mit sauberem Anfang und Ende.",
        "Jeder Moment MUSS: auf Wortgrenzen liegen, 18–55 Sekunden lang sein (Ziel ~25–35s) und ohne vorherigen Kontext funktionieren.",
        "KEINE Clips unter 18 Sekunden vorschlagen — der gerenderte Short wirkt sonst abgeschnitten.",
        "Gib striktes JSON in dieser Form aus:",
        `{"clips":[{"startWordIdx":<int>,"endWordIdx":<int>,"score":<0..1>,"reasonCategory":"controversial|wisdom|funny|story|educational|hot_take|hype|insight|reaction|rant|wholesome|other","suggestedCaption":"<kurze Caption auf Deutsch>","reason":"<ein kurzer Satz auf Deutsch>"}]}`,
        "Schreibe `suggestedCaption` und `reason` AUF DEUTSCH, passend zur gesprochenen Sprache.",
        "Score = wie wahrscheinlich der Clip auf TikTok/IG/YT Shorts im deutschsprachigen Markt performt.",
        `Gib zwischen ${clipCount.lo} und ${clipCount.hi} Clips zurück. Decke verschiedene Themen und Tempi ab — nicht alle aus demselben 5-Minuten-Fenster.`,
        exclude ?? "",
        "Nur JSON — kein Markdown, kein Kommentar.",
      ]
        .filter(Boolean)
        .join("\n");

    const buildSystemPrompt =
      language === "de" ? buildSystemPromptDe : buildSystemPromptEn;

    // Pinned to deepseek via the LLM router — clip detection quality
    // depends on this exact model; no fallback ladder, fail loudly so
    // BullMQ retries instead of shipping garbage clips from a local model.
    async function callDeepSeek(system: string): Promise<DetectedClip[]> {
      const raw = await requestLLMText(userPrompt, {
        provider: "deepseek",
        system,
        json: true,
        temperature: 0.3,
        context: `clip-forge:detect:${source_id}`,
      });
      try {
        const parsed = JSON.parse(raw) as { clips?: DetectedClip[] };
        return parsed.clips ?? [];
      } catch (e) {
        throw new Error(
          `DeepSeek returned non-JSON: ${(e as Error).message} — first 200 chars: ${raw.slice(0, 200)}`,
        );
      }
    }

    // First pass: ask for 12–16 clips.
    let clipsAll: DetectedClip[] = await callDeepSeek(
      buildSystemPrompt({ lo: 12, hi: 16 }),
    );

    function rangeOverlaps(
      a: { s: number; e: number },
      b: { s: number; e: number },
    ): boolean {
      return a.s < b.e && b.s < a.e;
    }

    function acceptable(c: {
      startWordIdx: number;
      endWordIdx: number;
      score: number;
    }) {
      if (c.score < threshold) return null;
      const sIdx = clampInt(c.startWordIdx, 0, words.length - 1);
      const eIdx = clampInt(c.endWordIdx, sIdx + 1, words.length - 1);
      const startSec = words[sIdx].t0;
      const endSec = words[eIdx].t1;
      if (endSec - startSec < MIN_CLIP_SEC || endSec - startSec > MAX_CLIP_SEC)
        return null;
      return { sIdx, eIdx, startSec, endSec };
    }

    let inserted = 0;
    // Seed the de-dupe set with the ranges ALREADY stored for this source.
    // Without this, every re-mine ("Mine clips" on an already-extracted
    // source) appends a fresh, near-identical set: the Marck Gebauer VOD
    // accumulated 61 rows containing triples like 996.3–1015.1 / 996.3–1013.6
    // / 990.0–1015.1, i.e. the same moment rendered three times.
    const priorClips = await db
      .select({
        start_sec: cfRawClips.start_sec,
        end_sec: cfRawClips.end_sec,
      })
      .from(cfRawClips)
      .where(eq(cfRawClips.source_id, source_id));
    const accepted: Array<{ s: number; e: number }> = priorClips.map((c) => ({
      s: c.start_sec,
      e: c.end_sec,
    }));

    async function persistClips(cs: DetectedClip[]) {
      for (const c of cs) {
        const a = acceptable(c);
        if (!a) continue;
        // De-dupe against already-accepted ranges from this source.
        if (
          accepted.some((r) => rangeOverlaps(r, { s: a.startSec, e: a.endSec }))
        )
          continue;
        await db.insert(cfRawClips).values({
          source_id: source_id,
          persona_id: source.persona_id,
          start_sec: a.startSec,
          end_sec: a.endSec,
          clip_score: c.score,
          score_reason: c.reason ?? "",
          categories: [c.reasonCategory],
          suggested_caption: c.suggestedCaption ?? "",
          reframe_recipe: {
            strategy: "centered-with-blur-bars",
            blurBars: true,
            splitScreen: false,
          },
          status: "detected",
        });
        accepted.push({ s: a.startSec, e: a.endSec });
        inserted++;
      }
    }

    await persistClips(clipsAll);

    // Retry pass: if we didn't land enough clips, ask DeepSeek for more,
    // explicitly excluding the timestamp ranges we already accepted so it
    // hunts in unexplored regions of the transcript.
    if (inserted < TARGET_CLIPS && accepted.length > 0) {
      const ranges = accepted
        .map((r) => `${r.s.toFixed(1)}–${r.e.toFixed(1)}`)
        .join(", ");
      const excludeStr =
        language === "de"
          ? `Vermeide diese bereits geclippten Zeitbereiche (in Sekunden): ${ranges}. Finde Clips in ANDEREN Teilen des Transkripts.`
          : `Avoid these already-clipped time ranges (in seconds): ${ranges}. Find clips in DIFFERENT parts of the transcript.`;
      try {
        const extra = await callDeepSeek(
          buildSystemPrompt({ lo: 8, hi: 12 }, excludeStr),
        );
        await persistClips(extra);
        clipsAll = clipsAll.concat(extra);
      } catch (e) {
        console.warn(
          `[cf-clip-detection] retry pass failed (continuing with first-pass clips): ${(e as Error).message}`,
        );
      }
    }

    // Auto-run source-wide detection (facecam layout + portrait crops).
    // We do this BEFORE enqueueing raw-render jobs so that by the time
    // raw-render's variant-generator hook fires for each clip, the
    // source's facecam_layout + portrait_crops are already populated.
    //
    // Failure-tolerant: any detector error is logged but doesn't fail the
    // clip-detection job (DeepSeek work is too expensive to lose). The
    // user just sees raw clips without overlays / variants and can
    // re-trigger detection via the admin script.
    await db
      .update(cfSources)
      .set({
        progress: {
          phase: "detecting_layout",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      })
      .where(eq(cfSources.id, source_id))
      .catch(() => {});
    try {
      const cfg = getConfig();
      const sourcePath = join(
        cfg.LOCAL_MEDIA_ROOT,
        "cf",
        source.persona_id,
        source_id,
        "source.mp4",
      );
      await runSourceDetection(db, {
        sourceId: source_id,
        sourcePath,
        durationSec: source.duration_sec,
      });
    } catch (e) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "[cf-clip-detection] source detection failed, continuing without overlay data",
          source_id,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }

    // We can't easily get the newly inserted IDs in one shot with Drizzle
    // without .returning(); re-query for status='detected' to enqueue them.
    const detected = await db
      .select()
      .from(cfRawClips)
      .where(eq(cfRawClips.source_id, source_id));
    for (const row of detected) {
      if (row.status === "detected") {
        await queues.cfRawRender.add("cf-raw-render", { raw_clip_id: row.id });
      }
    }

    await db
      .update(cfSources)
      .set({ status: "extracted", progress: null })
      .where(eq(cfSources.id, source_id));

    console.log(
      JSON.stringify({
        level: "info",
        msg: "[cf-clip-detection] complete",
        source_id,
        proposed: clipsAll.length,
        accepted: inserted,
      }),
    );
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function languageNameOf(code: string): string {
  const M: Record<string, string> = {
    en: "English",
    de: "German",
    fr: "French",
    es: "Spanish",
    it: "Italian",
    pt: "Portuguese",
    nl: "Dutch",
    pl: "Polish",
    ru: "Russian",
    tr: "Turkish",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
  };
  return M[code] ?? code;
}
