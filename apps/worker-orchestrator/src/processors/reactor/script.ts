import type { Job, Queue } from "bullmq";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactorScriptPayload } from "@repo/contracts";
import { ReactorScriptPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs, eq } from "@repo/db";
import { getConfig } from "@repo/config";
import { requestLLMText } from "../../utils/llm-client.js";
import { updateJobStatus } from "../../utils/update-job-status.js";
import { updateJobMetadata } from "../../utils/job-helpers.js";

interface ReactorClip {
  start: number;
  end: number;
}

interface ReactorSegment {
  clip: ReactorClip;
  comment: string;
}

export interface ReactorScript {
  intro_clips: ReactorClip[];
  segments: ReactorSegment[];
  cta_segment: ReactorSegment;
  outro_clips: ReactorClip[];
}

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

/**
 * Snap a reactor clip's start/end to the nearest Whisper word boundaries.
 *
 * - `clip.start` becomes the START of the first word at-or-after the picked time.
 *   (Ensures the source video resumes at a real spoken word, not mid-pause/mid-word.)
 * - `clip.end` becomes the END of the last word at-or-before the picked time.
 *   (Ensures the cut-out happens after the last spoken word finishes, not mid-word.)
 *
 * Tolerance of ±0.1s around the LLM's picked time to absorb its rounding.
 */
function snapClipToWords(
  clip: { start: number; end: number },
  words: WhisperWord[],
): { start: number; end: number } {
  if (words.length === 0) return clip;

  let startWord: WhisperWord | undefined;
  for (const w of words) {
    if (w.start >= clip.start - 0.1) {
      startWord = w;
      break;
    }
  }
  if (!startWord) startWord = words[0]!;

  let endWord: WhisperWord = words[0]!;
  for (const w of words) {
    if (w.end <= clip.end + 0.1) endWord = w;
    else break;
  }

  // Guard against inverted ranges from extreme LLM picks.
  if (startWord.start >= endWord.end) return clip;
  return { start: startWord.start, end: endWord.end };
}

function snapReactorScriptToWords(
  script: ReactorScript,
  words: WhisperWord[],
): ReactorScript {
  return {
    intro_clips: script.intro_clips.map((c) => snapClipToWords(c, words)),
    segments: script.segments.map((s) => ({
      ...s,
      clip: snapClipToWords(s.clip, words),
    })),
    cta_segment: {
      ...script.cta_segment,
      clip: snapClipToWords(script.cta_segment.clip, words),
    },
    outro_clips: script.outro_clips.map((c) => snapClipToWords(c, words)),
  };
}

function buildReactorPrompt(
  words: WhisperWord[],
  totalDuration: number,
  language: string,
): string {
  // Build a timestamped transcript block
  const lines: string[] = [];
  let currentLine: string[] = [];
  let lineStart = words[0]?.start ?? 0;

  for (const w of words) {
    currentLine.push(w.word);
    if (
      currentLine.length >= 12 ||
      w.word.endsWith(".") ||
      w.word.endsWith("?") ||
      w.word.endsWith("!")
    ) {
      lines.push(`[${lineStart.toFixed(1)}s] ${currentLine.join(" ")}`);
      currentLine = [];
      lineStart = w.end;
    }
  }
  if (currentLine.length > 0) {
    lines.push(`[${lineStart.toFixed(1)}s] ${currentLine.join(" ")}`);
  }

  const transcript = lines.join("\n");
  const ctaTimestamp = (totalDuration * 0.7).toFixed(1);
  const outputLang = language === "de" ? "Deutsch" : "English";

  return `Du bist ein 40-jähriger Deutscher. Scharfer, frustrierter Kommentator politischer Debatten und Talkshows. Du bist kritisch gegenüber dem Öffentlich-Rechtlichen (ARD, ZDF). Du willst Besseres für Deutschland. Du bist kompetent und sachlich. Du weist auf irreführende Aussagen und Logiklücken hin — ohne zu lügen. Nur Meinungen und Faktenchecks. Kein Unsinn. Trockener Humor. Ton: Jan-Böhmermann-Kompetenz, aber weniger Komödie, mehr Frustration.

Das Video hat eine Gesamtdauer von ${totalDuration.toFixed(1)} Sekunden.
Der CTA-Moment soll bei ca. ${ctaTimestamp}s sein (70%-Marke).

TRANSKRIPT (mit Zeitstempeln in Sekunden):
${transcript}

AUFGABE:
Erstelle ein Reaktions-Skript für dieses Video. Wähle die interessantesten, kontroversesten oder informativsten Clip-Segmente aus. Zwischen den Clips kommentierst du als frustrierter, kompetenter Beobachter.

REGELN:
- Intro: 3-5 kurze Clips (jeweils 5-15 Sekunden) für den Einstieg — die besten Zitate oder Momente
- Segmente: Abwechselnd Clip → Kommentar, bis zur 70%-Marke
- CTA-Segment: Bei ca. ${ctaTimestamp}s — Clip + Kommentar mit Call-to-Action (z.B. "Abonnieren wenn ihr mehr davon wollt")
- Outro-Clips: 1-2 abschließende Clips ohne Kommentar
- Kommentare: kurz und prägnant, 1-4 Sätze, in ${outputLang}
- Clip-Zeiten: exakte Sekunden aus dem Transkript (start/end)

Antworte NUR mit validem JSON, ohne Erklärungen oder Markdown-Blöcke. Exakt dieses Format:
{
  "intro_clips": [{"start": 0.0, "end": 10.0}],
  "segments": [
    {"clip": {"start": 12.0, "end": 25.0}, "comment": "Kommentar hier."}
  ],
  "cta_segment": {"clip": {"start": ${ctaTimestamp}, "end": ${(Number(ctaTimestamp) + 15).toFixed(1)}}, "comment": "Falls ihr mehr solche Analysen wollt — Kanal abonnieren."},
  "outro_clips": [{"start": 0.0, "end": 5.0}]
}`;
}

