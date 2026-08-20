"use server";

export interface FormatInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
}

const AVAILABLE_FORMATS: FormatInfo[] = [
  {
    id: "CASUALLY_EXPLAINED",
    name: "Casually Explained",
    description: "Humorous explanations in the Casually Explained style",
    icon: "sentiment_very_satisfied",
    version: "1.0.0",
  },
  {
    id: "EXPLAINER",
    name: "Explainer",
    description: "Educational breakdowns of complex topics",
    icon: "school",
    version: "1.0.0",
  },
  {
    id: "POLITICAL_COMMENTARY_REACTOR",
    name: "Reactor Commentary",
    description:
      "React to a YouTube video — auto-transcribe, generate skeptical German commentary with animated avatar overlay",
    icon: "live_tv",
    version: "1.0.0",
  },
  {
    id: "TECH_COMPARISON",
    name: "Tech Comparison",
    description: "In-depth product and technology comparisons",
    icon: "compare",
    version: "1.0.0",
  },
  {
    id: "VIDEO_ESSAY",
    name: "Video Essay",
    description:
      "Clip-based long-form essays with Gemini script generation and hybrid clip retrieval",
    icon: "edit_note",
    version: "1.0.0",
  },
  {
    id: "RANKING",
    name: "Ranking",
    description:
      "Tier-list ranking videos — rank anything into 5 tiers with an opinionated host",
    icon: "leaderboard",
    version: "1.0.0",
  },
  {
    id: "BUSINESS_PLAN_HUB",
    name: "Business Plan Hub",
    description:
      "Business-plan, SBA and EB-5 marketing explainers — every stat carries a primary source, charts are computed not authored",
    icon: "business_center",
    version: "1.0.0",
  },
];

export async function getAvailableFormats(): Promise<FormatInfo[]> {
  return AVAILABLE_FORMATS;
}

export async function getFormatInfo(
  formatId: string,
): Promise<FormatInfo | null> {
  return AVAILABLE_FORMATS.find((f) => f.id === formatId) ?? null;
}
