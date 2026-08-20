/**
 * Renderer Compatibility Matrix
 *
 * Tracks which renderers support which formats and data structures.
 * As the system scales to 50+ formats and multiple renderers, this matrix
 * ensures we route jobs to compatible renderers.
 *
 * Usage:
 * - Check compatibility before routing: isRendererCompatible(format, workflow)
 * - Get all compatible renderers: getCompatibleRenderers(format)
 * - Get renderer requirements: getRendererRequirements(workflow)
 */

import type { ContentFormat } from "@repo/contracts";

/**
 * Content format types.
 *
 * Aliased to the canonical `ContentFormat` enum in @repo/contracts rather than
 * re-declared. The old hand-written 6-member union asserted that those six
 * formats were the entire universe, which was false — RANKING,
 * LONG_FORM_DRAMA and BUNDESTAG all exist and none of them appeared here. That
 * lie is what allowed `isRendererCompatible()` to index the compatibility
 * matrix with a key TypeScript believed always existed.
 */
export type Format = ContentFormat;

/**
 * Supported render workflows (renderer implementations)
 */
export const RENDER_WORKFLOWS = {
  /** GPU-accelerated Ken Burns with FFmpeg encoding */
  V3_FFMPEG: "v3-ffmpeg",
  /** Remotion-based composition with CPU Ken Burns */
  V2_COMPOSITION: "v2-composition",
  /** Legacy Remotion layout (avatar-based formats only) */
  CLEAN_LAYOUT: "clean-layout",
  /** Remotion OffthreadVideo clip assembly (video essay / documentary) */
  CLIP_REMOTION: "clip-remotion",
  /** FFmpeg concat clip assembly (fast, lower quality) */
  CLIP_FFMPEG: "clip-ffmpeg",
  /** Remotion reactor composition: reference video clips + TTS commentary + avatar overlay */
  POLITICAL_COMMENTARY_REACTOR: "political-commentary-reactor",
  /** Remotion tier-list composition: tier board + per-item B-roll + reveal */
  RANKING_COMPOSITION: "ranking-composition",
  /** FFmpeg spine with cached Remotion motion-graphic islands + alpha presenter overlay */
  BUSINESS_HUB: "business-hub",
} as const;

export type RenderWorkflow =
  (typeof RENDER_WORKFLOWS)[keyof typeof RENDER_WORKFLOWS];

/**
 * Data structure requirements for each renderer
 */
export interface RendererRequirements {
  /** Renderer workflow name */
  workflow: RenderWorkflow;
  /** Human-readable description */
  description: string;
  /** Required fields in assembly_manifest.scenes[] */
  requiredFields: {
    /** Single image per scene (visual_asset_key) */
    singleImage?: boolean;
    /** Multiple images per scene (sentence_images[]) */
    multipleImages?: boolean;
    /** Avatar video footage required */
    avatarFootage?: boolean;
    /** Scene duration in frames */
    durationFrames: boolean;
  };
  /** Optional features supported */
  features: {
    /** Ken Burns zoom/pan effects */
    kenBurns?: boolean;
    /** Subtitles/captions */
    subtitles?: boolean;
    /** Picture-in-picture avatar overlay */
    pip?: boolean;
  };
  /** Performance characteristics */
  performance: {
    /** Rendering speed compared to v3-ffmpeg (1.0 = baseline) */
    speedMultiplier: number;
    /** Uses GPU acceleration */
    usesGPU: boolean;
  };
}

/**
 * Renderer metadata and requirements
 */
