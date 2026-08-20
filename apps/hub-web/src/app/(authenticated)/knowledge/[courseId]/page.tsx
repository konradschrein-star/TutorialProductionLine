import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession } from "../../_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { getCourseWithChapters } from "@/lib/repositories/knowledge-repository";
import { GlassCard } from "../../_components/glass-card";

const ICON_MAP: Record<string, string> = {
  Rocket: "rocket_launch",
  BookOpen: "menu_book",
  Search: "search",
  Sliders: "tune",
  Zap: "bolt",
  Users: "group",
  TrendingUp: "trending_up",
  DollarSign: "attach_money",
};

export default async function V2CourseOverviewPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const session = await getSession();
  if (!hasPermission(session as any, "view:knowledge")) redirect("/dashboard");

  const course = await getCourseWithChapters(courseId, session.userId);
  if (!course) notFound();

  const { allowed_roles } = course;
  if (allowed_roles.length > 0 && !allowed_roles.includes(session.role)) {
    redirect("/knowledge");
  }

  const overallPct =
    course.totalVideos > 0
      ? Math.round((course.completedVideos / course.totalVideos) * 100)
      : 0;

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Breadcrumb */}
      <div
        className="flex items-center gap-2"
        style={{
          fontSize: 11,
          color: "rgba(229,226,225,0.4)",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
        }}
      >
        <Link
          href="/knowledge"
          style={{ color: "rgba(229,226,225,0.4)" }}
          className="hover:text-white transition-colors"
        >
          Knowledge
        </Link>
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          chevron_right
        </span>
        <span style={{ color: "#eceae6" }}>{course.title}</span>
      </div>

      {/* Course header */}
      <GlassCard className="p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1
              style={{
                fontSize: 26,
                fontWeight: 900,
                color: "#eceae6",
                letterSpacing: "-0.02em",
                marginBottom: 6,
              }}
            >
              {course.title}
            </h1>
            {course.description && (
              <p
                style={{
                  color: "rgba(229,226,225,0.5)",
                  fontSize: 13,
                  lineHeight: 1.6,
                  maxWidth: 560,
                }}
              >
                {course.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-1">
            {allowed_roles.length > 0 && (
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14, color: "rgba(229,226,225,0.3)" }}
              >
                lock
              </span>
            )}
          </div>
        </div>

        {/* Overall progress */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontSize: 12, color: "rgba(229,226,225,0.4)" }}>
              {course.completedVideos} / {course.totalVideos} lessons completed
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--v2-accent)",
              }}
            >
              {overallPct}%
            </span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 6,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: 6,
                width: `${overallPct}%`,
                background:
                  "linear-gradient(to right, var(--v2-accent), var(--v2-accent-dim))",
                boxShadow:
                  overallPct > 0
                    ? "0 0 8px rgba(var(--v2-accent-rgb),0.5)"
                    : undefined,
                transition: "width 0.7s ease",
              }}
            />
          </div>
        </div>
      </GlassCard>

      {/* Module grid */}
      <div>
        <p
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            color: "rgba(229,226,225,0.35)",
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          Stages
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {course.chapters.map((chapter, idx) => {
            const total = chapter.videos.length;
            const completed = chapter.videos.filter(
              (v) => v.progress?.is_completed,
            ).length;
            const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
            const isDone = total > 0 && completed === total;
            const firstVideo = chapter.videos.find((v) => v.is_published);
            const matIcon = ICON_MAP[chapter.icon ?? ""] ?? "menu_book";
            const cleanTitle = chapter.title.replace(/^Module \d+ — /, "");

            const card = (
              <GlassCard
                className="overflow-hidden transition-all duration-200 group"
                style={{
                  cursor: firstVideo ? "pointer" : "default",
                  opacity: firstVideo ? 1 : 0.5,
                  border: firstVideo
                    ? "1px solid rgba(255,255,255,0.09)"
                    : "1px solid rgba(255,255,255,0.05)",
                }}
              >
                {/* Progress strip */}
                <div
                  style={{
                    height: 3,
                    background: isDone
                      ? "var(--v2-accent)"
                      : pct > 0
                        ? `linear-gradient(to right, var(--v2-accent) ${pct}%, rgba(255,255,255,0.08) ${pct}%)`
                        : "rgba(255,255,255,0.06)",
                    boxShadow: isDone
                      ? "0 0 8px rgba(var(--v2-accent-rgb),0.5)"
                      : undefined,
                  }}
                />

                <div className="p-4 space-y-3">
                  {/* Icon + badge */}
                  <div className="flex items-start justify-between">
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        background: "rgba(var(--v2-accent-rgb),0.10)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: 20,
                          color: "var(--v2-accent)",
                          fontVariationSettings: "'FILL' 1",
                        }}
                      >
                        {matIcon}
                      </span>
                    </div>
                    {isDone ? (
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 18, color: "var(--v2-accent)" }}
                      >
                        check_circle
                      </span>
                    ) : pct > 0 ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 20,
                          background: "rgba(var(--v2-accent-rgb),0.15)",
                          color: "var(--v2-accent)",
                        }}
                      >
                        {pct}%
                      </span>
                    ) : null}
                  </div>

                  {/* Label + title */}
                  <div>
                    <p
                      style={{
                        fontSize: 9,
                        color: "rgba(229,226,225,0.35)",
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        marginBottom: 3,
                      }}
                    >
                      Module #{idx}
                    </p>
                    <h3
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: firstVideo ? "#eceae6" : "rgba(229,226,225,0.5)",
                        lineHeight: 1.3,
                      }}
                    >
                      {cleanTitle}
                    </h3>
                  </div>

                  {/* Lesson count + play arrow */}
                  <div className="flex items-center justify-between">
                    <span
                      style={{ fontSize: 11, color: "rgba(229,226,225,0.35)" }}
                    >
                      {total} lesson{total !== 1 ? "s" : ""}
                    </span>
                    {firstVideo ? (
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: 18,
                          color: "var(--v2-accent)",
                          opacity: 0,
                        }}
                        // shown via group-hover in CSS, but inline style works too
                      >
                        play_circle
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 10,
                          color: "rgba(229,226,225,0.25)",
                          fontStyle: "italic",
                        }}
                      >
                        Coming soon
                      </span>
                    )}
                  </div>
                </div>
              </GlassCard>
            );

            return firstVideo ? (
              <Link
                key={chapter.id}
                href={`/knowledge/${courseId}/${firstVideo.id}`}
              >
                {card}
              </Link>
            ) : (
              <div key={chapter.id}>{card}</div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
