import Link from "next/link";
import {
  BookOpen,
  Film,
  Monitor,
  PenTool,
  Pencil,
  ListOrdered,
  Briefcase,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Format Card Component
 *
 * Server component displaying a content format as a clickable card
 * in the format grid. Links to the format workstation page.
 */

interface FormatCardProps {
  format: string;
  description: string;
  totalJobs: number;
  activeJobs: number;
  templateCount: number;
  failedJobs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatSlug(format: string): string {
  return format.toLowerCase().replace(/_/g, "-");
}

export function formatDisplayName(format: string): string {
  return format
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

const ALL_FORMATS = [
  "EXPLAINER",
  "DOCUMENTARY",
  "TECH_COMPARISON",
  "VIDEO_ESSAY",
  "CASUALLY_EXPLAINED",
  "BUNDESTAG",
  "RANKING",
  "BUSINESS_PLAN_HUB",
] as const;

/**
 * Convert a URL slug back to the format enum value.
 * Returns null if the slug doesn't match any known format.
 */
export function formatSlugToEnum(slug: string): string | null {
  const enumValue = slug.toUpperCase().replace(/-/g, "_");
  return ALL_FORMATS.includes(enumValue as any) ? enumValue : null;
}

// ---------------------------------------------------------------------------
// Format metadata map
// ---------------------------------------------------------------------------

export const FORMAT_META: Record<
  string,
  { icon: LucideIcon; description: string; iconName: string; accent?: string }
> = {
  EXPLAINER: {
    icon: BookOpen,
    iconName: "menu_book",
    description: "Educational breakdowns of concepts, processes, or systems",
  },
  DOCUMENTARY: {
    icon: Film,
    iconName: "movie",
    description: "Long-form narrative content on historical or cultural topics",
  },
  TECH_COMPARISON: {
    icon: Monitor,
    iconName: "monitor",
    description: "Side-by-side product evaluations and reviews",
  },
  VIDEO_ESSAY: {
    icon: PenTool,
    iconName: "edit_note",
    description: "Long-form opinion or analysis pieces",
  },
  CASUALLY_EXPLAINED: {
    icon: Pencil,
    iconName: "draw",
    description: "Dry-humor commentary with stick-figure illustration art",
  },
  BUNDESTAG: {
    icon: BookOpen,
    iconName: "account_balance",
    description:
      "Procedural German parliamentary speech video automation with intelligent clip selection",
  },
  RANKING: {
    icon: ListOrdered,
    iconName: "leaderboard",
    description:
      "Tier-list ranking videos — rank anything into 5 tiers with an opinionated host.",
    accent: "#3ddc84",
  },
  BUSINESS_PLAN_HUB: {
    icon: Briefcase,
    iconName: "business_center",
    description:
      "Business-plan, SBA and EB-5 explainers — FFmpeg spine, cached Remotion motion-graphic islands, logo-headed presenter overlay.",
    // Ocean slate from the format's single-hue token ramp (design §3.1).
    accent: "#4e8ea2",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FormatCard({
  format,
  description,
  totalJobs,
  activeJobs,
  templateCount,
  failedJobs,
}: FormatCardProps) {
  const slug = formatSlug(format);
  const name = formatDisplayName(format);
  const meta = FORMAT_META[format];
  const Icon = meta?.icon ?? BookOpen;

  return (
    <Link href={`/formats/${slug}`}>
      <div className="glass-card p-6 rounded-xl hover:bg-surface-bright/50 transition-all duration-300 group cursor-pointer relative">
        {/* Failed jobs indicator */}
        {failedJobs > 0 && (
          <span className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-error" />
        )}

        {/* Top: icon + name */}
        <div className="flex items-center gap-3 mb-3">
          <Icon className="w-8 h-8 text-primary/60 group-hover:text-primary transition-colors" />
          <span className="text-lg font-bold text-text">{name}</span>
        </div>

        {/* Middle: description */}
        <p className="text-sm text-text-muted line-clamp-2 mb-4">
          {description}
        </p>

        {/* Bottom: stat pills */}
        <div className="flex flex-wrap gap-2">
          <span className="px-3 py-1 rounded-full bg-surface-container text-xs font-medium text-text-muted">
            {totalJobs} Jobs
          </span>
          <span
            className={cn(
              "px-3 py-1 rounded-full bg-surface-container text-xs font-medium",
              activeJobs > 0 ? "text-primary" : "text-text-muted",
            )}
          >
            {activeJobs} Active
          </span>
          <span className="px-3 py-1 rounded-full bg-surface-container text-xs font-medium text-text-muted">
            {templateCount} Templates
          </span>
        </div>
      </div>
    </Link>
  );
}