export const RENDERER_METADATA: Record<RenderWorkflow, RendererRequirements> = {
  "v3-ffmpeg": {
    workflow: "v3-ffmpeg",
    description: "GPU-accelerated Ken Burns with FFmpeg encoding",
    requiredFields: {
      singleImage: true,
      multipleImages: true, // Supports both data structures
      durationFrames: true,
    },
    features: {
      kenBurns: true,
      subtitles: false, // Audio-only muxing
      pip: false,
    },
    performance: {
      speedMultiplier: 1.0, // Baseline
      usesGPU: true,
    },
  },
  "v2-composition": {
    workflow: "v2-composition",
    description: "Remotion-based composition with CPU Ken Burns",
    requiredFields: {
      singleImage: true,
      multipleImages: true, // Supports both data structures
      durationFrames: true,
    },
    features: {
      kenBurns: true,
      subtitles: true,
      pip: false,
    },
    performance: {
      speedMultiplier: 0.3, // ~3x slower than GPU
      usesGPU: false,
    },
  },
  "clean-layout": {
    workflow: "clean-layout",
    description: "Legacy Remotion layout (avatar-based formats only)",
    requiredFields: {
      avatarFootage: true,
      durationFrames: true,
    },
    features: {
      kenBurns: false,
      subtitles: true,
      pip: true,
    },
    performance: {
      speedMultiplier: 0.25, // ~4x slower than GPU
      usesGPU: false,
    },
  },
  "clip-remotion": {
    workflow: "clip-remotion",
    description:
      "Remotion OffthreadVideo clip assembly — single encode pass, no generational quality loss",
    requiredFields: {
      durationFrames: false,
    },
    features: {
      kenBurns: false,
      subtitles: true,
      pip: false,
    },
    performance: {
      speedMultiplier: 0.4,
      usesGPU: false,
    },
  },
  "clip-ffmpeg": {
    workflow: "clip-ffmpeg",
    description:
      "FFmpeg concat clip assembly — fast but re-encodes each segment",
    requiredFields: {
      durationFrames: false,
    },
    features: {
      kenBurns: false,
      subtitles: true,
      pip: false,
    },
    performance: {
      speedMultiplier: 0.9,
      usesGPU: false,
    },
  },
  "political-commentary-reactor": {
    workflow: "political-commentary-reactor",
    description:
      "Reactor composition: reference video clips interleaved with TTS commentary + avatar overlay",
    requiredFields: {
      durationFrames: false,
    },
    features: {
      kenBurns: false,
      subtitles: false,
      pip: true,
    },
    performance: {
      speedMultiplier: 0.4,
      usesGPU: false,
    },
  },
  "ranking-composition": {
    workflow: "ranking-composition",
    description:
      "Remotion tier-list composition: intro card, then per item a tier-board beat, a full-screen B-roll beat and a split-screen reveal, closing on the final board. Shot boundaries come from Whisper-anchored per-item narration segments, not from assembly_manifest scenes.",
    requiredFields: {
      // Timing is derived from metadata.ranking (per-item narration segments
      // + the shared ranking-timing module), not from scene durationFrames.
      durationFrames: false,
    },
    features: {
      kenBurns: false,
      subtitles: false,
      pip: false,
    },
    performance: {
      speedMultiplier: 0.4,
      usesGPU: false,
    },
  },
  "business-hub": {
    workflow: "business-hub",
    description:
      "Business Plan Hub: FFmpeg owns the assembly spine; Remotion renders only motion-graphic island scenes (kind='mg') to short clips cached by content hash. The presenter is an alpha overlay track (suit PNG + logo head scaled by narration RMS) composited in a single FFmpeg overlay pass — no browser. Shot boundaries come from the typed scene plan in metadata, not from assembly_manifest scenes.",
    requiredFields: {
      // Timing comes from the scene plan + Whisper-anchored sentence timings,
      // not from assembly_manifest scene durationFrames.
      durationFrames: false,
    },
    features: {
      kenBurns: false,
      subtitles: true,
      pip: false,
    },
    performance: {
      // UNMEASURED. This workflow has never been run, so there is no timing to
      // report. The value below is the design intent (FFmpeg spine, browser
      // used only for cached MG islands, so close to the v3-ffmpeg baseline),
      // NOT an observation. Replace it with a measured figure after the first
      // end-to-end render. Nothing reads this field at runtime — it is
      // documentation, and treating it as data would be treating a guess as a
      // measurement.
      speedMultiplier: 0.9,
      // NVIDIA driver is recorded broken on both the VPS and the VM, so there
      // is no GPU path today (docs: project-nvidia-driver-broken-2026-07-30).
      usesGPU: false,
    },
  },
};