export function createReactorScriptProcessor(
  db: DrizzleClient,
  queues: { reactorTTS: Queue },
) {
  return async (job: Job<ReactorScriptPayload>) => {
    const { job_id } = ReactorScriptPayloadSchema.parse(job.data);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Reactor script processor started",
        job_id,
      }),
    );

    try {
      const [contentJob] = await db
        .select()
        .from(contentJobs)
        .where(eq(contentJobs.id, job_id))
        .limit(1);

      if (!contentJob) throw new Error(`Job ${job_id} not found`);

      const meta = (contentJob.metadata ?? {}) as Record<string, unknown>;
      const transcriptRelPath = meta["reference_transcript_path"] as
        | string
        | undefined;
      if (!transcriptRelPath) {
        throw new Error(
          `No reference_transcript_path in metadata for ${job_id}`,
        );
      }

      const config = getConfig();
      const transcriptPath = join(config.LOCAL_MEDIA_ROOT, transcriptRelPath);
      const transcriptJson = await readFile(transcriptPath, "utf-8");
      const { words } = JSON.parse(transcriptJson) as { words: WhisperWord[] };

      if (!words || words.length === 0) {
        throw new Error(`Transcript is empty for job ${job_id}`);
      }

      const totalDuration = words[words.length - 1]!.end;
      const language = contentJob.language ?? "de";
      const prompt = buildReactorPrompt(words, totalDuration, language);

      // DeepSeek: large-context, reliable JSON, and the endorsed default LLM.
      // (claude_pool's /v1/run caps prompts at 10k chars — far smaller than the
      // timestamped-transcript prompt; gemini_pool is down; so pin deepseek.)
      const response = await requestLLMText(prompt, {
        provider: "deepseek",
        maxTokens: 16000,
        timeoutMs: 600_000,
        context: "reactor-script",
      });

      // Strip markdown code fences, then defensively extract the outermost
      // JSON object so stray prose before/after the object doesn't break parse.
      let cleaned = response
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace > 0 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }

      let reactorScript: ReactorScript;
      try {
        reactorScript = JSON.parse(cleaned) as ReactorScript;
      } catch (parseErr) {
        throw new Error(
          `Claude returned invalid JSON for reactor script: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. Response was: ${cleaned.slice(0, 300)}`,
        );
      }

      if (
        !Array.isArray(reactorScript.segments) ||
        reactorScript.segments.length === 0
      ) {
        throw new Error(`Reactor script has no segments for job ${job_id}`);
      }
      if (!reactorScript.cta_segment?.comment) {
        throw new Error(`Reactor script missing cta_segment for job ${job_id}`);
      }

      // Snap every clip start/end to actual Whisper word boundaries. The LLM
      // picks float seconds off the displayed line stamps which can land
      // mid-pause or mid-word. After snapping:
      //   - clip.start = start of the first word at-or-after the picked time
      //     → source resumes cleanly on a spoken word
      //   - clip.end = end of the last word at-or-before the picked time
      //     → cut-out lands after the last spoken word ends
      // Adjacent clips therefore naturally resume "at the start of the NEXT
      // source word" rather than at the previous word's end.
      reactorScript = snapReactorScriptToWords(reactorScript, words);

      // Build plain-text script column (commentary only)
      const allComments = [
        ...reactorScript.segments.map((s) => s.comment),
        reactorScript.cta_segment.comment,
      ].join("\n\n");

      await db
        .update(contentJobs)
        .set({ script: allComments, updated_at: new Date() })
        .where(eq(contentJobs.id, job_id));

      await updateJobMetadata(db, job_id, { reactor_script: reactorScript });

      await updateJobStatus(db, job_id, "REACTOR_TTS_GENERATING");
      await queues.reactorTTS.add("reactor-tts", { job_id });

      console.log(
        JSON.stringify({
          level: "info",
          message: "Reactor script complete",
          job_id,
          intro_clip_count: reactorScript.intro_clips.length,
          segment_count: reactorScript.segments.length,
          has_cta: true,
          outro_clip_count: reactorScript.outro_clips.length,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Reactor script failed",
          job_id,
          error: msg,
        }),
      );
      await updateJobStatus(db, job_id, "FAILED_REACTOR_PIPELINE", msg).catch(
        () => {},
      );
      throw err;
    }
  };
}
