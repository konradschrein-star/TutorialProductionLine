import type { Job, Queue } from "bullmq";
import { eq } from "drizzle-orm";
import type {
  DramaPromptGenPayload,
  DramaImageGenPayload,
} from "@repo/contracts";
import { DramaPromptGenPayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import { contentJobs } from "@repo/db";
import {
  getDramaCharactersByIds,
  insertDramaClips,
  findPresetCharacterByName,
  createDramaCharacter,
  type DramaCharacter,
} from "@repo/db/repositories";
import { callGeminiPool } from "../../utils/gemini-pool-client.js";
import { updateJobStatus } from "../../utils/update-job-status.js";
import { snapToPause, extractSentenceBoundaries } from "./prompt-gen-utils.js";
import type { WordTiming } from "./prompt-gen-utils.js";
import {
  planStockChainFull,
  planLibraryBody,
  commitPlan,
} from "./stock-chain-planner.js";

const HOOK_DURATION_MS = 2 * 60 * 1000;
// User wants 20-25 clips total across the video. With ~10 hook clips
// (one per opening sentence), 15 body clips gives a body cadence of
// roughly one new shot per 75-90 s, so the eye sees fresh content
// throughout the story instead of one image looping for the whole body.
const TARGET_BODY_IMAGES = 15;

export function buildCharacterBlock(
  characters: { name: string; description: string }[],
): string {
  return characters
    .map((c) => `CHARACTER: ${c.name}\n${c.description}`)
    .join("\n\n");
}

function buildGeminiPrompt(
  script: string,
  characterBlock: string,
  hookEndMs: number,
  totalDurationMs: number,
): string {
  const splitIndex = Math.floor(script.length * (hookEndMs / totalDurationMs));
  const hookScript = script.slice(0, splitIndex);
  const bodyScript = script.slice(splitIndex);
  const bodyMinutes = Math.round((totalDurationMs - hookEndMs) / 60000);

  return `You are generating image prompts and camera-motion directions for a realistic reality-TV-style story video. Think Iyanla Vanzant, dramatic recreations of real-life stories — NOT prestige HBO drama. Naturalistic lighting, normal indoor and outdoor settings, real people in real clothes. No film grain. No moody golden glow.

CHARACTERS IN THIS STORY (use the FULL description verbatim for every character that appears in a scene — do not abbreviate or change demographics):
${characterBlock}

TASK:
For the HOOK section (first 2 minutes), identify one image per sentence. Every sentence gets its own distinct image.
For the BODY section (remaining video, ~${bodyMinutes} minutes), identify ${TARGET_BODY_IMAGES} chapter/theme moments — story turning points. One image per chapter.

DEFAULT SCENE COMPOSITION RULES:
- If the moment involves TWO OR MORE named characters interacting, the image MUST stage both of them in frame, interacting (talking, arguing, standing close, sitting across from each other, in bed, hugging, fighting). Two-shot or wider — NOT solo close-up.
- If the moment is genuinely solo (a character working alone, walking alone, sitting in their car alone), then a solo shot is fine.
- If a third character is referenced as observing (a child watching parents fight, a friend hovering nearby), include them in the frame.
- Default lens: medium shot to medium-wide. Use close-ups only for explicit emotional climax beats.

For EACH image, write an image prompt that:
- Opens with WHO is in the frame and WHAT they are doing (e.g. "Andrew and Maya sit across from each other at the kitchen table, not speaking. Andrew has his work boots still on.")
- Describes location, time of day, weather, specific real-world details (worn linoleum, traffic-light glow through the blinds, a half-eaten plate of takeout). Make it feel like a real apartment / real street / real workplace, NOT a movie set.
- Describes ALL present characters using their FULL CHARACTER descriptions verbatim from the CHARACTERS block. Repeat the description on every clip the character appears in.
- Uses naturalistic camera language: handheld, eye-level, available light, mixed sources, slightly overexposed. NOT cinematic / NOT shallow DOF / NOT golden hour unless the scene literally needs it.
- Ends exactly with: "Realistic reality-TV docudrama recreation. Natural skin tones. Normal contemporary clothing. Eye-level lens. No text, no subtitles, no watermarks, no captions, no movie poster framing."
- DO NOT add film grain, prestige drama, HBO, Netflix, cinematic, golden hour, golden ratio, anamorphic, or 4K RAW anywhere.

For EACH image you ALSO return:
- characters_in_scene: array of names of every person visible in the frame (use names from CHARACTERS block verbatim; for incidental named characters mentioned in the script, use their exact name; for unnamed background people, leave them out).
- camera_motion: ONE of: "slow_push_in" (camera slowly moves toward subject), "slow_pull_back" (camera slowly retreats revealing more of the scene), "pan_left", "pan_right", "tilt_up", "tilt_down", "static_with_subject_action" (camera does not move, the subject does — walking, gesturing, turning), "handheld_observational" (subtle handheld sway, documentary feel), "arc_around" (camera arcs slowly around the subject). DO NOT repeat the same motion twice in a row. Vary across the sequence.

HOOK SCRIPT:
${hookScript}

BODY SCRIPT:
${bodyScript}

OUTPUT FORMAT (valid JSON array, no markdown, no extra text):
[
  {
    "section": "hook",
    "sentence_hint": "first few words of the sentence this image covers",
    "image_prompt": "full image generation prompt",
    "characters_in_scene": ["Andrew", "Maya"],
    "camera_motion": "slow_push_in"
  },
  {
    "section": "body",
    "chapter_hint": "brief description of this emotional chapter/theme",
    "image_prompt": "full image generation prompt",
    "characters_in_scene": ["Andrew"],
    "camera_motion": "pan_right"
  }
]`;
}

export function createDramaPromptGenProcessor(
  db: DrizzleClient,
  queues: { dramaImageGen: Queue<DramaImageGenPayload> },
) {
  return async (job: Job<DramaPromptGenPayload>) => {
    const { jobId } = DramaPromptGenPayloadSchema.parse(job.data);

    try {
      const [jobRow] = await db
        .select({ metadata: contentJobs.metadata })
        .from(contentJobs)
        .where(eq(contentJobs.id, jobId))
        .limit(1);
      if (!jobRow) throw new Error(`Job ${jobId} not found`);

      const meta = jobRow.metadata as Record<string, unknown>;
      const wordTimings = meta["drama_word_timings"] as WordTiming[];
      const script = meta["drama_script"] as string;
      const dramaConfig = meta["drama_config"] as {
        characterIds: string[];
        renderMode?: string;
        [k: string]: unknown;
      };
      const renderMode =
        (meta["render_mode"] as string | undefined) ??
        dramaConfig?.renderMode ??
        "KEN_BURNS";
      const clipLibraryId = meta["clip_library_id"] as string | null;

      if (!wordTimings?.length)
        throw new Error("drama_word_timings missing from metadata");
      if (!script) throw new Error("drama_script missing from metadata");

      // ── STOCK_CHAIN_FULL: skip the LLM entirely ─────────────────
      // Every slot pulls from the library. No hook, no Gemini call,
      // no per-scene prompt — image-gen and video-gen are short-
      // circuited downstream because every drama_clip already has
      // video_path + video_status='done'.
      if (renderMode === "STOCK_CHAIN_FULL") {
        if (!clipLibraryId) {
          throw new Error("STOCK_CHAIN_FULL requires metadata.clip_library_id");
        }
        console.log(
          JSON.stringify({
            level: "info",
            message: "STOCK_CHAIN_FULL plan starting",
            job_id: jobId,
            library_id: clipLibraryId,
          }),
        );
        const plan = await planStockChainFull(
          db,
          jobId,
          clipLibraryId,
          wordTimings,
        );
        await commitPlan(db, jobId, plan);
        console.log(
          JSON.stringify({
            level: "info",
            message: "STOCK_CHAIN_FULL clips planted",
            job_id: jobId,
            slot_count: plan.specs.length,
          }),
        );
        await updateJobStatus(db, jobId, "DRAMA_IMAGE_GENERATING");
        // image-gen short-circuits on stock-chain modes and forwards
        // straight to video-gen (which itself short-circuits because
        // every clip is already video_status='done'), so the queue
        // still flows through the same workers without skipping
        // states.
        await queues.dramaImageGen.add(
          "drama-image-gen",
          { jobId },
          { jobId: `drama-image-gen-${jobId}`, attempts: 1 },
        );
        return;
      }

      const castCharacters = await getDramaCharactersByIds(
        dramaConfig.characterIds ?? [],
      );
      // Build a name→character map from the cast so Gemini's character
      // names get resolved without re-querying per clip.
      const charactersByName = new Map<string, DramaCharacter>();
      for (const c of castCharacters) {
        charactersByName.set(c.name.toLowerCase(), c);
      }

      // Casting pass: one Gemini call over the whole script that returns a
      // single source-of-truth character card for every named character.
      // Each card pins demographics (race, age, gender) + look (face, hair,
      // clothing, height, build) + occupation. We then use those cards
      // verbatim in every per-clip prompt so Nano Banana sees the same
      // description for "Andrew" across all 25 image generations and has
      // a chance of producing a recognizable face.
      const presetBlock = castCharacters.length
        ? `Pre-cast characters supplied by the user (USE THESE EXACTLY, do not change demographics):\n${buildCharacterBlock(castCharacters)}`
        : "(No pre-cast characters supplied.)";
      const castingPrompt = `You are casting characters for a reality-TV-style story video. Read the full script below and identify EVERY named or referenced character. For each, output a single rich description card with:
- name (use the exact name from the script; if a person is referenced by role only — "his mother", "his colleague" — invent a sensible first name and reuse it)
- demographics: age, race, gender, build, height
- face: distinctive features (eye colour, eyebrow shape, jawline, facial hair, skin tone, scars/marks)
- hair: length, style, colour, texture
- clothing: their typical outfit given their occupation and the story (be specific — "navy work coveralls with reflective stripes" not "work clothes")
- occupation / role in story
- one-line manner: how they carry themselves

${presetBlock}

SCRIPT:
${script}

OUTPUT FORMAT (valid JSON array, no markdown, no extra text):
[
  {
    "name": "Andrew",
    "description": "Andrew Lawson, 33, Black man, athletic build, 6'1\\", short tight fade, dark brown eyes, square jaw, clean-shaven, deep brown skin. Wears navy sanitation coveralls with reflective stripes and steel-toe boots in early scenes; later transitions to charcoal tailored suits and crisp white shirts. Sanitation worker turned operations director. Speaks softly, holds eye contact, carries himself with quiet exhaustion early on and quiet confidence later."
  }
]`;

      console.log(
        JSON.stringify({
          level: "info",
          message: "Casting pass starting",
          job_id: jobId,
        }),
      );
      let castingResponse = "";
      try {
        castingResponse = await callGeminiPool(castingPrompt);
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "Casting pass failed, falling back to pre-cast only",
            job_id: jobId,
            error: (err instanceof Error ? err.message : String(err)).slice(
              0,
              200,
            ),
          }),
        );
      }

      type CastCard = { name: string; description: string };
      let castCards: CastCard[] = [];
      const castingMatch = castingResponse.match(/\[[\s\S]*\]/);
      if (castingMatch) {
        try {
          const parsed = JSON.parse(castingMatch[0]) as CastCard[];
          castCards = parsed.filter(
            (c) =>
              typeof c?.name === "string" && typeof c?.description === "string",
          );
        } catch {
          // ignore — fall back to preset cast
        }
      }
      console.log(
        JSON.stringify({
          level: "info",
          message: "Casting pass complete",
          job_id: jobId,
          card_count: castCards.length,
          names: castCards.map((c) => c.name),
        }),
      );

      // Merge: pre-cast wins on name collision (operator overrides).
      const cardByName = new Map<string, CastCard>();
      for (const c of castCards) cardByName.set(c.name.toLowerCase(), c);
      for (const pre of castCharacters) {
        cardByName.set(pre.name.toLowerCase(), {
          name: pre.name,
          description: pre.description,
        });
      }

      const characterBlock =
        cardByName.size > 0
          ? Array.from(cardByName.values())
              .map((c) => `CHARACTER: ${c.name}\n${c.description}`)
              .join("\n\n")
          : "(No characters identified.)";
      const totalDurationMs = wordTimings[wordTimings.length - 1]!.end_ms;
      const hookEndMs = Math.min(HOOK_DURATION_MS, totalDurationMs * 0.15);

      const prompt = buildGeminiPrompt(
        script,
        characterBlock,
        hookEndMs,
        totalDurationMs,
      );

      // Retry on transient Gemini pool failures (5xx, "silently aborted",
      // socket errors). Each retry takes ~12 s on average via the 1-slot
      // pool — three retries cap the worst case at ~40 s, well below the
      // prompt-gen watchdog threshold (30 min). Without this, a single
      // 500 from Google's API fails the entire drama job.
      const TRANSIENT_PATTERNS =
        /gemini pool error|silently aborted|5\d\d|econnreset|etimedout|socket hang up|rate.{0,3}limit|overloaded|529/i;
      let rawResponse: string | null = null;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          rawResponse = await callGeminiPool(prompt);
          break;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          if (!TRANSIENT_PATTERNS.test(msg) || attempt === 4) throw err;
          const backoffMs = 2000 * attempt;
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "LLM transient error, retrying",
              job_id: jobId,
              attempt,
              backoff_ms: backoffMs,
              error: msg.slice(0, 200),
            }),
          );
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
      if (rawResponse === null) {
        throw lastErr instanceof Error
          ? lastErr
          : new Error("LLM call failed after retries");
      }

      const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch)
        throw new Error(
          `Gemini did not return a valid JSON array. Raw response (first 500 chars): ${rawResponse.slice(0, 500)}`,
        );
      const items = JSON.parse(jsonMatch[0]) as Array<{
        section: "hook" | "body";
        sentence_hint?: string;
        chapter_hint?: string;
        image_prompt: string;
        characters_in_scene?: string[];
      }>;

      // Hard guard against silent-zero-clip failures. Without this, an
      // empty `[]` from Gemini matches the regex above, parses fine, and
      // the pipeline silently advances to image-gen with nothing to do —
      // video-gen then fails downstream with a cryptic "No image-ready
      // clips" message. This guard turns it into a clear, retryable
      // error at the actual failure point.
      if (items.length === 0) {
        throw new Error(
          `Gemini returned empty clip array. Raw response (first 500 chars): ${rawResponse.slice(0, 500)}`,
        );
      }

      // Resolve every distinct character name surfaced by Gemini across
      // all clips. We DO NOT call Nano Banana / lab clone here — that
      // sequential portrait-gen was adding 9-12 min of wall time on the
      // happy path and was the entire reason prompt-gen was hanging today.
      // Strategy: look up each name in drama_characters by exact name; if
      // missing, INSERT a row using the casting-pass description (text
      // only, no thumbnail_url). That way drama_clips.character_ids stays
      // valid uuid-backed without any image-gen API hops.
      const allNames = new Set<string>();
      for (const item of items) {
        for (const n of item.characters_in_scene ?? []) {
          const trimmed = n.trim();
          if (trimmed) allNames.add(trimmed);
        }
      }

      for (const name of allNames) {
        if (charactersByName.has(name.toLowerCase())) continue;
        try {
          let character = await findPresetCharacterByName(name);
          if (!character) {
            const card = cardByName.get(name.toLowerCase());
            const desc =
              card?.description ??
              `${name} — character mentioned in the script. No further details available.`;
            character = await createDramaCharacter({ name, description: desc });
          }
          charactersByName.set(name.toLowerCase(), character);
        } catch (err) {
          console.warn(
            JSON.stringify({
              level: "warn",
              message:
                "Could not look up or create character row, skipping ID tag",
              name,
              job_id: jobId,
              error: String(err).slice(0, 200),
            }),
          );
        }
      }

      const sentenceBoundaries = extractSentenceBoundaries(wordTimings);
      const hookBoundaries = sentenceBoundaries.filter(
        (ms) => ms <= hookEndMs + 5000,
      );

      const hookItems = items.filter((i) => i.section === "hook");
      const bodyItems = items.filter((i) => i.section === "body");

      // Second-line guard: if items existed but none were classified as
      // hook OR body (LLM returned items with junk/missing `section`),
      // we'd still produce 0 clips. Fail loud instead.
      if (hookItems.length === 0 && bodyItems.length === 0) {
        throw new Error(
          `Gemini returned ${items.length} items but none had section="hook" or "body". Sample item: ${JSON.stringify(items[0]).slice(0, 300)}`,
        );
      }

      const resolveCharacterIds = (names: string[] | undefined): string[] => {
        if (!names?.length) return [];
        const ids: string[] = [];
        for (const n of names) {
          const c = charactersByName.get(n.trim().toLowerCase());
          if (c) ids.push(c.id);
        }
        return ids;
      };

      const clips: Parameters<typeof insertDramaClips>[1] = [];
      let clipIndex = 0;

      // drama_clips.start_ms and end_ms are PostgreSQL INTEGER columns.
      // hookEndMs and targetBodyIntervalMs are floats (15% division +
      // bodyDuration / clipCount), so every derived timestamp needs an
      // explicit round before insert or PG rejects with
      // 'invalid input syntax for type integer'.
      const intHookEnd = Math.round(hookEndMs);
      const intTotal = Math.round(totalDurationMs);

      for (let i = 0; i < hookItems.length; i++) {
        const item = hookItems[i]!;
        const startMs = Math.round(
          i === 0 ? 0 : (clips[clipIndex - 1]?.endMs ?? 0),
        );
        const targetEndMs = hookBoundaries[i] ?? intHookEnd;
        const endMs = Math.round(snapToPause(targetEndMs, wordTimings));

        clips.push({
          clipIndex: clipIndex++,
          sectionType: "hook",
          text: item.sentence_hint ?? "",
          startMs,
          endMs,
          imagePrompt: item.image_prompt,
          characterIds: resolveCharacterIds(item.characters_in_scene),
        });
      }

      const bodyDurationMs = totalDurationMs - hookEndMs;
      const targetBodyIntervalMs = bodyDurationMs / (bodyItems.length || 1);

      for (let i = 0; i < bodyItems.length; i++) {
        const item = bodyItems[i]!;
        // Body's first clip should start where the last hook clip
        // ENDED, not at intHookEnd — snapToPause can snap the last
        // hook clip well before intHookEnd, otherwise leaving a
        // phantom gap with no video coverage.
        const startMs = Math.round(clips[clipIndex - 1]?.endMs ?? intHookEnd);
        const targetEndMs =
          i === bodyItems.length - 1
            ? intTotal
            : hookEndMs + (i + 1) * targetBodyIntervalMs;
        const endMs = Math.round(
          i === bodyItems.length - 1
            ? intTotal
            : snapToPause(targetEndMs, wordTimings),
        );

        clips.push({
          clipIndex: clipIndex++,
          sectionType: "body",
          text: item.chapter_hint ?? "",
          startMs,
          endMs,
          imagePrompt: item.image_prompt,
          characterIds: resolveCharacterIds(item.characters_in_scene),
        });
      }

      // VEO t2v native output is ~8 s. Anything longer than ~8 s would
      // have to be looped at render time, which produces a hard cut
      // every 8 s back to frame 1 (very visible). Subdivide any clip
      // longer than MAX_CLIP_MS into equal sub-clips sharing the same
      // prompt + characters — each sub-clip is a fresh VEO take and
      // the assembler xfades them, giving the illusion of one long
      // continuous shot without loop boundaries.
      const MAX_CLIP_MS = 8000;
      const subdivided: typeof clips = [];
      let nextIndex = 0;
      for (const c of clips) {
        const dur = c.endMs - c.startMs;
        if (dur <= MAX_CLIP_MS) {
          subdivided.push({ ...c, clipIndex: nextIndex++ });
          continue;
        }
        const n = Math.ceil(dur / MAX_CLIP_MS);
        const piece = dur / n;
        for (let k = 0; k < n; k++) {
          const s = Math.round(c.startMs + k * piece);
          const e = Math.round(
            k === n - 1 ? c.endMs : c.startMs + (k + 1) * piece,
          );
          subdivided.push({
            ...c,
            clipIndex: nextIndex++,
            startMs: s,
            endMs: e,
          });
        }
      }
      const finalClips = subdivided;

      console.log(
        JSON.stringify({
          level: "info",
          message: "Drama clip plan subdivided",
          job_id: jobId,
          before: clips.length,
          after: finalClips.length,
          max_clip_ms: MAX_CLIP_MS,
        }),
      );

      // ── STOCK_CHAIN_HOOKED: keep only the hook clips from the
      //    LLM plan; library picks fill the body section.
      let clipsToInsert = finalClips;
      let libraryPlan: Awaited<ReturnType<typeof planLibraryBody>> | null =
        null;
      if (renderMode === "STOCK_CHAIN_HOOKED") {
        if (!clipLibraryId) {
          throw new Error(
            "STOCK_CHAIN_HOOKED requires metadata.clip_library_id",
          );
        }
        // Drop body items from the LLM plan; keep hook clips intact.
        const hookOnly = finalClips.filter((c) => c.sectionType === "hook");
        // Body window starts where the last hook clip ends, runs to TTS end.
        const lastHookEnd =
          hookOnly.length > 0
            ? hookOnly[hookOnly.length - 1]!.endMs
            : Math.round(hookEndMs);
        libraryPlan = await planLibraryBody(db, {
          jobId,
          clipLibraryId,
          wordTimings,
          startMs: lastHookEnd,
          endMs: Math.round(totalDurationMs),
          startIndex: hookOnly.length,
        });
        clipsToInsert = [...hookOnly, ...libraryPlan.specs];
        console.log(
          JSON.stringify({
            level: "info",
            message: "STOCK_CHAIN_HOOKED plan",
            job_id: jobId,
            hook_clips: hookOnly.length,
            body_library_clips: libraryPlan.specs.length,
            library_id: clipLibraryId,
          }),
        );
      }

      await insertDramaClips(jobId, clipsToInsert);
      // For HOOKED: patch the library-picked body rows with
      // video_path + done status so video-gen only generates the
      // hook clips.
      if (renderMode === "STOCK_CHAIN_HOOKED" && libraryPlan) {
        // commitLibraryPicks expects insertDramaClips to have already
        // run; call it now using the picks list.
        await import("./stock-chain-planner.js").then(
          ({ commitLibraryPicks }) =>
            commitLibraryPicks(db, jobId, libraryPlan!.picks),
        );
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Drama clips inserted with character assignments",
          job_id: jobId,
          clips: clipsToInsert.length,
          distinct_characters: charactersByName.size,
          autonomously_generated: charactersByName.size - castCharacters.length,
        }),
      );

      await updateJobStatus(db, jobId, "DRAMA_IMAGE_GENERATING");
      await queues.dramaImageGen.add(
        "drama-image-gen",
        { jobId },
        // attempts:1 — we DON'T want BullMQ to auto-retry a failed
        // image-gen pass. The processor already does 3-deep client
        // retries (submitAndPoll) per clip with exponential backoff, and
        // it has a circuit breaker for repeated UNUSUAL_ACTIVITY. A
        // BullMQ retry on top would re-run every clip again and double
        // the spam against the lab clone.
        { jobId: `drama-image-gen-${jobId}`, attempts: 1 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateJobStatus(db, jobId, "FAILED_DRAMA_PIPELINE", msg).catch(
        () => {},
      );
      throw err;
    }
  };
}