/**
 * Format → Renderer compatibility matrix
 *
 * Maps each format to compatible renderers in priority order (preferred first).
 * Formats are added as they're tested with each renderer.
 *
 * **This is an allow-list of verified pairs, and it is deliberately partial.**
 * A format is absent because nobody has verified it against a renderer here —
 * NOT because it is incompatible with everything, and NOT because it doesn't
 * exist. Currently absent: LONG_FORM_DRAMA, BUNDESTAG, plus every IDLE/RETIRED
 * format.
 *
 * BUNDESTAG in particular cannot be listed truthfully today: it renders through
 * its own bespoke processor
 * (`apps/worker-render/src/processors/bundestag-render-processor.ts`), which is
 * not one of `RENDER_WORKFLOWS`. Inventing an entry for it would be a guess.
 *
 * Do not add speculative entries. Add a format here only after you have
 * actually rendered it with that workflow, and set `lastVerified`.
 */
export const FORMAT_RENDERER_COMPATIBILITY: Partial<
  Record<
    Format,
    {
      /** Compatible renderers in priority order (preferred first) */
      compatible: RenderWorkflow[];
      /** Incompatible renderers with reason */
      incompatible: Array<{ workflow: RenderWorkflow; reason: string }>;
      /** Last verified date */
      lastVerified?: string;
    }
  >
