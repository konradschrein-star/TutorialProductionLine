"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createChannel } from "@/app/actions/channels";

export default function V2ChannelCreatePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [youtubeChannelId, setYoutubeChannelId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Name is required";
    if (!youtubeChannelId.trim()) {
      next.ytid = "YouTube Channel ID is required";
    } else if (!/^UC[a-zA-Z0-9_-]{22}$/.test(youtubeChannelId)) {
      next.ytid = "Must start with UC and be 24 characters total";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    const result = await createChannel({
      name,
      youtube_channel_id: youtubeChannelId,
    });
    if (result.success) {
      router.push("/channels");
    } else {
      setErrors({ form: result.error || "Failed to create channel" });
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        maxWidth: 560,
      }}
    >
      {/* Back */}
      <Link
        href="/channels"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "rgba(205,195,215,0.5)",
          textDecoration: "none",
          width: "fit-content",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          arrow_back
        </span>
        Channels
      </Link>

      {/* Header */}
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
          Add Channel
        </h1>
        <p style={{ fontSize: 12, color: "#cdc3d7", margin: 0 }}>
          Register a new YouTube channel
        </p>
      </div>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 20 }}
      >
        {/* Name */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#cdc3d7",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Channel Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My YouTube Channel"
            style={{
              width: "100%",
              padding: "10px 14px",
              background: "#111",
              border: `1px solid ${errors.name ? "rgba(255,180,171,0.5)" : "rgba(75,68,85,0.4)"}`,
              borderRadius: 8,
              color: "#e5e2e1",
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {errors.name && (
            <span style={{ fontSize: 11, color: "#ffb4ab" }}>
              {errors.name}
            </span>
          )}
        </div>

        {/* YouTube Channel ID */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#cdc3d7",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            YouTube Channel ID
          </label>
          <input
            type="text"
            value={youtubeChannelId}
            onChange={(e) => setYoutubeChannelId(e.target.value)}
            placeholder="UC1234567890123456789012"
            style={{
              width: "100%",
              padding: "10px 14px",
              background: "#111",
              border: `1px solid ${errors.ytid ? "rgba(255,180,171,0.5)" : "rgba(75,68,85,0.4)"}`,
              borderRadius: 8,
              color: "#e5e2e1",
              fontSize: 13,
              fontFamily: "monospace",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {errors.ytid ? (
            <span style={{ fontSize: 11, color: "#ffb4ab" }}>
              {errors.ytid}
            </span>
          ) : (
            <span style={{ fontSize: 10, color: "rgba(205,195,215,0.4)" }}>
              Found on your YouTube channel page URL (starts with UC, 24 chars)
            </span>
          )}
        </div>

        {errors.form && (
          <span style={{ fontSize: 12, color: "#ffb4ab" }}>{errors.form}</span>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
          <button
            type="submit"
            disabled={loading}
            className="v2-btn-accent"
            style={{ opacity: loading ? 0.6 : 1 }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              add
            </span>
            {loading ? "Creating…" : "Create Channel"}
          </button>
          <Link href="/channels" className="v2-btn">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
