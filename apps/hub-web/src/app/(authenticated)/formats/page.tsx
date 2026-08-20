import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../_lib/v2-auth";
import { GlassCard } from "../_components/glass-card";
import { hasPermission, isDramaScopedRole } from "@/lib/auth/rbac";
import { getJobCountsByFormat } from "@/lib/repositories/format-repository";
import {
  formatSlug,
  formatDisplayName,
} from "@/components/formats/format-card";
import { isIdleFormatEnabled } from "@/lib/format-lifecycle";

// All format types (complete list from enum)
const ALL_FORMATS = [
  "EXPLAINER",
  "CASUALLY_EXPLAINED",
  "DOCUMENTARY",
  "TECH_COMPARISON",
  "VIDEO_ESSAY",
  "BUNDESTAG",
  "LONG_FORM_DRAMA",
  "RANKING",
  "BUSINESS_PLAN_HUB",
] as const;

// Format implementation status.
//
// IDLE is not "coming soon" and not "retired" — the pipeline exists and is
// close to finished, but it is deliberately parked and is therefore not
// offered as a job-creation choice. Canonical lifecycle lives in
// FORMAT_LIFECYCLE (@repo/contracts); set CF_ENABLE_IDLE_FORMATS to re-enable.
// See docs/FORMAT_REGISTRIES.md.
const FORMAT_STATUS: Record<string, "ACTIVE" | "IDLE" | "COMING_SOON"> = {
  EXPLAINER: "ACTIVE",
  CASUALLY_EXPLAINED: "ACTIVE",
  TECH_COMPARISON: "ACTIVE", // ✓ Operational - comparison X vs Y format
  BUNDESTAG: "IDLE", // parked 2026-07-30, code retained
  LONG_FORM_DRAMA: "ACTIVE",
  DOCUMENTARY: "COMING_SOON",
  VIDEO_ESSAY: "ACTIVE",
  RANKING: "ACTIVE",
  BUSINESS_PLAN_HUB: "ACTIVE",
};

// Material Symbols icon per format
const FORMAT_ICONS: Record<string, string> = {
  EXPLAINER: "menu_book",
  DOCUMENTARY: "movie",
  TECH_COMPARISON: "monitor",
  VIDEO_ESSAY: "edit_note",
  CASUALLY_EXPLAINED: "draw",
  BUNDESTAG: "account_balance",
  LONG_FORM_DRAMA: "theater_comedy",
  RANKING: "leaderboard",
  BUSINESS_PLAN_HUB: "business_center",
};

// Accent color per format (uses V2 semantic tokens)
const FORMAT_ACCENT: Record<string, string> = {
  EXPLAINER: "#60a5fa",
  DOCUMENTARY: "#34d399",
  TECH_COMPARISON: "#23decb",
  VIDEO_ESSAY: "#904efb",
  CASUALLY_EXPLAINED: "var(--v2-accent)",
  BUNDESTAG: "#818cf8",
  LONG_FORM_DRAMA: "#f472b6",
  RANKING: "#3ddc84",
  // Ocean slate from the Business Plan Hub token ramp. The format's whole
  // palette is single-hue ocean with no yellow and no gold (design §3.1), so
  // the card accent has to come from that ramp rather than the V2 default.
  BUSINESS_PLAN_HUB: "#4e8ea2",
};

const FORMAT_DESCRIPTIONS: Record<string, string> = {
  EXPLAINER: "Educational breakdowns of concepts, processes, or systems",
  DOCUMENTARY: "Long-form narrative content on historical or cultural topics",
  TECH_COMPARISON: "Side-by-side product evaluations and reviews",
  VIDEO_ESSAY:
    "Clip-based long-form essays — Gemini script, hybrid clip retrieval, Remotion render",
  CASUALLY_EXPLAINED: "Dry-humor commentary with stick-figure illustration art",
  BUNDESTAG:
    "Procedural German parliamentary speech video automation with intelligent clip selection",
  LONG_FORM_DRAMA:
    "Ultra-realistic relationship drama story (45–90 min) with photorealistic AI imagery",
  RANKING:
    "Tier-list ranking videos with real footage — VAs pick B-roll per item in the Selection Studio",
  BUSINESS_PLAN_HUB:
    "Business-plan, SBA and EB-5 explainers — FFmpeg spine, cached Remotion motion-graphic islands, logo-headed presenter overlay",
};

