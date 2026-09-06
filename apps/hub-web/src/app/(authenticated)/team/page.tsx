import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../_lib/v2-auth";
import { GlassCard } from "../_components/glass-card";
import { hasPermission } from "@/lib/auth/rbac";
import { listUsersWithStats } from "@/lib/repositories/team-repository";

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  ADMIN: { bg: "rgba(var(--v2-accent-rgb), 0.15)", color: "var(--v2-accent)" },
  PRODUCTION_VA: { bg: "rgba(249,115,22,0.12)", color: "#f97316" },
  UPLOADER_VA: { bg: "rgba(35,222,203,0.12)", color: "#23decb" },
  VIEWER: { bg: "rgba(75,68,85,0.25)", color: "#a79db3" },
};

function getRoleStyle(role: string) {
  return ROLE_COLORS[role] ?? { bg: "rgba(75,68,85,0.25)", color: "#cdc3d7" };
}

function getUserInitial(name: string, email: string): string {
  if (name && name.trim()) return name.trim()[0].toUpperCase();
  if (email && email.trim()) return email.trim()[0].toUpperCase();
  return "?";
}

function humanOnlineTime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export default async function V2TeamPage() {
  const session = await getSession();

  if (!hasPermission(session, "view:team")) {
    redirect("/dashboard");
  }

  const canEditUsers = hasPermission(session, "edit:user");
  const users = await listUsersWithStats();

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
            Accounts
          </h1>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
            {users.length} account{users.length !== 1 ? "s" : ""} · admins, VAs
            and viewers. Production metrics live on the{" "}
            <a
              href="/dashboard"
              style={{ color: "var(--v2-accent)", textDecoration: "none" }}
            >
              Dashboard
            </a>
            .
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
              "minmax(220px,2fr) 120px 80px 80px 70px 70px 80px 100px" + (canEditUsers ? " 90px" : ""),
            gap: 0,
            padding: "10px 24px",
            borderBottom: "1px solid rgba(75,68,85,0.2)",
            background: "rgba(19,19,19,0.5)",
          }}
        >
          {["Member", "Role", "Account", "Live", "Done", "Active", "Working", "Time online"].map(
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
                  "minmax(220px,2fr) 120px 80px 80px 70px 70px 80px 100px" +
                  (canEditUsers ? " 90px" : ""),
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

              {/* Live presence is separate from whether the account is enabled. */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: user.is_online ? "#4ade80" : "#4b4455", boxShadow: user.is_online ? "0 0 7px rgba(74,222,128,.65)" : "none" }} />
                <span style={{ fontSize: 10, color: user.is_online ? "#4ade80" : "rgba(205,195,215,.45)" }}>
                  {user.is_online ? "Online" : "Offline"}
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

              <span style={{ fontSize: 12, color: user.jobs_working_now > 0 ? "#facc15" : "rgba(205,195,215,.55)", fontWeight: 700 }}>
                {user.jobs_working_now}
              </span>

              {/* Accumulated foreground session time */}
              <span style={{ fontSize: 12, color: "rgba(205,195,215,0.6)" }}>
                {humanOnlineTime(user.online_seconds_total)}
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
    </div>
  );
}
