import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../_lib/v2-auth";
import { GlassCard } from "../_components/glass-card";
import { hasPermission } from "@/lib/auth/rbac";
import { listUsersWithStats } from "@/lib/repositories/team-repository";
import { VAProductivityChart } from "@/components/team/va-productivity-chart";
import { TeamKPIs } from "@/components/team/team-kpis";

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  ADMIN: { bg: "rgba(var(--v2-accent-rgb), 0.15)", color: "var(--v2-accent)" },
  MANAGER: {
    bg: "rgba(var(--v2-accent-rgb), 0.08)",
    color: "var(--v2-accent-secondary)",
  },
  PRODUCTION_VA: { bg: "rgba(249,115,22,0.12)", color: "#f97316" },
  UPLOADER_VA: { bg: "rgba(35,222,203,0.12)", color: "#23decb" },
  VIEWER: { bg: "rgba(75,68,85,0.25)", color: "#4b4455" },
};

function getRoleStyle(role: string) {
  return ROLE_COLORS[role] ?? { bg: "rgba(75,68,85,0.25)", color: "#cdc3d7" };
}

function getUserInitial(name: string, email: string): string {
  if (name && name.trim()) return name.trim()[0].toUpperCase();
  if (email && email.trim()) return email.trim()[0].toUpperCase();
  return "?";
}