> = {
  CASUALLY_EXPLAINED: {
    compatible: [
      "v3-ffmpeg", // Preferred: Fast GPU rendering
      "v2-composition", // Fallback: Slower but works
    ],
    incompatible: [
      {
        workflow: "clean-layout",
        reason:
          "Requires avatar footage, Casually Explained uses static images only",
      },
    ],
    lastVerified: "2026-05-19", // Date of testing session
  },
  EXPLAINER: {
    compatible: ["v3-ffmpeg", "v2-composition"],
    incompatible: [
      {
        workflow: "clean-layout",
        reason: "Requires avatar footage",
      },
    ],
  },
  TECH_COMPARISON: {
    compatible: [
      "v2-composition", // Dedicated ComparisonMasterTimeline branch in v2-composition workflow
    ],
    incompatible: [
      {
        workflow: "clean-layout",
        reason:
          "Requires avatar footage; Tech Comparison uses product images only",
      },
    ],
    lastVerified: "2026-05-23",
  },
  VIDEO_ESSAY: {
    compatible: [
      "clip-remotion", // Preferred: single-pass Remotion OffthreadVideo, no quality loss
      "clip-ffmpeg", // Fallback: faster but re-encodes each segment
    ],
    incompatible: [
      {
        workflow: "v3-ffmpeg",
        reason:
          "v3-ffmpeg requires B-roll images; video essays use source clips",
      },
      {
        workflow: "v2-composition",
        reason:
          "v2-composition requires image B-roll; video essays use source clips",
      },
      {
        workflow: "clean-layout",
        reason: "clean-layout requires avatar footage",
      },
    ],
    lastVerified: "2026-05-24",
  },
  DOCUMENTARY: {
    compatible: ["clip-remotion", "clip-ffmpeg"],
    incompatible: [
      {
        workflow: "v3-ffmpeg",
        reason:
          "v3-ffmpeg requires B-roll images; documentaries use source clips",
      },
      {
        workflow: "v2-composition",
        reason:
          "v2-composition requires image B-roll; documentaries use source clips",
      },
      {
        workflow: "clean-layout",
        reason: "clean-layout requires avatar footage",
      },
    ],
    lastVerified: "2026-05-24",
  },
  POLITICAL_COMMENTARY_REACTOR: {
    compatible: ["political-commentary-reactor"],
    incompatible: [],
    lastVerified: "2026-06-08",
  },
  RANKING: {
    // RANKING has exactly one renderer and always has: `render-processor.ts`
    // hard-overrides the resolved workflow to `ranking-composition` for this
    // format, so this entry records the pair the system already runs in
    // production rather than a speculative one.
    //
    // It exists to defuse a landmine. `isRendererCompatible()` throws for any
    // format with no entry, and RANKING had none — latent ONLY because the
    // seeded RANKING template sets no `render_config.workflow`, so the guarded
    // call at render-processor.ts never fired. The first RANKING template that
    // sets a workflow (or any operator setting one by hand) would have taken
    // the job down at routing time with a "never recorded" error.
    compatible: ["ranking-composition"],
    incompatible: [
      {
        workflow: "v3-ffmpeg",
        reason:
          "v3-ffmpeg assembles Ken Burns scenes from assembly_manifest images; RANKING's shots are React components driven by metadata.ranking + Whisper-anchored narration segments",
      },
      {
        workflow: "v2-composition",
        reason:
          "v2-composition renders V2Composition/ComparisonMasterTimeline from assembly_manifest scenes; RANKING has no scene list — its timing comes from per-item narration segments",
      },
      {
        workflow: "clean-layout",
        reason: "clean-layout requires avatar footage; RANKING has none",
      },
    ],
    lastVerified: "2026-08-02",
  },
  BUSINESS_PLAN_HUB: {
    // ⚠️ NOT YET VERIFIED END-TO-END. As of 2026-08-15 no BUSINESS_PLAN_HUB job
    // has been rendered — the `business-hub` workflow is being built in
    // parallel with this entry. `lastVerified` is therefore deliberately
    // ABSENT, and absent means exactly what it means everywhere else in this
    // file: nobody has confirmed this pair produces a usable video.
    //
    // Why it is listed at all, given the "no speculative entries" rule above:
    // this format is a 1:1 format↔workflow binding and it binds through
    // `render_config.workflow` ("business-hub") rather than a formatOverride,
    // so `validateRendererCompatibility()` runs on the very first job. Without
    // an entry that call throws "compatibility has never been recorded" and the
    // format cannot be smoke-tested at all. The entry is the minimum needed to
    // reach the render, not a claim that the render works.
    //
    // WHOEVER RUNS THE FIRST SUCCESSFUL RENDER: add `lastVerified` here. Until
    // that date exists, treat this pair as untested.
    compatible: ["business-hub"],
    incompatible: [
      {
        workflow: "v3-ffmpeg",
        reason:
          "v3-ffmpeg builds Ken Burns scenes from assembly_manifest images; BUSINESS_PLAN_HUB composites a layered scene plan (ground + object layer + alpha presenter overlay) and needs cached Remotion motion-graphic clips as timeline inputs, neither of which v3-ffmpeg can produce",
      },
      {
        workflow: "v2-composition",
        reason:
          "v2-composition renders every frame through Chromium; a 15-minute BUSINESS_PLAN_HUB video is ~27,000 frames with no working GPU on either host, which is the exact cost the FFmpeg-spine design exists to avoid",
      },
      {
        workflow: "clean-layout",
        reason:
          "clean-layout requires avatar footage; BUSINESS_PLAN_HUB's presenter is a still suit PNG plus an SVG head composited as an alpha overlay, not a video track",
      },
      {
        workflow: "clip-remotion",
        reason:
          "clip-remotion assembles pre-existing source clips end to end; BUSINESS_PLAN_HUB has no source-clip list — b-roll is one scene kind among five and is composited under a presenter and object layer",
      },
      {
        workflow: "clip-ffmpeg",
        reason:
          "same as clip-remotion: it concatenates a source-clip list, and BUSINESS_PLAN_HUB has none",
      },
      {
        workflow: "political-commentary-reactor",
        reason:
          "reactor is built around a downloaded reference video interleaved with commentary and an animated avatar; BUSINESS_PLAN_HUB downloads no reference video and has no avatar",
      },
      {
        workflow: "ranking-composition",
        reason:
          "ranking-composition is a tier-list composition driven by metadata.ranking per-item segments; BUSINESS_PLAN_HUB has no items and no tier board",
      },
    ],
    // lastVerified intentionally omitted — see the block comment above.
  },
};

/**
 * Formats that currently have a verified entry in the compatibility matrix.
 * Useful for diagnostics — don't infer "supported" from this, infer "checked".
 */
export function getMatrixCoveredFormats(): Format[] {
  return Object.keys(FORMAT_RENDERER_COMPATIBILITY) as Format[];
}

