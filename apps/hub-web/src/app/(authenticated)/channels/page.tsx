import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../_lib/v2-auth";
import { GlassCard } from "../_components/glass-card";
import { hasPermission } from "@/lib/auth/rbac";
import { listChannels } from "@/lib/repositories/channel-repository";
import { ChannelDeleteButton } from "@/components/channels/channel-delete-button";

export default async function V2ChannelsPage() {
  const session = await getSession();

  if (!hasPermission(session, "view:channels")) {
    redirect("/dashboard");
  }

  const canManage = hasPermission(session, "manage:channels");
  const channels = await listChannels();

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
            Channels
          </h1>
          <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
            {channels.length} channel{channels.length !== 1 ? "s" : ""}{" "}
            configured
          </p>
        </div>

        {canManage && (
          <Link
            href="/channels/create"
            className="v2-btn-accent"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              add
            </span>
            Add Channel
          </Link>
        )}
      </div>

      {/* Table */}
      <GlassCard style={{ overflow: "hidden" }}>
        {/* Table header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `2fr 2fr 80px${canManage ? " 120px" : ""}`,
            padding: "10px 24px",
            background: "#131313",
            borderBottom: "1px solid rgba(var(--v2-accent-rgb), 0.10)",
          }}
        >
          {["Channel", "YouTube ID", "Jobs", canManage ? "Actions" : null]
            .filter(Boolean)
            .map((h) => (
              <span
                key={h as string}
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
            ))}
        </div>

        {/* Rows */}
        {channels.length === 0 ? (
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              color: "rgba(205,195,215,0.4)",
              fontSize: 12,
            }}
          >
            No channels found.
            {canManage && (
              <div style={{ marginTop: 12 }}>
                <Link
                  href="/channels/create"
                  style={{
                    fontSize: 12,
                    color: "var(--v2-accent)",
                    textDecoration: "none",
                  }}
                >
                  Add your first channel →
                </Link>
              </div>
            )}
          </div>
        ) : (
          channels.map((channel, i) => (
            <div
              key={channel.id}
              style={{
                display: "grid",
                gridTemplateColumns: `2fr 2fr 80px${canManage ? " 120px" : ""}`,
                padding: "14px 24px",
                alignItems: "center",
                borderBottom:
                  i < channels.length - 1
                    ? "1px solid rgba(75,68,85,0.1)"
                    : "none",
              }}
            >
              {/* Name */}
              <span style={{ fontSize: 12, fontWeight: 600, color: "#e5e2e1" }}>
                {channel.name}
              </span>

              {/* YouTube ID */}
              <span
                style={{
                  fontSize: 11,
                  color: "rgba(205,195,215,0.5)",
                  fontFamily: channel.youtube_channel_id.startsWith("pending-")
                    ? "inherit"
                    : "monospace",
                  fontStyle: channel.youtube_channel_id.startsWith("pending-")
                    ? "italic"
                    : "normal",
                }}
              >
                {channel.youtube_channel_id.startsWith("pending-")
                  ? "Not linked"
                  : channel.youtube_channel_id}
              </span>

              {/* Job count */}
              <span style={{ fontSize: 12, color: "#e5e2e1", fontWeight: 600 }}>
                {channel.job_count}
              </span>

              {/* Actions */}
              {canManage && (
                <div style={{ display: "flex", gap: 8 }}>
                  <Link
                    href={`/channels/${channel.id}`}
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
                  <ChannelDeleteButton
                    channelId={channel.id}
                    channelName={channel.name}
                    jobCount={channel.job_count}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </GlassCard>
    </div>
  );
}
