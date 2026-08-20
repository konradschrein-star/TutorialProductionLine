import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DrizzleClient } from "@repo/db";
import {
  resolveArchetypeCandidates,
  getThumbnailArchetypeById,
  getChannelThumbnailProfile,
  createThumbnailRecord,
  updateThumbnailRecord,
  getThumbnailById,
  getThumbnailFormatRule,
} from "@repo/db/repositories";
import type { TutorialDifficulty } from "@repo/db/repositories";
import type { GatewayFormat, MediaAspect } from "../media-gateway/types.js";
import {
  requestImageDetailed,
  resolveImageChain,
  downloadMediaBuffer,
  maxImageReferences,
  maxPromptChars,
} from "../media-gateway/index.js";
import {
  assertYouTubeThumbnail,
  assertExactYouTubeThumbnail,
} from "./image-contract.js";
import { normaliseYouTubeThumbnailBuffer } from "@repo/media-core/images";
import { resolveCharacterReference } from "./character.js";
import type { ResolvedCharacterReference } from "./character.js";
import { pickCycledArchetype } from "./archetype-cycle.js";
import {
  brandingContractFor,
  checkBrandingContract,
} from "./branding-contract.js";
import { requestLLMText } from "../llm-client.js";
import { buildIteratePrompt, buildLocalizePrompt } from "./prompt-builder.js";
import {
  compileThumbnailBrief,
  renderProgrammatic,
  promptOmissions,
  deriveHeadline,
  DEFAULT_PROMPT_BUDGET_CHARS,
  type FormatRuleLike,
  type ThumbnailBrief,
} from "./brief.js";
import { authorThumbnailPrompt } from "./deepseek-prompt.js";

const THUMBNAIL_MEDIA_DIR =
  process.env["THUMBNAIL_MEDIA_DIR"] ?? "/opt/content-forge/media/thumbnails";

/** Operator defaults, per the Thumbnail Studio spec: 16:9 at 1K. */
const DEFAULT_ASPECT: MediaAspect = "16:9";
const DEFAULT_RESOLUTION = "1k";

/**
 * Optional backend pin, e.g. THUMBNAIL_BACKEND=ai33.
 *
 * Previously this was HARDCODED to "ai33" (index.ts pre-v3) — the pin silently
 * outlived the VUP/forge outage and exhausted the AI33 keys (7 of the 57
 * failures). It is now env-driven; unset = let the gateway route normally.
 */
const PINNABLE_BACKENDS = [
  "veo_fleet",
  "veoforge",
  "vup",
  "forge",
  "fastgen",
  "ai33",
] as const;

function configuredBackend(): RequestThumbnailArgs["backend"] {
  const raw = process.env["THUMBNAIL_BACKEND"]?.trim().toLowerCase();
  const match = PINNABLE_BACKENDS.find((b) => b === raw);
  return match;
}

/** Iterate vs Regenerate vs Variant — kept STRICTLY apart (DECISIONS §3.2.5). */
export type ThumbnailGenerationKind =
  | "original"
  | "variant"
  | "iterate"
  | "regenerate"
  | "localize";

export interface RequestThumbnailArgs {
  subjectKind: "content_job" | "tutorial_job" | "studio" | "test";
  subjectId: string;
  format: GatewayFormat;
  /** NULL/undefined for ad-hoc Studio renders not tied to a channel. */
  channelId?: string | null;
  title: string;
  topic?: string;
  headlineText?: string;
  scriptExcerpt?: string;
  archetypeId?: string;
  promptMode?: "programmatic" | "deepseek" | "authored" | "manual";
  editedPrompt?: string;
  referenceOverride?: string;
  /** Extra i2i references on top of the archetype's own. */
  extraReferences?: string[];
  instructions?: string;
  logoSubject?: string;
  aspectRatio?: MediaAspect;
  resolution?: string;
  backend?: (typeof PINNABLE_BACKENDS)[number];
  parentThumbnailId?: string;
  language?: string;
  targetLanguage?: string;
  localizeFromThumbnailId?: string;
  /**
   * How this row was produced. Determines which reference image is used:
   *   original/variant — the archetype reference
   *   iterate          — the PARENT thumbnail's output
   *   regenerate       — the parent's ORIGINAL archetype reference
   * Defaults are inferred from the other args for backward compatibility.
   */
  generationKind?: ThumbnailGenerationKind;
  requestGroupId?: string;
  variantIndex?: number;
  /**
   * Difficulty of the tutorial this thumbnail is for, which widens the
   * archetype cycle to the channel's 'advanced' or 'beginner' tier.
   *
   * NO CALLER SUPPLIES THIS TODAY and none should invent it: the pipeline
   * stores no per-job difficulty (`tutorial_jobs` has no difficulty/complexity
   * column; `mode` is a script length shape; the Keyword Tool's `length_class`
   * is discarded at submit). The tiers are configured in the database and the
   * resolver reads them; they simply stay unselected until a real signal is
   * persisted on the job, at which point this is the one line to fill in.
   */
  difficulty?: TutorialDifficulty | null;
  /** Fallback policy for THIS request (§2.6). Default 'warn'. */
  onFallback?: "allow" | "warn" | "fail";
}

