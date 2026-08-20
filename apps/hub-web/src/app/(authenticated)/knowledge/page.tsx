import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../_lib/v2-auth";
import { hasPermission } from "@/lib/auth/rbac";
import { listCourses } from "@/lib/repositories/knowledge-repository";
import { getUserCourseProgress } from "@/lib/repositories/knowledge-repository";
import { GlassCard } from "../_components/glass-card";

export default async function V2KnowledgePage() {
  const session = await getSession();
  if (!hasPermission(session as any, "view:knowledge")) redirect("/dashboard");

  const courses = await listCourses(session.role);
  const progressList = await Promise.all(
    courses.map((c) => getUserCourseProgress(session.userId, c.id)),
  );

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 900,
              color: "#eceae6",
              letterSpacing: "-0.02em",
            }}
          >
            Knowledge
          </h1>
          <p
            style={{
              color: "rgba(229,226,225,0.4)",
              fontSize: 13,
              marginTop: 4,
            }}
          >
            {courses.length} course{courses.length !== 1 ? "s" : ""} available
          </p>
        </div>
        {hasPermission(session as any, "manage:knowledge") && (
          <Link
            href="/knowledge/manage"
            className="v2-btn-accent"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              settings
            </span>
            Manage
          </Link>
        )}
      </div>

      {/* Course grid */}
      {courses.length === 0 ? (
        <GlassCard className="p-16 text-center">
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 48,
              color: "rgba(229,226,225,0.2)",
              display: "block",
              marginBottom: 12,
            }}
          >
            school
          </span>
          <p style={{ color: "rgba(229,226,225,0.4)", fontSize: 14 }}>
            No courses available yet.
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {courses.map((course, i) => {
            const prog = progressList[i];
            const pct = prog?.percentComplete ?? 0;
            const roles =
              course.allowed_roles.length === 0
                ? ["ADMIN", "MANAGER", "PRODUCTION_VA", "UPLOADER_VA", "VIEWER"]
                : course.allowed_roles;
            const ROLE_COLORS: Record<string, string> = {
              ADMIN: "#aaff00",
              MANAGER: "#3b82f6",
              PRODUCTION_VA: "#f97316",
              UPLOADER_VA: "#f59e0b",
              VIEWER: "#22c55e",
            };
            return (
              <Link key={course.id} href={`/knowledge/${course.id}`}>
                <GlassCard
                  className="overflow-hidden transition-all duration-200 hover:scale-[1.02]"
                  style={{
                    cursor: "pointer",
                    border: "1px solid rgba(255,255,255,0.09)",
                  }}
                >
                  {/* Progress top strip */}
                  <div
                    style={{
                      height: 3,
                      background:
                        pct === 100
                          ? "var(--v2-accent)"
                          : pct > 0
                            ? `linear-gradient(to right, var(--v2-accent) ${pct}%, rgba(255,255,255,0.08) ${pct}%)`
                            : "rgba(255,255,255,0.06)",
                      boxShadow:
                        pct === 100
                          ? "0 0 8px rgba(var(--v2-accent-rgb),0.6)"
                          : undefined,
                    }}
                  />

                  <div className="p-5">
                    {/* Icon + lock */}
                    <div className="flex items-center justify-between mb-4">
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 10,
                          background: "rgba(var(--v2-accent-rgb),0.12)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontSize: 22,
                            color: "var(--v2-accent)",
                            fontVariationSettings: "'FILL' 1",
                          }}
                        >
                          school
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {course.allowed_roles.length > 0 && (
                          <span
                            className="material-symbols-outlined"
                            style={{
                              fontSize: 14,
                              color: "rgba(229,226,225,0.3)",
                            }}
                          >
                            lock
                          </span>
                        )}
                        {roles.map((r) => (
                          <div
                            key={r}
                            title={r}
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: ROLE_COLORS[r] ?? "#666",
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Title + desc */}
                    <h3
                      style={{
                        color: "#eceae6",
                        fontSize: 15,
                        fontWeight: 700,
                        marginBottom: 4,
                        lineHeight: 1.3,
                      }}
                    >
                      {course.title}
                    </h3>
                    {course.description && (
                      <p
                        style={{
                          color: "rgba(229,226,225,0.4)",
                          fontSize: 12,
                          lineHeight: 1.5,
                          marginBottom: 12,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {course.description}
                      </p>
                    )}

                    {/* Progress bar */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span
                          style={{
                            fontSize: 11,
                            color: "rgba(229,226,225,0.4)",
                          }}
                        >
                          {prog?.completedCount ?? 0} / {prog?.totalCount ?? 0}{" "}
                          lessons
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color:
                              pct > 0
                                ? "var(--v2-accent)"
                                : "rgba(229,226,225,0.3)",
                          }}
                        >
                          {pct}%
                        </span>
                      </div>
                      <div
                        style={{
                          height: 4,
                          borderRadius: 4,
                          background: "rgba(255,255,255,0.08)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            borderRadius: 4,
                            width: `${pct}%`,
                            background:
                              "linear-gradient(to right, var(--v2-accent), var(--v2-accent-dim))",
                            transition: "width 0.6s ease",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </GlassCard>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
