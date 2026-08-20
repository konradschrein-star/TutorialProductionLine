/**
 * Format-specific configuration for ingestion UI.
 *
 * Each format defines what files it expects, labels, hints,
 * and whether certain features (avatar video, script) are relevant.
 */

export interface FormatConfig {
  /** Human-readable format name */
  label: string;
  /** Short description shown in the ingestion UI */
  description: string;
  /** What the dropzone should say */
  dropzoneHint: string;
  /** Whether this format expects an avatar/presenter video */
  expectsVideo: boolean;
  /** Label for the video column (e.g. "Avatar Video", "B-Roll") */
  videoLabel: string;
  /** Whether this format expects a pre-written script */
  expectsScript: boolean;
  /** Label for the script column */
  scriptLabel: string;
  /** Placeholder text for the topic field */
  topicPlaceholder: string;
  /** Accent color class for the format badge */
  accentColor: string;
}

const FORMAT_CONFIGS: Record<string, FormatConfig> = {
  EXPLAINER: {
    label: "Explainer",
    description: "Educational breakdowns with visuals and narration",
    dropzoneHint:
      "Drop script (.txt, .md) or just add a topic — AI generates the script",
    expectsVideo: false,
    videoLabel: "Video",
    expectsScript: false,
    scriptLabel: "Script",
    topicPlaceholder: "e.g. How does CRISPR gene editing work?",
    accentColor: "text-blue-400",
  },
  DOCUMENTARY: {
    label: "Documentary",
    description: "Long-form narrative content with historical visuals",
    dropzoneHint: "Drop script (.txt, .md) or add a topic for AI generation",
    expectsVideo: false,
    videoLabel: "Footage",
    expectsScript: false,
    scriptLabel: "Narration Script",
    topicPlaceholder: "e.g. The Fall of the Roman Empire",
    accentColor: "text-emerald-400",
  },
  TECH_COMPARISON: {
    label: "Comparison X vs Y",
    description:
      "Side-by-side product comparison with AI research, procedural scene structure, and VA data grid audit. Supports software, hardware, goods, and services.",
    dropzoneHint:
      "Enter Product A and Product B — AI researches both products and generates the script automatically",
    expectsVideo: false,
    videoLabel: "HeyGen Clip (optional)",
    expectsScript: false,
    scriptLabel: "Script",
    topicPlaceholder: "e.g. Notion vs Obsidian",
    accentColor: "text-cyan-400",
  },
  VIDEO_ESSAY: {
    label: "Video Essay",
    description:
      "Long-form clip-based essays — Gemini writes the script, RRF hybrid search assembles clips from your library",
    dropzoneHint:
      "Enter a topic — Gemini generates a 2500–4000 word essay script automatically",
    expectsVideo: false,
    videoLabel: "Video",
    expectsScript: false,
    scriptLabel: "Essay Script",
    topicPlaceholder: "e.g. Why Social Media Destroyed Attention Spans",
    accentColor: "text-violet-400",
  },
  // CE's default and only confirmed end-to-end path is
  // script → TTS → generated images → FFmpeg, with NO presenter video.
  // This block previously claimed `expectsVideo: true` / "Avatar Video",
  // which described the avatar template variant
  // (packages/db/src/seed-casually-explained-template.ts, which routes through
  // AWAITING_PRODUCTION_VA) rather than the format as a whole. Presenter
  // footage is an opt-in property of a *template*, not of CASUALLY_EXPLAINED.
  CASUALLY_EXPLAINED: {
    label: "Casually Explained",
    description: "Dry-humor commentary with stick-figure illustration art",
    dropzoneHint:
      "Drop a finished script (.txt, .md) or just add a topic — AI writes the script, generates the images, and narrates it",
    expectsVideo: false,
    videoLabel: "Presenter Video (optional)",
    expectsScript: false,
    scriptLabel: "Script",
    topicPlaceholder: "e.g. Why relationships are just market inefficiencies",
    accentColor: "text-yellow-400",
  },
  RANKING: {
    label: "Ranking",
    description:
      "Tier-list ranking videos — rank anything into 5 tiers with an opinionated host",
    dropzoneHint:
      "Enter a topic and the items to rank — AI writes the script and collects footage",
    expectsVideo: false,
    videoLabel: "Footage",
    expectsScript: false,
    scriptLabel: "Script",
    topicPlaceholder: "e.g. Best budget mechanical keyboards",
    accentColor: "text-green-400",
  },
  // Only `label`, `description`, `dropzoneHint`, `videoLabel`, `scriptLabel`,
  // `topicPlaceholder` and `accentColor` are read by any consumer — the two
  // `expects*` booleans are declared by the interface but nothing reads them,
  // which is how the CASUALLY_EXPLAINED entry above rotted. They are left at
  // `false` here as the inert value rather than as a claim about the format.
  //
  // BUSINESS_PLAN_HUB takes no uploads at all: there is no screen capture and
  // no human recording anything, every visual is generated or sourced through
  // the visual gateway (design §6.1). The dropzone hint says so instead of
  // inviting files the pipeline would ignore.
  BUSINESS_PLAN_HUB: {
    label: "Business Plan Hub",
    description:
      "Business-plan, SBA and EB-5 marketing explainers — charts are computed by finance-kit, and every stat, formula or quote must cite a primary source or the build fails",
    dropzoneHint:
      "No uploads — enter a topic and video family; the script, sourced visuals and motion graphics are all produced by the pipeline",
    expectsVideo: false,
    videoLabel: "Sourced B-Roll",
    expectsScript: false,
    scriptLabel: "Script",
    topicPlaceholder: "e.g. How to write a business plan for an SBA 7(a) loan",
    accentColor: "text-sky-400",
  },
  // IDLE (parked 2026-07-30) — config retained so the pipeline keeps working
  // when re-enabled via CF_ENABLE_IDLE_FORMATS. See @repo/contracts
  // FORMAT_LIFECYCLE and docs/FORMAT_REGISTRIES.md.
  BUNDESTAG: {
    label: "Bundestag",
    description:
      "German parliamentary speech video automation with intelligent clip selection and automated editing",
    dropzoneHint:
      "Provide absolute filesystem paths to pre-uploaded video clips (one per line in textarea)",
    expectsVideo: true,
    videoLabel: "Video Clips",
    expectsScript: false,
    scriptLabel: "Script",
    topicPlaceholder: "e.g., 2024-03-15 Budget Debate Session",
    accentColor: "text-indigo-400",
  },
};

const DEFAULT_CONFIG: FormatConfig = {
  label: "Content",
  description: "Generic content production",
  dropzoneHint: "Drop files here — .zip, .mp4, .mov, .txt, .md, .srt",
  expectsVideo: false,
  videoLabel: "Video",
  expectsScript: false,
  scriptLabel: "Script",
  topicPlaceholder: "Enter topic...",
  accentColor: "text-text-muted",
};

export function getFormatConfig(format: string): FormatConfig {
  return FORMAT_CONFIGS[format] ?? DEFAULT_CONFIG;
}