export interface RequestThumbnailResult {
  thumbnailId: string;
  outputPath: string | null;
  status: "completed" | "failed" | "skipped";
  error?: string;
  /** Set when the backend that served the request differs from position 0 of
   *  the routing chain. A downgrade is NEVER silent. */
  downgradedFrom?: string;
  fallbackUsed?: boolean;
  providerUsed?: string;
}

/** LLM headline author — injected into deriveHeadline; null-safe. */
async function llmHeadline(prompt: string): Promise<string> {
  return requestLLMText(prompt, {
    provider: "deepseek",
    context: "thumbnail:headline",
  });
}

export async function requestThumbnail(
  db: DrizzleClient,
  args: RequestThumbnailArgs,
): Promise<RequestThumbnailResult> {
  // Non-blocking by contract: this function must NEVER throw. Any failure is
  // caught below and recorded on the thumbnail row so the caller's job is not
  // failed/retried; the uploader can regenerate later.
  let record: { id: string } | undefined;
  const channelId = args.channelId ?? null;
  const onFallback = args.onFallback ?? "warn";
  try {
    const profile = channelId
      ? await getChannelThumbnailProfile(db, channelId)
      : undefined;

    // Infer the generation kind when the caller didn't state it (back-compat).
    const kind: ThumbnailGenerationKind =
      args.generationKind ??
      (args.targetLanguage && args.localizeFromThumbnailId
        ? "localize"
        : args.parentThumbnailId && args.instructions
          ? "iterate"
          : "original");

    /**
     * The channel's on-camera host — resolved from the CHARACTER LIBRARY, which
     * is the SINGLE source of truth for "who is the human on this channel".
     *
     * There is no second source any more. `channel_personas` used to be a table
     * holding one `image_path` per channel; migration 0061 turned it into a
     * read-only VIEW projected out of `characters` + `character_channels` +
     * `character_images` (verified on production: `relkind = 'v'`). The engine
     * used to read that view as a "fallback" for the host image and
     * description. That fallback was provably dead — the view's `image_path` is
     * literally the first row of the same `character_images` set that
     * `resolveChannelHost` reads, and `resolveChannelHost` already refuses a
     * host with zero images — so it could only ever return either the same
     * image or nothing. Reading it anyway made the code look like it had two
     * competing sources of truth when the database had one, which is how the
     * next person ends up "fixing" the wrong one. It is now gone.
     *
     * Resolved only for original/variant/regenerate: an `iterate` refines an
     * image that already contains the host, and a `localize` only swaps text,
     * so re-attaching a (possibly different) host image there would fight the
     * base image.
     */
    const character: ResolvedCharacterReference | undefined =
      channelId && kind !== "iterate" && kind !== "localize"
        ? await resolveCharacterReference(db, channelId, {
            subjectId: args.subjectId,
            variantIndex: args.variantIndex ?? 0,
            parentThumbnailId: args.parentThumbnailId ?? null,
          })
        : undefined;

    let promptMode: RequestThumbnailArgs["promptMode"] =
      args.promptMode ?? profile?.default_prompt_mode ?? "programmatic";

    let prompt: string;
    let reference: string | undefined;
    let archetypeId: string | null = null;
    let recordLanguage = args.language ?? "en";
    let referencePaths: {
      archetype?: string;
      persona?: string;
      logo?: string;
      base?: string;
    } = {};
    let extraReferences: string[] = [];
    /**
     * The channel host's face, attached as a SECOND i2i reference. This is the
     * image the deterministic cycle picked for THIS generation, so consecutive
     * videos on one channel show the same person in different poses.
     *
     * Set only on original/variant/regenerate: an `iterate` applies deltas to an
     * image that already contains the host, and a `localize` only swaps the
     * text, so re-attaching the host there would fight the base image.
     */
    let personaImage: string | undefined;
    let aspectRatio: MediaAspect = args.aspectRatio ?? DEFAULT_ASPECT;
    let resolution: string = args.resolution ?? DEFAULT_RESOLUTION;
    let brief: ThumbnailBrief | null = null;
    let headlineText: string | null = args.headlineText ?? null;
    let headlineSource: "operator" | "derived" | "title_fallback" | "none" =
      args.headlineText ? "operator" : "none";

    if (kind === "localize") {
      // ── Localization: i2i from an existing base thumbnail ─────────────────
      const base = args.localizeFromThumbnailId
        ? await getThumbnailById(db, args.localizeFromThumbnailId)
        : undefined;
      if (!base?.output_path) {
        return {
          thumbnailId: "",
          outputPath: null,
          status: "skipped",
          error: "base thumbnail missing",
        };
      }
      reference = base.output_path;
      prompt = buildLocalizePrompt(args.targetLanguage ?? "en");
      promptMode = "programmatic";
      recordLanguage = args.targetLanguage ?? "en";
      referencePaths = { base: base.output_path };
      aspectRatio =
        args.aspectRatio ??
        (base.aspect_ratio as MediaAspect) ??
        DEFAULT_ASPECT;
      resolution = args.resolution ?? base.resolution ?? DEFAULT_RESOLUTION;
    } else if (kind === "iterate") {
      // ── Iterate: the ALREADY-GENERATED thumbnail is the reference ─────────
      // (DECISIONS §3.2.5). Apply ONLY the requested deltas.
      const parent = args.parentThumbnailId
        ? await getThumbnailById(db, args.parentThumbnailId)
        : undefined;
      if (!parent?.output_path) {
        return {
          thumbnailId: "",
          outputPath: null,
          status: "skipped",
          error: "iterate: parent thumbnail has no output to iterate on",
        };
      }
      if (!args.instructions?.trim()) {
        return {
          thumbnailId: "",
          outputPath: null,
          status: "skipped",
          error: "iterate: instructions are required",
        };
      }
      reference = parent.output_path;
      referencePaths = { base: parent.output_path };
      prompt = buildIteratePrompt(args.instructions);
      archetypeId = parent.archetype_id ?? null;
      aspectRatio =
        args.aspectRatio ??
        (parent.aspect_ratio as MediaAspect) ??
        DEFAULT_ASPECT;
      resolution = args.resolution ?? parent.resolution ?? DEFAULT_RESOLUTION;
    } else {
      // ── original / variant / regenerate ───────────────────────────────────
      // Regenerate re-uses the parent's ORIGINAL archetype reference (NOT its
      // output) and recompiles the brief with any new instructions.
      let regenParent: Awaited<ReturnType<typeof getThumbnailById>> | undefined;
      if (kind === "regenerate") {
        regenParent = args.parentThumbnailId
          ? await getThumbnailById(db, args.parentThumbnailId)
          : undefined;
        if (!regenParent) {
          return {
            thumbnailId: "",
            outputPath: null,
            status: "skipped",
            error: "regenerate: parent thumbnail not found",
          };
        }
      }

      const referenceOverride = args.referenceOverride?.trim() || undefined;
      // Regenerate: force the reference to the parent's original archetype ref.
      const regenRef =
        kind === "regenerate"
          ? regenParent?.reference_paths?.archetype
          : undefined;

      let archetype = args.archetypeId
        ? await getThumbnailArchetypeById(db, args.archetypeId)
        : kind === "regenerate" && regenParent?.archetype_id
          ? await getThumbnailArchetypeById(db, regenParent.archetype_id)
          : undefined;
      if (args.archetypeId && !archetype) {
        return recordRefusal(db, args, {
          kind,
          channelId,
          archetypeId: null,
          aspectRatio,
          resolution,
          reason: `Requested archetype ${args.archetypeId} not found`,
        });
      }
      if (!archetype && !referenceOverride && !regenRef) {
        const pool = await resolveArchetypeCandidates(
          db,
          channelId,
          args.format,
          // Always null today — the pipeline stores no per-job difficulty. See
          // TutorialDifficulty in the thumbnail repository; the reason is
          // reported back on `difficultyNote` and logged below, never swallowed.
          args.difficulty ?? null,
        );
        // Deterministic per job: the same subject + variant always lands on the
        // same archetype, so a retry or a replay cannot contradict the template
        // recorded on the row. See ./archetype-cycle.ts for why this replaced
        // the least-recently-used picker.
        archetype = pickCycledArchetype(pool.candidates, {
          subjectId: args.subjectId,
          variantIndex: args.variantIndex ?? 0,
          parentThumbnailId: args.parentThumbnailId ?? null,
        });
        if (!archetype) {
          // A curated channel says WHY its own set came up empty. Anything
          // else is the library-is-unseeded case. Neither may substitute an
          // archetype the channel did not choose.
          return recordRefusal(db, args, {
            kind,
            channelId,
            archetypeId: null,
            aspectRatio,
            resolution,
            reason: pool.emptyCurationReason
              ? `No archetype available for channel ${channelId} / format ` +
                `${args.format}: ${pool.emptyCurationReason}`
              : `No archetype available (pool=${pool.source}, tiers=` +
                `${pool.tiers.join("+")}) for channel ${channelId ?? "none"} / ` +
                `format ${args.format}. Seed the global archetype library or ` +
                `curate archetypes for this channel.`,
          });
        }
        // A difficulty tier that was configured but could not be selected is
        // stated out loud. Silently collapsing to the base cycle is how a
        // configuration nobody can see ends up being blamed on the generator.
        if (pool.difficultyNote) {
          console.info(
            JSON.stringify({
              level: "info",
              message: "Thumbnail archetype cycled on the base tier only",
              subject_id: args.subjectId,
              channel_id: channelId,
              reason: pool.difficultyNote,
              pool_size: pool.candidates.length,
              archetype: archetype.name,
            }),
          );
        }
      }
      archetypeId = archetype?.id ?? regenParent?.archetype_id ?? null;

      /**
       * ── The branding contract ─────────────────────────────────────────────
       * Enforced HERE, at the one point where everything the contract talks
       * about has been resolved: the channel, the template, and the host.
       *
       * A `referenceOverride` / `regenRef` satisfies the template requirement
       * without an archetype row — the operator handed us an explicit reference
       * image, which is a template by any honest reading — so the check accepts
       * either. What it will not accept is a branded format shipping a
       * thumbnail with no template and no face; that is the exact output the
       * owner flagged.
       */
      const contractError = checkBrandingContract(
        brandingContractFor(args.format, args.subjectKind),
        {
          channelId,
          hostCharacterName: character?.characterName ?? null,
          archetypeId:
            archetypeId ??
            ((referenceOverride ?? regenRef) ? "override" : null),
        },
        { format: args.format, subjectId: args.subjectId },
      );
      if (contractError) {
        return recordRefusal(db, args, {
          kind,
          channelId,
          archetypeId,
          aspectRatio,
          resolution,
          reason: contractError,
        });
      }

      // ── Headline: COMPLEMENT the title, never paste it verbatim (§3.2.4) ──
      const rawRule = await getThumbnailFormatRule(db, args.format).catch(
        () => undefined,
      );
      const rule =
        rawRule ??
        (await getThumbnailFormatRule(db, "OTHER").catch(() => undefined));
      const maxWords = rule?.text_max_words ?? 5;
      const derived = await deriveHeadline({
        title: args.title,
        operatorHeadline: args.headlineText ?? null,
        maxWords,
        textPolicy: rule?.text_policy ?? null,
        format: args.format,
        // The logo shares the frame with the headline, so the headline must not
        // spell the name the logo already carries.
        logoSubject: args.logoSubject ?? null,
        llm: llmHeadline,
      });
      headlineText = derived.headline;
      headlineSource = derived.source;

      /**
       * The host reference image (input 3 of the three inputs: prompt,
       * archetype reference, host reference). One source, no fallback — see the
       * note on `character` above.
       */
      personaImage = character?.imagePath;

      if (character) {
        console.log(
          JSON.stringify({
            level: "info",
            message: "Thumbnail host character resolved",
            subject_id: args.subjectId,
            channel_id: channelId,
            character: character.characterName,
            character_id: character.characterId,
            image_id: character.imageId,
            image_path: character.imagePath,
            pose: character.pose,
            expression: character.expression,
            cycle: `${character.cycleIndex + 1}/${character.cycleSize}`,
            variant_index: args.variantIndex ?? 0,
          }),
        );
      }

      // ── Compile the brief (Layers 0-3) ────────────────────────────────────
      brief = compileThumbnailBrief({
        format: args.format,
        channelId,
        title: args.title,
        headline: headlineText,
        headlineSource,
        topic: args.topic ?? null,
        scriptExcerpt: args.scriptExcerpt ?? null,
        rule: (rule as FormatRuleLike | undefined) ?? null,
        brand: {
          personaDescription: character?.description ?? null,
          personaImageAttached: Boolean(personaImage),
          extraNotes: profile?.extra_prompt_notes ?? null,
          primaryColor: profile?.primary_color ?? null,
          secondaryColor: profile?.secondary_color ?? null,
          logoSubject: args.logoSubject ?? null,
          featuresLogo: archetype?.features_logo ?? false,
        },
        archetypeLayoutInstructions: archetype?.layout_instructions ?? null,
        archetypeBasePrompt: archetype?.base_prompt ?? null,
      });

      // Regenerate may add new instructions to the recompiled brief.
      const regenNote =
        kind === "regenerate" && args.instructions?.trim()
          ? `\nRegeneration request: ${args.instructions.trim()}`
          : "";

      // ── Render the prompt from the brief ──────────────────────────────────
      // Every backend that can serve a REFERENCED image request (veo_fleet,
      // veoforge, vup) rejects prompts over 2000 characters — it does not
      // truncate them, it refuses the job. A thumbnail always carries at least
      // the archetype reference, so 2000 is the operative ceiling and the
      // renderer budgets the brief down to fit rather than overflowing it.
      const promptBudget = DEFAULT_PROMPT_BUDGET_CHARS;
      if (promptMode === "manual" && args.editedPrompt?.trim()) {
        prompt = args.editedPrompt.trim();
      } else if (args.editedPrompt?.trim()) {
        prompt = args.editedPrompt.trim();
      } else if (promptMode === "authored" || promptMode === "deepseek") {
        prompt = (
          await authorThumbnailPrompt({
            format: args.format,
            title: args.title,
            topic: args.topic ?? args.title,
            scriptExcerpt: args.scriptExcerpt ?? "",
            personaDescription: character?.description ?? null,
            extraNotes:
              (profile?.extra_prompt_notes ?? "") +
              // branding + archetypeGuidance are their own brief fields now
              // (they used to live inside composition[]). Leaving them out here
              // would silently strip the product branding and the template
              // description from the AUTHORED path only — the exact kind of
              // path-specific hole that produced unbranded thumbnails.
              [
                brief.branding ?? "",
                ...brief.archetypeGuidance,
                ...brief.composition,
              ].join(" ") +
              regenNote,
            personaImageAttached: Boolean(personaImage),
            maxChars: promptBudget,
          }).catch(() => renderProgrammatic(brief!, { maxChars: promptBudget }))
        ).trim();
      } else {
        // NOTE (fixes A2.2): on a first generation, `instructions` no longer
        // hijacks the whole prompt. The brief owns the prompt; regenerate
        // instructions are folded in as a note. The note is reserved OUT of the
        // budget rather than sliced off the end — a regeneration whose
        // instruction is cut is the bug this whole path exists to fix.
        prompt =
          renderProgrammatic(brief, {
            maxChars: promptBudget - regenNote.length,
          }) + regenNote;
      }

      /**
       * What the 2000-char ceiling cut. Not an error — the archetype's template
       * is carried by the reference IMAGE, and a squeeze here is the normal
       * case. It is logged because the alternative is what happened before:
       * directives silently vanishing and the output being blamed on the model.
       */
      if (brief) {
        const omitted = promptOmissions(brief, prompt);
        if (omitted.archetypeSentencesDropped || omitted.negativesDropped) {
          console.info(
            JSON.stringify({
              level: "info",
              message: "Thumbnail prompt budget squeezed",
              subject_id: args.subjectId,
              prompt_chars: prompt.length,
              budget: promptBudget,
              archetype_sentences_dropped: omitted.archetypeSentencesDropped,
              archetype_sentences_total: brief.archetypeGuidance.length,
              negatives_dropped: omitted.negativesDropped,
              negatives_total: brief.negatives.length,
            }),
          );
        }
      }

      reference =
        referenceOverride ?? regenRef ?? archetype?.reference_image_path;
      // reference_paths records what was ACTUALLY sent to the model, nothing
      // else — the whole bug being fixed here is a path that was recorded and
      // never attached. `logo` stays unset until the logo is genuinely sent.
      referencePaths = {
        ...(reference ? { archetype: reference } : {}),
        ...(personaImage ? { persona: personaImage } : {}),
      };
      extraReferences = [
        ...(archetype?.extra_reference_paths ?? []),
        ...(args.extraReferences ?? []),
      ].filter((p) => p.trim().length > 0);
      aspectRatio =
        args.aspectRatio ??
        (archetype?.aspect_ratio as MediaAspect | undefined) ??
        DEFAULT_ASPECT;
      resolution =
        args.resolution ?? archetype?.resolution ?? DEFAULT_RESOLUTION;
    }

    const requestedBackend = args.backend ?? configuredBackend();

    /**
     * The ordered i2i reference stack actually sent to the model:
     *   [0] the archetype / base / parent-output reference (the layout)
     *   [1] the channel persona — the host's face
     *   [2..] archetype extras and caller-supplied extras
     * Order is load-bearing: the prompt refers to "the first reference image"
     * and "the second reference image".
     */
    const orderedReferences: string[] = [
      ...(reference ? [reference] : []),
      ...(personaImage ? [personaImage] : []),
      ...extraReferences,
    ];

    // ── Capability pre-flight (fixes A2.11) ─────────────────────────────────
    // Compute the EFFECTIVE reference count and refuse a request no configured
    // backend can serve BEFORE spending anything, rather than enqueuing a
    // doomed multi-reference request.
    const effectiveRefCount = orderedReferences.length;
    const { configured } = resolveImageChain({
      format: args.format,
      refCount: effectiveRefCount,
      aspectRatio,
      ...(requestedBackend ? { backend: requestedBackend } : {}),
    });
    if (configured.length === 0) {
      return recordRefusal(db, args, {
        kind,
        channelId,
        archetypeId,
        aspectRatio,
        resolution,
        referencePaths,
        reason:
          `No configured backend can serve this request ` +
          `(${effectiveRefCount} reference image(s), ${aspectRatio}` +
          `${requestedBackend ? `, pinned ${requestedBackend}` : ""}). ` +
          `Enable a provider in System Health or reduce the reference count.`,
      });
    }

    /**
     * Reference-capacity gate. `resolveImageChain` filters on capability for a
     * ROUTED request, but an explicit backend pin short-circuits that filter
     * (candidateOrder returns the pin verbatim) — so a pin like
     * THUMBNAIL_BACKEND=vup plus a persona reference would "succeed" with the
     * host's face dropped on the floor. Nothing downstream can detect that:
     * the image comes back, the row says completed, and the wrong person is on
     * the thumbnail. Refuse instead, naming what would have been dropped.
     */
    const refCapable = configured.filter(
      (b) => maxImageReferences(b) >= effectiveRefCount,
    );
    if (effectiveRefCount > 0 && refCapable.length === 0) {
      const caps = configured
        .map((b) => `${b}: carries ${maxImageReferences(b)}`)
        .join("; ");
      return recordRefusal(db, args, {
        kind,
        channelId,
        archetypeId,
        aspectRatio,
        resolution,
        referencePaths,
        reason:
          `No configured backend can carry ${effectiveRefCount} reference ` +
          `image(s)${requestedBackend ? ` (pinned ${requestedBackend})` : ""} — ` +
          `${caps}. Refusing to generate with references silently dropped` +
          `${personaImage ? " (the channel persona would be discarded)" : ""}. ` +
          `veo_fleet is the only backend that carries 0..N references; enable ` +
          `it in System Health or clear the backend pin.`,
      });
    }

    /**
     * Prompt-length gate. The programmatic renderer budgets itself, but a
     * hand-edited or LLM-authored prompt can still overshoot, and every
     * reference-capable backend REFUSES an over-long prompt rather than
     * truncating it. Catching it here names the real problem; letting it
     * through produces "prompt exceeds 2000 char limit" on the transport,
     * which is what two of the most recent production thumbnails died of.
     */
    const promptCeiling = Math.min(
      ...(refCapable.length ? refCapable : configured).map((b) =>
        maxPromptChars(b),
      ),
    );
    if (prompt.length > promptCeiling) {
      return recordRefusal(db, args, {
        kind,
        channelId,
        archetypeId,
        aspectRatio,
        resolution,
        referencePaths,
        prompt,
        reason:
          `Prompt is ${prompt.length} characters but every backend that can ` +
          `serve this request rejects prompts over ${promptCeiling} ` +
          `(${(refCapable.length ? refCapable : configured).join(", ")}). ` +
          `Shorten the edited prompt — the backend refuses it outright rather ` +
          `than truncating, so this would fail at the transport.`,
      });
    }

    // ── Record (generating) ─────────────────────────────────────────────────
    record = await createThumbnailRecord(db, {
      subject_kind: args.subjectKind,
      subject_id: args.subjectId,
      channel_id: channelId,
      archetype_id: archetypeId,
      language: recordLanguage,
      prompt_mode:
        promptMode === "deepseek" ? "authored" : (promptMode ?? "programmatic"),
      prompt_used: prompt,
      reference_paths: referencePaths,
      extra_reference_paths: extraReferences,
      aspect_ratio: aspectRatio,
      resolution,
      title: args.title.slice(0, 300),
      headline_text: headlineText ? headlineText.slice(0, 300) : null,
      headline_source: headlineSource,
      topic: args.topic ?? null,
      parent_thumbnail_id: args.parentThumbnailId ?? null,
      generation_kind: kind,
      ...(args.requestGroupId ? { request_group_id: args.requestGroupId } : {}),
      variant_index: args.variantIndex ?? 0,
      ...(brief ? { brief: brief as unknown as Record<string, unknown> } : {}),
      rules_version: brief?.rulesVersion ?? null,
      requested_backend: requestedBackend ?? null,
      status: "generating",
      is_selected: false,
    });

    // ── Generate ──────────────────────────────────────────────────────────
    const outputDir = join(THUMBNAIL_MEDIA_DIR, args.subjectId);
    await mkdir(outputDir, { recursive: true });

    // Gateway refs must be data:/http(s); a LOCAL path is inlined as data:.
    //
    // The PRIMARY reference and the PERSONA reference are both load-bearing:
    // the prompt explicitly instructs the model to match the first image's
    // layout and to put the second image's person in it. If either cannot be
    // read, the prompt is a lie and the output is wrong — so fail loudly
    // instead of generating something that looks fine and has the wrong host.
    // Only the trailing extras are best-effort.
    const referenceRefs: string[] = [];
    if (reference) {
      const primary = await toGatewayRef(reference);
      if (!primary) {
        throw new Error(
          `Reference image unreadable: ${reference}. Refusing to generate an ` +
            `unreferenced thumbnail from a reference-matching prompt.`,
        );
      }
      referenceRefs.push(primary);
    }
    if (personaImage) {
      const personaRef = await toGatewayRef(personaImage);
      if (!personaRef) {
        throw new Error(
          `Channel host image unreadable: ${personaImage}` +
            (character
              ? ` (character "${character.characterName}", image ` +
                `${character.cycleIndex + 1}/${character.cycleSize}, ` +
                `id ${character.imageId})`
              : "") +
            `. The prompt asks the model to use the host reference, so ` +
            `generating without it would ship a thumbnail with the wrong ` +
            `person. Fix or deactivate that image in the Character Library ` +
            `(/characters).`,
        );
      }
      referenceRefs.push(personaRef);
    }
    for (const extra of extraReferences) {
      const encoded = await toGatewayRef(extra);
      if (encoded) referenceRefs.push(encoded);
      else
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "Dropped unreadable extra thumbnail reference",
            thumbnail_id: record.id,
            path: extra,
          }),
        );
    }

    const detailed = await requestImageDetailed(prompt, {
      format: args.format,
      context: `thumbnail:${args.subjectKind}:${args.subjectId}`,
      aspectRatio,
      ...(requestedBackend ? { backend: requestedBackend } : {}),
      ...(referenceRefs.length ? { referenceImages: referenceRefs } : {}),
    });
    /**
     * Buffer first, THEN write — the extension has to describe the real bytes.
     *
     * The output used to be hardcoded `.jpg` and streamed straight to disk, so
     * a PNG from veo_fleet landed at a `.jpg` path and nothing downstream could
     * tell. Sniffing the header also gives us the pixel dimensions, which is
     * the only place the YouTube contract can actually be enforced: `resolution`
     * is recorded on the row but never transmitted (ImageRequestOptions has no
     * resolution field), so the request is advisory and the response is the
     * only source of truth.
     */
    const bytes = await downloadMediaBuffer(detailed.ref);
    const image = assertYouTubeThumbnail(bytes, {
      thumbnailId: record.id,
      provider: detailed.servedBy,
      aspectRatio,
      resolution,
    });

    /**
     * ── EXACT 1280x720 ────────────────────────────────────────────────────
     * The assert above proves the provider gave us at least 1280x720 (it
     * refuses to upscale, which is right). What it does NOT do is make the
     * stored file the size YouTube actually wants: veo_fleet returns 1376x768,
     * whose aspect is 1.7917 rather than 16:9's 1.7778. A straight
     * scale=1280:720 would compress the host's face ~0.8% horizontally — on
     * every video, always the same face. So normalisation center-crops to true
     * 16:9 first and only then scales, and the result is re-measured before it
     * is written.
     *
     * This is a deliberate, declared transform, not a synthetic fallback: it
     * only ever crops and downscales, never invents pixels, and it throws
     * (leaving the row `failed` with the measured numbers) if it cannot hit the
     * contract.
     */
    const normalised = await normaliseYouTubeThumbnailBuffer(
      bytes,
      image.extension,
    );
    assertExactYouTubeThumbnail(normalised.buffer, {
      thumbnailId: record.id,
      stage: "post-normalise",
    });
    if (
      image.width !== normalised.width ||
      image.height !== normalised.height
    ) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "Thumbnail normalised to the YouTube 1280x720 contract",
          thumbnail_id: record.id,
          from: `${image.width}x${image.height} ${image.format} ${image.byteLength}B`,
          to: `${normalised.width}x${normalised.height} jpg ${normalised.byteSize}B`,
          jpeg_q: normalised.quality,
        }),
      );
    }
    // Always .jpg now: normalisation re-encodes, so the extension describes the
    // real bytes exactly as the sniffing step demanded.
    const outputPath = join(outputDir, `thumbnail-${record.id}.jpg`);
    await writeFile(outputPath, normalised.buffer);

    // ── Honest provider attribution (fixes A2.5, §2.6) ──────────────────────
    // servedBy/chain/fallbackUsed come from the GATEWAY, not from guessing the
    // ref shape. providerFromRef is deleted.
    const servedBy = detailed.servedBy;
    const fallbackUsed = detailed.fallbackUsed;
    const wanted = detailed.chain[0] ?? requestedBackend ?? servedBy;

    if (fallbackUsed) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "Thumbnail backend FALLBACK fired",
          thumbnail_id: record.id,
          wanted,
          served_by: servedBy,
          chain: detailed.chain,
        }),
      );
      // §2.6 opt-in strictness: 'fail' refuses a downgraded thumbnail.
      if (onFallback === "fail") {
        throw new Error(
          `Fallback fired (wanted ${wanted}, served by ${servedBy}) and ` +
            `on_fallback=fail. Refusing a downgraded thumbnail.`,
        );
      }
    }

    await updateThumbnailRecord(db, record.id, {
      output_path: outputPath,
      provider_used: servedBy,
      backend_chain: detailed.chain,
      fallback_used: fallbackUsed,
      status: "completed",
    });
    // NOTE: is_selected is written ONCE by the selection rule
    // (selectBestThumbnailForSubject), never as a side effect of a generation
    // completing (fixes A2.12 — the "last-to-finish ships" bug). The Studio's
    // "Use" button and the auto-pilot both call the selection rule explicitly.

    return {
      thumbnailId: record.id,
      outputPath,
      status: "completed",
      providerUsed: servedBy,
      fallbackUsed,
      ...(fallbackUsed && wanted !== servedBy
        ? { downgradedFrom: wanted }
        : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (record) {
      await updateThumbnailRecord(db, record.id, {
        status: "failed",
        error_message: msg,
      }).catch(() => {});
      return {
        thumbnailId: record.id,
        outputPath: null,
        status: "failed",
        error: msg,
      };
    }
    console.error(
      JSON.stringify({
        level: "error",
        message: "Thumbnail failed before record creation",
        subject_id: args.subjectId,
        channel_id: args.channelId,
        error: msg,
      }),
    );
    return { thumbnailId: "", outputPath: null, status: "failed", error: msg };
  }
}

