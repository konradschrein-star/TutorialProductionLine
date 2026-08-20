import { CfApiError } from "../errors.js";

/**
 * Single source of truth for what formats Content Forge can produce.
 *
 * Adding a new format is a 3-step ritual:
 *   1. Add an entry here.
 *   2. Implement `packages/cf-api/src/jobs/create-<format>.ts` and export it
 *      from `packages/cf-api/src/jobs/index.ts`.
 *   3. Register the creator in the dispatch switch at
 *      `apps/hub-web/src/app/api/v1/formats/[format]/jobs/route.ts`.
 *
 * Nothing else needs to know — `/api/v1/formats` and `cf_list_formats`
 * pull from this registry, so the new format becomes visible to both
 * the hub UI and Hermes Workspace the moment it's added.
 *
 * ## Invariant: every entry must be real
 *
 * An `id` here must be a member of the `ContentFormat` enum
 * (`packages/contracts/src/enums/content-format.ts`), and its
 * `payloadSchema` must name a creator that actually exists. The registry
 * previously carried a `COMPARISON_SOFTWARE` entry that satisfied neither —
 * not a ContentFormat member, and it promised a `create-comparison.ts` that
 * was never written. It has been removed; the real comparison format is
 * `TECH_COMPARISON`, which is created through the hub-web job form and the
 * `/formats/tech-comparison` ingestion panel, NOT through cf-api, so it is
 * deliberately absent until a `create-tech-comparison.ts` exists.
 */
export interface FormatDescriptor {
  /** Stable enum value as stored in `content_jobs.format`. */
  id: string;
  /** Human-friendly label for UIs. */
  label: string;
  /**
   * One-liner describing what this format produces. Surfaced in the
   * MCP tool description so the LLM picks the right format.
   */
  description: string;
  /**
   * Which payload schema (from @repo/contracts) the create endpoint
   * accepts. Encoded as a string so cf-api stays decoupled from Zod
   * imports at the registry level.
   */
  payloadSchema:
    | "LongFormDramaCreate"
    | "CasuallyExplainedCreate"
    | "RankingCreate"
    | "Generic";
  /** Whether the format supports script-from-topic auto-generation. */
  supportsAutoScript: boolean;
  /** True if the format is currently buildable end-to-end. */
  enabled: boolean;
}

const REGISTRY: readonly FormatDescriptor[] = [
  {
    id: "LONG_FORM_DRAMA",
    label: "Long-form drama",
    description:
      "20–60 minute reality-TV-style dramatic narration with TTS, generated visuals, and music. Templates: DIRECT_T2V, STOCK_CHAIN_FULL, STOCK_CHAIN_HOOKED, SLOW_VIDEO, KEN_BURNS.",
    payloadSchema: "LongFormDramaCreate",
    supportsAutoScript: true,
    enabled: true,
  },
  {
    id: "CASUALLY_EXPLAINED",
    label: "Casually Explained",
    description:
      "Humorous minimalist explainer videos, hand-drawn stick-figure aesthetic. Auto-script from topic OR verbatim script. Routes via ingest queue (async — content_jobs row appears within ~10s of accept).",
    payloadSchema: "CasuallyExplainedCreate",
    supportsAutoScript: true,
    enabled: true,
  },
  {
    id: "RANKING",
    label: "Ranking (tier list)",
    description:
      "Tier-list ranking videos: items are placed into tiers with a three-beat per-item cut (tier board → product B-roll → reveal). Give a freeform brief (a pasted script, a list, or a description) and the LLM derives and ranks the items, or pass explicit items to pin them. Routes via the ingest queue (async — the content_jobs row appears within ~10s of accept). Set jobMode='full_auto' to skip the human B-roll review gate.",
    payloadSchema: "RankingCreate",
    supportsAutoScript: true,
    enabled: true,
  },
];

export function listFormats(): FormatDescriptor[] {
  return [...REGISTRY];
}

export function getFormat(id: string): FormatDescriptor {
  const match = REGISTRY.find((f) => f.id === id);
  if (!match) {
    throw new CfApiError("NOT_FOUND", `Unknown format: ${id}`, {
      knownFormats: REGISTRY.map((f) => f.id),
    });
  }
  return match;
}
