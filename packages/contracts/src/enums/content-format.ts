import { z } from "zod";

/**
 * Content Format Enum
 *
 * Initial target content verticals for the YouTube automation engine.
 * These are NOT hardcoded into business logic - they exist as dynamic
 * template entries in the Template Registry (PostgreSQL JSONB).
 *
 * New formats are added by inserting a new template row, not by
 * modifying this enum (though the enum should be updated for type safety).
 */
export const ContentFormat = z.enum([
  "EXPLAINER", // Educational breakdowns of concepts/processes/systems
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "NEWS_BROADCAST", // News-style content with avatar presenter
  "DOCUMENTARY", // Long-form narrative on historical/cultural topics
  /** IDLE since 2026-07-30 — see FORMAT_LIFECYCLE below. Code is retained. */
  "POLITICAL_COMMENTARY", // Opinion and analysis on current affairs, over operator-supplied presenter footage
  "TECH_COMPARISON", // X vs Y comparison videos (software, hardware, goods, services). Uses comparison-specific pipeline with procedural scene structure.
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "DAY_IN_THE_LIFE", // Structured personal narrative formats
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "HISTORICAL_WHAT_IF", // Speculative history, counterfactuals
  "VIDEO_ESSAY", // Long-form opinion or analysis on any topic
  "CASUALLY_EXPLAINED", // Dry-humor commentary with stick-figure illustration art
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "STICKMAN_ANIMATION", // 2D stickman action-comedy animation, TTS-first audio
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "SELF_NARRATED_STORY", // Personal story videos with self-recorded narration and AI-generated story illustrations
  /** IDLE since 2026-07-30 — see FORMAT_LIFECYCLE below. Code is retained. */
  "BUNDESTAG", // German parliamentary speech video automation with intelligent clip selection and automated editing
  /** @deprecated format retired 2026-07-02, kept so historical DB rows parse */
  "SPACE_VIDEO", // Long-form space documentary with AI-generated cinematic visuals
  "LONG_FORM_DRAMA", // Extra-long relationship drama story with Ken Burns imagery and burned subtitles
  "POLITICAL_COMMENTARY_REACTOR", // Reactor format: downloads YouTube video, auto-transcribes, generates commentary with animated avatar overlay
  "RANKING", // Tier-list ranking videos with per-item real product footage underlay
  "BUSINESS_PLAN_HUB", // Business-plan / SBA / EB-5 marketing explainers: FFmpeg spine, Remotion motion-graphic islands, logo-headed presenter overlay
]);

export type ContentFormat = z.infer<typeof ContentFormat>;