/**
 * Check if a renderer is compatible with a format.
 *
 * @throws {Error} if `format` has no entry in the compatibility matrix.
 *
 * ## Why this throws instead of defaulting to permissive
 *
 * Previously this did `FORMAT_RENDERER_COMPATIBILITY[format].compatible` with
 * no guard, so any unlisted format (RANKING, LONG_FORM_DRAMA, BUNDESTAG, …)
 * produced `TypeError: Cannot read properties of undefined (reading
 * 'compatible')`. That was latent rather than live only because the RANKING
 * template sets no `render_config.workflow`
 * (`packages/db/src/seed-ranking-template.ts:141`), so the guarded call at
 * `apps/worker-render/src/processors/render-processor.ts:190-224` never ran.
 * The first template that sets a workflow for an unlisted format detonates it.
 *
 * The tempting fix — `?? { compatible: [] }`, or returning `true` for unknown
 * formats — is exactly the silent guess this codebase forbids. Returning
 * `true` would invert an allow-list into a no-op and wave an unverified
 * format/renderer pair straight through to a render that produces an
 * unuploadable video hours later. Returning `false` would be marginally
 * better but reports "incompatible" when the truth is "never checked", sending
 * the next operator hunting for a compatibility problem that does not exist.
 *
 * So: fail loudly, at routing time (cheap), with the diagnostics needed to fix
 * it — which format, which workflow, what is actually covered, and what to do.
 * The sole live caller already wraps this in try/catch and surfaces the message
 * to the operator, so a throw degrades into a clear job failure, not a crash.
 */
export function isRendererCompatible(
  format: Format,
  workflow: RenderWorkflow,
): boolean {
  const formatCompat = FORMAT_RENDERER_COMPATIBILITY[format];

  if (!formatCompat) {
    throw new Error(
      `Renderer compatibility for format '${format}' has never been recorded. ` +
        `This is not a compatibility failure — the format simply has no entry ` +
        `in FORMAT_RENDERER_COMPATIBILITY, so '${workflow}' can be neither ` +
        `approved nor rejected. ` +
        `Formats with entries: ${getMatrixCoveredFormats().join(", ") || "none"}. ` +
        `Fix: render '${format}' with '${workflow}' once, confirm the output, ` +
        `then add an entry (with lastVerified) in ` +
        `packages/domain/src/renderer-compatibility.ts. ` +
        `Do not add a speculative entry to silence this error.`,
    );
  }

  return formatCompat.compatible.includes(workflow);
}

/**
 * Get all compatible renderers for a format (in priority order).
 *
 * Advisory/informational — returns `[]` for an unlisted format rather than
 * throwing, because callers use this to *display* options, not to gate
 * dispatch. `[]` reads correctly as "we have nothing verified to offer".
 * Gating is `isRendererCompatible` / `validateRendererCompatibility`, and
 * those throw. Keep that asymmetry deliberate.
 */
export function getCompatibleRenderers(format: Format): RenderWorkflow[] {
  return FORMAT_RENDERER_COMPATIBILITY[format]?.compatible ?? [];
}

/**
 * Get preferred renderer for a format (first in compatibility list)
 */
export function getPreferredRenderer(format: Format): RenderWorkflow | null {
  const compatible = getCompatibleRenderers(format);
  return compatible.length > 0 ? compatible[0] : null;
}

/**
 * Get renderer requirements and metadata
 */
export function getRendererRequirements(
  workflow: RenderWorkflow,
): RendererRequirements {
  return RENDERER_METADATA[workflow];
}

/**
 * Get incompatible renderers for a format with reasons
 */
export function getIncompatibleRenderers(
  format: Format,
): Array<{ workflow: RenderWorkflow; reason: string }> {
  return FORMAT_RENDERER_COMPATIBILITY[format]?.incompatible ?? [];
}

/**
 * Validate that a job can be rendered with a specific workflow.
 *
 * Throws if the pair is known-incompatible, if the pair is untested, or if the
 * format has no matrix entry at all — three distinct messages, so the operator
 * can tell "wrong renderer" from "never checked".
 */
export function validateRendererCompatibility(
  format: Format,
  workflow: RenderWorkflow,
): void {
  const incompatible = getIncompatibleRenderers(format).find(
    (inc) => inc.workflow === workflow,
  );

  if (incompatible) {
    throw new Error(
      `Renderer '${workflow}' is incompatible with format '${format}': ${incompatible.reason}`,
    );
  }

  if (!isRendererCompatible(format, workflow)) {
    throw new Error(
      `Renderer '${workflow}' has not been tested with format '${format}'. Compatible renderers: ${getCompatibleRenderers(format).join(", ") || "none"}`,
    );
  }
}