export default async function V2TeamPage() {
  const session = await getSession();

  if (!hasPermission(session, "view:team")) {
    redirect("/dashboard");
  }

  const canEditUsers = hasPermission(session, "edit:user");
  const users = await listUsersWithStats();

  const productionVAs = users.filter((u) => u.role === "PRODUCTION_VA");
  const uploaderVAs = users.filter((u) => u.role === "UPLOADER_VA");

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
            Team
          </h1>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
            {users.length} team member{users.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Right side: Add User + role badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {canEditUsers && (
            <Link
              href="/team/create"
              className="v2-btn-accent"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                person_add
              </span>
              Add User
            </Link>
          )}

          {/* Current user role badge */}
          {(() => {
            const style = getRoleStyle(session.role);
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: "rgba(205,195,215,0.5)" }}>
                  Logged in as
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: style.color,
                    background: style.bg,
                    padding: "4px 12px",
                    borderRadius: 20,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  {session.role}
                </span>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Team Members Table */}
      <GlassCard style={{ overflow: "hidden" }}>
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
            background: "#131313",
          }}
        >
          <h3
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#e5e2e1",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: 0,
            }}
          >
            All Members
          </h3>
        </div>

        {/* Table header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "2fr 1fr 80px 80px 80px 80px" + (canEditUsers ? " 100px" : ""),
            gap: 0,
            padding: "10px 24px",
            borderBottom: "1px solid rgba(75,68,85,0.2)",
            background: "rgba(19,19,19,0.5)",
          }}
        >
          {["Member", "Role", "Status", "Done", "Active", "Avg Time"].map(
            (h) => (
              <span
                key={h}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#cdc3d7",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {h}
              </span>
            ),
          )}
          {canEditUsers && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#cdc3d7",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Actions
            </span>
          )}
        </div>

        {/* Rows */}
        {users.length === 0 && (
          <div
            style={{
              padding: "32px 24px",
              textAlign: "center",
              color: "rgba(205,195,215,0.4)",
              fontSize: 12,
            }}
          >
            No team members found.
          </div>
        )}
        {users.map((user, i) => {
          const roleStyle = getRoleStyle(user.role);
          const initial = getUserInitial(user.name, user.email);
          return (
            <div
              key={user.id}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "2fr 1fr 80px 80px 80px 80px" +
                  (canEditUsers ? " 100px" : ""),
                gap: 0,
                padding: "14px 24px",
                alignItems: "center",
                borderBottom:
                  i < users.length - 1
                    ? "1px solid rgba(75,68,85,0.1)"
                    : "none",
              }}
            >
              {/* Member */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {/* Avatar circle */}
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background:
                      "linear-gradient(135deg, var(--v2-accent), var(--v2-accent-dim))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 800,
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  {initial}
                </div>
                <div>
                  <div
                    style={{ fontSize: 12, fontWeight: 600, color: "#e5e2e1" }}
                  >
                    {user.name || "—"}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(205,195,215,0.5)" }}>
                    {user.email}
                  </div>
                </div>
              </div>

              {/* Role */}
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: roleStyle.color,
                  background: roleStyle.bg,
                  padding: "3px 8px",
                  borderRadius: 20,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  display: "inline-block",
                  whiteSpace: "nowrap",
                }}
              >
                {user.role.replace("_", " ")}
              </span>

              {/* Status dot */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: user.is_active ? "#23decb" : "#4b4455",
                    boxShadow: user.is_active
                      ? "0 0 6px rgba(35,222,203,0.5)"
                      : "none",
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    color: user.is_active ? "#23decb" : "rgba(205,195,215,0.4)",
                  }}
                >
                  {user.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              {/* Completed */}
              <span style={{ fontSize: 12, color: "#e5e2e1", fontWeight: 600 }}>
                {user.jobs_completed}
              </span>

              {/* In Progress */}
              <span style={{ fontSize: 12, color: "#e5e2e1", fontWeight: 600 }}>
                {user.jobs_in_progress}
              </span>

              {/* Avg Time */}
              <span style={{ fontSize: 12, color: "rgba(205,195,215,0.6)" }}>
                {user.avg_time_per_job_hours != null
                  ? `${user.avg_time_per_job_hours.toFixed(1)}h`
                  : "—"}
              </span>

              {/* Actions */}
              {canEditUsers && (
                <div style={{ display: "flex", gap: 8 }}>
                  <Link
                    href={`/team/${user.id}`}
                    className="v2-btn-outline"
                    style={{
                      padding: "4px 10px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 13 }}
                    >
                      edit
                    </span>
                    Edit
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </GlassCard>

      {/* VA Productivity Chart */}
      <GlassCard style={{ padding: 20 }}>
        <div
          style={{
            paddingBottom: 16,
            marginBottom: 20,
            borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          }}
        >
          <h3
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#e5e2e1",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: 0,
            }}
          >
            VA Productivity
          </h3>
        </div>
        <VAProductivityChart />
      </GlassCard>

      {/* More KPIs */}
      <GlassCard style={{ padding: 20 }}>
        <div
          style={{
            paddingBottom: 16,
            marginBottom: 20,
            borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
          }}
        >
          <h3
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#e5e2e1",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: 0,
            }}
          >
            Team Performance Metrics
          </h3>
        </div>
        <TeamKPIs />
      </GlassCard>

      {/* VA Productivity Section (Existing) */}
      {(productionVAs.length > 0 || uploaderVAs.length > 0) && (
        <div>
          <p
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#e5e2e1",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 16,
              marginTop: 0,
            }}
          >
            VA Quick Stats
          </p>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}
          >
            {/* Production VAs */}
            <GlassCard className="p-5">
              <h4
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#f97316",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  margin: 0,
                  marginBottom: 16,
                }}
              >
                Production VAs
              </h4>
              {productionVAs.length === 0 ? (
                <p
                  style={{
                    fontSize: 11,
                    color: "rgba(205,195,215,0.4)",
                    margin: 0,
                  }}
                >
                  No Production VAs
                </p>
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  {productionVAs.map((va) => (
                    <div
                      key={va.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "10px 14px",
                        background: "#0e0e0e",
                        borderRadius: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background:
                              "linear-gradient(135deg, var(--v2-accent), var(--v2-accent-dim))",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            fontWeight: 800,
                            color: "#fff",
                          }}
                        >
                          {getUserInitial(va.name, va.email)}
                        </div>
                        <span style={{ fontSize: 12, color: "#e5e2e1" }}>
                          {va.name || va.email}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 16,
                          fontSize: 10,
                          color: "rgba(205,195,215,0.5)",
                        }}
                      >
                        <span style={{ color: "#23decb", fontWeight: 700 }}>
                          {va.jobs_completed} done
                        </span>
                        <span>{va.jobs_in_progress} active</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>

            {/* Uploader VAs */}
            <GlassCard className="p-5">
              <h4
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#23decb",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  margin: 0,
                  marginBottom: 16,
                }}
              >
                Uploader VAs
              </h4>
              {uploaderVAs.length === 0 ? (
                <p
                  style={{
                    fontSize: 11,
                    color: "rgba(205,195,215,0.4)",
                    margin: 0,
                  }}
                >
                  No Uploader VAs
                </p>
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  {uploaderVAs.map((va) => (
                    <div
                      key={va.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "10px 14px",
                        background: "#0e0e0e",
                        borderRadius: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background:
                              "linear-gradient(135deg, var(--v2-accent), var(--v2-accent-dim))",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            fontWeight: 800,
                            color: "#fff",
                          }}
                        >
                          {getUserInitial(va.name, va.email)}
                        </div>
                        <span style={{ fontSize: 12, color: "#e5e2e1" }}>
                          {va.name || va.email}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 16,
                          fontSize: 10,
                          color: "rgba(205,195,215,0.5)",
                        }}
                      >
                        <span style={{ color: "#23decb", fontWeight: 700 }}>
                          {va.jobs_completed} done
                        </span>
                        <span>{va.jobs_in_progress} active</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>
        </div>
      )}
    </div>
  );
}