/**
 * Format Lifecycle
 *
 * This enum lists every format the system has ever had. Membership alone says
 * nothing about whether a format is usable — lifecycle does. There are exactly
 * three states, and the distinction between the last two is the point:
 *
 * - `ACTIVE`  — buildable end-to-end today. Offered to operators creating jobs.
 *
 * - `IDLE`    — **parked on purpose, not dead.** The owner wants this format
 *               kept. Nobody is working on it, so it is not offered as a choice
 *               when creating a job, but it is expected to come back. Whatever
 *               of it remains in the tree must keep typechecking, must not be
 *               deleted, and must not be described as "retired", "deprecated",
 *               or "removed" anywhere. To use one deliberately, enable it
 *               explicitly (see `CF_ENABLE_IDLE_FORMATS`, consumed by
 *               `apps/hub-web/src/lib/format-lifecycle.ts`).
 *
 *               IDLE says "preserve and intend to resume". It does NOT promise
 *               the format runs today — see the per-format notes below, and
 *               `docs/FORMAT_REGISTRIES.md` for the measured gap.
 *
 * - `RETIRED` — genuinely dead. The pipeline is gone and nobody intends to
 *               bring it back. The enum member survives only so historical
 *               `content_jobs.format` rows still parse. Do not build on these.
 *
 * ## Why POLITICAL_COMMENTARY and BUNDESTAG are IDLE, not RETIRED
 *
 * The shared premise for retiring them was that they depended on HeyGen, which
 * was dropped on cost (`docs/parts-bin/heygen.md`). That premise is false.
 * There is no HeyGen API client, SDK, or HTTP call anywhere in this repo, and
 * `HEYGEN_API_KEY` has already been removed from
 * `packages/config/src/env-schema.ts`. The gate these formats sit behind,
 * `AWAITING_PRODUCTION_VA`, is a **bare file-upload gate** — a human drops any
 * MP4/MOV into a dropzone
 * (`apps/hub-web/src/components/jobs/heygen-upload-dropzone.tsx`, finalized by
 * `finalizeHeyGenFootageUpload` in `apps/hub-web/src/app/actions/jobs.ts`,
 * stored as asset type `video/raw-va-footage`). The dependency is a human
 * supplying footage, not a vendor. A phone recording of a real person talking
 * satisfies it exactly as well as a synthesised avatar. The dropzone is merely
 * misnamed.
 *
 * Their actual states differ, and the difference matters:
 *
 * - BUNDESTAG — genuinely near-complete. Workers, queues, a bespoke FFmpeg
 *   render processor, schema, and the create form are all present and wired,
 *   and it ran end-to-end on production once (2026-07-04). What it lacks is
 *   reproducibility, not features.
 *
 * - POLITICAL_COMMENTARY — the *renderer* survives untouched
 *   (`apps/worker-render/src/workflows/clean-layout.ts`; it produced the
 *   best-scoring output this system has ever made — Gemini 8/10, "Viability:
 *   YES", `docs/archive/WORKFLOW_TEST_RESULTS.md:110-140`). The *plumbing*
 *   around it — create form, seed template, ingest branch, validation profile —
 *   was deleted in commit `031771d7` and is only partly recoverable verbatim
 *   from tag `archive/heygen-intros`. It is preserved and worth resuming, but
 *   it does not run today.
 *
 * @see docs/FORMAT_REGISTRIES.md — why six other registries disagree with this one.
 */
export type FormatLifecycle = "ACTIVE" | "IDLE" | "RETIRED";

export const FORMAT_LIFECYCLE: Record<ContentFormat, FormatLifecycle> = {
  EXPLAINER: "ACTIVE",
  DOCUMENTARY: "ACTIVE",
  TECH_COMPARISON: "ACTIVE",
  VIDEO_ESSAY: "ACTIVE",
  CASUALLY_EXPLAINED: "ACTIVE",
  LONG_FORM_DRAMA: "ACTIVE",
  POLITICAL_COMMENTARY_REACTOR: "ACTIVE",
  RANKING: "ACTIVE",
  BUSINESS_PLAN_HUB: "ACTIVE",

  // Parked on purpose. Code retained — see the block comment above.
  POLITICAL_COMMENTARY: "IDLE",
  BUNDESTAG: "IDLE",

  // Pipelines deleted 2026-07-02. Enum members kept only for historical rows.
  NEWS_BROADCAST: "RETIRED",
  DAY_IN_THE_LIFE: "RETIRED",
  HISTORICAL_WHAT_IF: "RETIRED",
  STICKMAN_ANIMATION: "RETIRED",
  SELF_NARRATED_STORY: "RETIRED",
  SPACE_VIDEO: "RETIRED",
};

/**
 * Lifecycle for a format string. Unknown strings are treated as RETIRED so a
 * stale value can never be silently offered to an operator as a live choice.
 */
export function getFormatLifecycle(format: string): FormatLifecycle {
  return FORMAT_LIFECYCLE[format as ContentFormat] ?? "RETIRED";
}

/** True only for formats that are buildable today. IDLE formats return false. */
export function isFormatActive(format: string): boolean {
  return getFormatLifecycle(format) === "ACTIVE";
}

/** True for formats that are parked but retained — recoverable, not deleted. */
export function isFormatIdle(format: string): boolean {
  return getFormatLifecycle(format) === "IDLE";
}

export const ACTIVE_FORMATS: ContentFormat[] = ContentFormat.options.filter(
  (f) => FORMAT_LIFECYCLE[f] === "ACTIVE",
);

export const IDLE_FORMATS: ContentFormat[] = ContentFormat.options.filter(
  (f) => FORMAT_LIFECYCLE[f] === "IDLE",
);

export const RETIRED_FORMATS: ContentFormat[] = ContentFormat.options.filter(
  (f) => FORMAT_LIFECYCLE[f] === "RETIRED",
);