export default async function V2FormatsPage() {
  const session = await getSession();

  if (!hasPermission(session, "view:formats")) {
    redirect("/dashboard");
  }

  const dbStats = await getJobCountsByFormat();
  const statsMap = new Map(dbStats.map((s) => [s.format, s]));

  // Drama-scoped operators only see LONG_FORM_DRAMA in the list.
  const visibleFormats = isDramaScopedRole(session?.role)
    ? ALL_FORMATS.filter((f) => f === "LONG_FORM_DRAMA")
    : ALL_FORMATS;

  // Merge all formats with database stats
  const allFormats = visibleFormats.map((format) => {
    const stat = statsMap.get(format);
    const declared = FORMAT_STATUS[format] ?? "COMING_SOON";
    // An idle format becomes selectable again only when deliberately enabled.
    const status =
      declared === "IDLE" && isIdleFormatEnabled(format) ? "ACTIVE" : declared;
    return {
      format,
      status,
      total_jobs: stat?.total_jobs ?? 0,
      active_jobs: stat?.active_jobs ?? 0,
      template_count: stat?.template_count ?? 0,
      failed_jobs: stat?.failed_jobs ?? 0,
    };
  });

  // Sort: active formats first, then coming soon
  allFormats.sort((a, b) => {
    if (a.status === b.status) return 0;
    return a.status === "ACTIVE" ? -1 : 1;
  });

  const totalJobs = allFormats.reduce((s, f) => s + f.total_jobs, 0);
  const totalActive = allFormats.reduce((s, f) => s + f.active_jobs, 0);
  const activeCount = allFormats.filter((f) => f.status === "ACTIVE").length;
  const idleCount = allFormats.filter((f) => f.status === "IDLE").length;
  const comingSoonCount = allFormats.filter(
    (f) => f.status === "COMING_SOON",
  ).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#e5e2e1",
              margin: 0,
              marginBottom: 4,
            }}
          >
            Content Formats
          </h1>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
            {activeCount} active
            {idleCount > 0 ? ` · ${idleCount} idle` : ""}
            {comingSoonCount > 0 ? ` · ${comingSoonCount} coming soon` : ""}
          </p>
        </div>

        {/* Summary pills */}
        <div style={{ display: "flex", gap: 12 }}>
          <div
            style={{
              padding: "6px 14px",
              background: "rgba(var(--v2-accent-rgb), 0.1)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
              borderRadius: 20,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--v2-accent)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {totalJobs} Total Jobs
            </span>
          </div>
          {totalActive > 0 && (
            <div
              style={{
                padding: "6px 14px",
                background: "rgba(35,222,203,0.1)",
                border: "1px solid rgba(35,222,203,0.2)",
                borderRadius: 20,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#23decb",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {totalActive} Active
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 20,
        }}
      >
        {allFormats.map((item) => {
          const slug = formatSlug(item.format);
          const name = formatDisplayName(item.format);
          const icon = FORMAT_ICONS[item.format] ?? "play_circle";
          const accent = FORMAT_ACCENT[item.format] ?? "var(--v2-accent)";
          const description = FORMAT_DESCRIPTIONS[item.format] ?? "";
          const hasIssues = item.failed_jobs > 0;
          const isComingSoon = item.status === "COMING_SOON";
          // IDLE: pipeline exists and is retained, but deliberately parked.
          // Rendered non-clickable so it is not an active job-creation choice.
          const isIdle = item.status === "IDLE";
          const isInactive = isComingSoon || isIdle;

          const cardContent = (
            <GlassCard
              className={isInactive ? "" : "p-5 v2-card-hover"}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 16,
                cursor: isInactive ? "default" : "pointer",
                position: "relative",
                height: "100%",
                padding: 20,
                opacity: isInactive ? (isIdle ? 0.55 : 0.4) : 1,
                ...(hasIssues && !isInactive
                  ? {
                      border: "1px solid rgba(255,180,171,0.2)",
                    }
                  : {}),
              }}
            >
              {/* Idle badge — parked on purpose, not retired */}
              {isIdle && (
                <div
                  style={{
                    position: "absolute",
                    top: 14,
                    right: 14,
                    padding: "4px 10px",
                    background: "rgba(255,180,0,0.12)",
                    border: "1px solid rgba(255,180,0,0.3)",
                    borderRadius: 12,
                  }}
                  title="Parked on purpose — code retained. Set CF_ENABLE_IDLE_FORMATS to re-enable."
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#ffb400",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Idle
                  </span>
                </div>
              )}

              {/* Coming Soon badge */}
              {isComingSoon && (
                <div
                  style={{
                    position: "absolute",
                    top: 14,
                    right: 14,
                    padding: "4px 10px",
                    background: "rgba(var(--v2-accent-rgb), 0.15)",
                    border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
                    borderRadius: 12,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "var(--v2-accent)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Coming Soon
                  </span>
                </div>
              )}

              {/* Failed indicator dot */}
              {hasIssues && !isInactive && (
                <div
                  style={{
                    position: "absolute",
                    top: 14,
                    right: 14,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#ffb4ab",
                    boxShadow: "0 0 8px rgba(255,180,171,0.6)",
                  }}
                />
              )}

              {/* Icon + name */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: `color-mix(in srgb, ${accent} 15%, transparent)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 20, color: accent }}
                  >
                    {icon}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#e5e2e1",
                    lineHeight: 1.3,
                  }}
                >
                  {name}
                </span>
              </div>

              {/* Description */}
              <p
                style={{
                  fontSize: 11,
                  color: "rgba(205,195,215,0.55)",
                  margin: 0,
                  lineHeight: 1.5,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {description}
              </p>

              {/* Stats */}
              {!isComingSoon && (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    paddingTop: 12,
                    borderTop: "1px solid rgba(75,68,85,0.2)",
                    marginTop: "auto",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "rgba(205,195,215,0.5)",
                      padding: "3px 10px",
                      background: "#0e0e0e",
                      borderRadius: 20,
                    }}
                  >
                    {item.total_jobs} jobs
                  </span>
                  {item.active_jobs > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "#23decb",
                        padding: "3px 10px",
                        background: "rgba(35,222,203,0.08)",
                        borderRadius: 20,
                      }}
                    >
                      {item.active_jobs} active
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "rgba(205,195,215,0.4)",
                      padding: "3px 10px",
                      background: "#0e0e0e",
                      borderRadius: 20,
                    }}
                  >
                    {item.template_count} templates
                  </span>
                  {hasIssues && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "#ffb4ab",
                        padding: "3px 10px",
                        background: "rgba(255,180,171,0.08)",
                        borderRadius: 20,
                      }}
                    >
                      {item.failed_jobs} failed
                    </span>
                  )}
                </div>
              )}
            </GlassCard>
          );

          // Standalone pipeline formats (and RANKING) link straight to their
          // dedicated job-creation form. The B-Roll review worklist is reached
          // via Jobs → VA Queue, not by hijacking the format card.
          // BUSINESS_PLAN_HUB belongs here too: it has no /formats/<slug>
          // workstation and no ingestion panel — the create form is the only
          // entry point, so the card must link straight to it.
          const isStandalonePipeline =
            item.format === "LONG_FORM_DRAMA" ||
            item.format === "RANKING" ||
            item.format === "BUSINESS_PLAN_HUB";
          const href = isStandalonePipeline
            ? `/jobs/create/${slug}`
            : `/formats/${slug}`;

          // Wrap active formats in Link; coming-soon and idle render as a
          // plain div so neither is reachable as a job-creation choice.
          return isInactive ? (
            <div key={item.format}>{cardContent}</div>
          ) : (
            <Link
              key={item.format}
              href={href}
              style={{ textDecoration: "none", display: "block" }}
            >
              {cardContent}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