/**
 * Record a REFUSAL as a visible, failed thumbnail row.
 *
 * Every pre-flight refusal in this engine used to `return { status: "skipped" }`
 * BEFORE `createThumbnailRecord` ran, which meant the refusal existed only as a
 * line in a worker log. On the Thumbnails tab that renders as a card reading
 * "no thumbnail" with no explanation anywhere in the product — which is exactly
 * the blank tile in the owner's screenshot, and exactly the shape of the
 * 75-consecutive-failures incident this system is already famous for.
 *
 * A refusal is now a row: status `failed`, the reason in `error_message`, and
 * whatever was resolved before we gave up (channel, archetype, references) so
 * the diagnosis is in the record rather than in a log nobody reads.
 *
 * `failed` rather than a dedicated `skipped` status because `thumbnail_status`
 * has exactly four values in the live database (pending/generating/completed/
 * failed) and inventing a fifth would need a hand-applied enum migration to say
 * something the error message already says. From the operator's seat "we
 * refused to make this" and "we tried and it broke" are the same fact: there is
 * no thumbnail, and here is why.
 *
 * Never throws: if the insert itself fails we fall back to the old traceless
 * return rather than turning a refusal into a crash in a non-blocking path.
 */
async function recordRefusal(
  db: DrizzleClient,
  args: RequestThumbnailArgs,
  ctx: {
    kind: ThumbnailGenerationKind;
    channelId: string | null;
    archetypeId: string | null;
    aspectRatio: MediaAspect;
    resolution: string;
    reason: string;
    prompt?: string;
    referencePaths?: {
      archetype?: string;
      persona?: string;
      logo?: string;
      base?: string;
    };
  },
): Promise<RequestThumbnailResult> {
  console.error(
    JSON.stringify({
      level: "error",
      message: "Thumbnail REFUSED before generation",
      subject_kind: args.subjectKind,
      subject_id: args.subjectId,
      channel_id: ctx.channelId,
      archetype_id: ctx.archetypeId,
      format: args.format,
      reason: ctx.reason,
    }),
  );
  try {
    const row = await createThumbnailRecord(db, {
      subject_kind: args.subjectKind,
      subject_id: args.subjectId,
      channel_id: ctx.channelId,
      archetype_id: ctx.archetypeId,
      language: args.language ?? "en",
      prompt_mode: "programmatic",
      // NOT NULL in the schema. Empty means "we never got as far as a prompt",
      // which is the truth for most refusals; the ones that did get there pass
      // the real prompt so its length can be inspected.
      prompt_used: ctx.prompt ?? "",
      reference_paths: ctx.referencePaths ?? {},
      aspect_ratio: ctx.aspectRatio,
      resolution: ctx.resolution,
      title: args.title.slice(0, 300),
      topic: args.topic ?? null,
      parent_thumbnail_id: args.parentThumbnailId ?? null,
      generation_kind: ctx.kind,
      ...(args.requestGroupId ? { request_group_id: args.requestGroupId } : {}),
      variant_index: args.variantIndex ?? 0,
      requested_backend: args.backend ?? configuredBackend() ?? null,
      status: "failed",
      error_message: ctx.reason,
      is_selected: false,
    });
    return {
      thumbnailId: row.id,
      outputPath: null,
      status: "failed",
      error: ctx.reason,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Could not even record the thumbnail refusal",
        subject_id: args.subjectId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return {
      thumbnailId: "",
      outputPath: null,
      status: "failed",
      error: ctx.reason,
    };
  }
}

/**
 * Convert a reference image into something the gateway accepts. `data:` and
 * `http(s):` pass through; a local filesystem path is read and inlined as a
 * data: URI. Returns undefined when the file cannot be read.
 */
async function toGatewayRef(pathOrUrl: string): Promise<string | undefined> {
  if (/^(data:|https?:)/i.test(pathOrUrl)) return pathOrUrl;
  try {
    const buf = await readFile(pathOrUrl);
    const lc = pathOrUrl.toLowerCase();
    const mime = lc.endsWith(".png")
      ? "png"
      : lc.endsWith(".webp")
        ? "webp"
        : "jpeg";
    return `data:image/${mime};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}
