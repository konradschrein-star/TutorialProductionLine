"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AUTOMATIC_TUTORIAL_LANGUAGE_CODES,
  isActiveTutorialUploadLanguage,
} from "@repo/contracts";
import { updateChannel } from "@/app/actions/channels";
import type { Channel } from "@/lib/repositories/channel-repository";

const CHANNEL_LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  de: "German",
  fr: "French",
  it: "Italian",
  sv: "Swedish",
  nl: "Dutch (archive only)",
};
const CHANNEL_LANGUAGES = [
  "en",
  ...AUTOMATIC_TUTORIAL_LANGUAGE_CODES,
  "nl",
].map((code) => ({
  code,
  name: CHANNEL_LANGUAGE_NAMES[code] ?? code.toUpperCase(),
}));

interface Props {
  channel: Channel;
}

export function V2ChannelEditForm({ channel }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(channel.name);
  const [youtubeChannelId, setYoutubeChannelId] = useState(
    channel.youtube_channel_id,
  );
  const [language, setLanguage] = useState(channel.language);
  const [uploaderChannelKey, setUploaderChannelKey] = useState(
    channel.uploader_channel_key ?? "",
  );
  const [isPrimary, setIsPrimary] = useState(channel.is_primary);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Name is required";
    // Accept either a canonical UC… id OR an @handle. The channels were seeded
    // with @handles (e.g. @slflggfsll5106), so a UC-only rule made every one of
    // them unsavable. A UC id can be linked later once known.
    if (!youtubeChannelId.trim()) {
      next.ytid = "YouTube channel ID or @handle is required";
    } else if (
      !/^UC[a-zA-Z0-9_-]{22}$/.test(youtubeChannelId) &&
      !/^@[a-zA-Z0-9._-]{2,}$/.test(youtubeChannelId) &&
      !youtubeChannelId.startsWith("pending-")
    ) {
      next.ytid = "Use a UC… channel ID (24 chars) or an @handle";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    const result = await updateChannel(channel.id, {
      name,
      youtube_channel_id: youtubeChannelId,
      language,
      is_primary: isPrimary,
      uploader_channel_key: isActiveTutorialUploadLanguage(language)
        ? uploaderChannelKey
        : null,
    });
    if (result.success) {
      router.push("/channels");
    } else {
      setErrors({ form: result.error || "Failed to update channel" });
      setLoading(false);
    }
  }

  const inputStyle = (hasError?: boolean): React.CSSProperties => ({
    width: "100%",
    padding: "10px 14px",
    background: "#111",
    border: `1px solid ${hasError ? "rgba(255,180,171,0.5)" : "rgba(75,68,85,0.4)"}`,
    borderRadius: 8,
    color: "#e5e2e1",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  });

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: "#cdc3d7",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={labelStyle}>Channel Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle(!!errors.name)}
        />
        {errors.name && (
          <span style={{ fontSize: 11, color: "#ffb4ab" }}>{errors.name}</span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={labelStyle}>YouTube Channel ID</label>
        <input
          type="text"
          value={youtubeChannelId}
          onChange={(e) => setYoutubeChannelId(e.target.value)}
          style={{ ...inputStyle(!!errors.ytid), fontFamily: "monospace" }}
        />
        {errors.ytid ? (
          <span style={{ fontSize: 11, color: "#ffb4ab" }}>{errors.ytid}</span>
        ) : (
          <span style={{ fontSize: 10, color: "rgba(205,195,215,0.4)" }}>
            Found on your YouTube channel page URL (starts with UC, 24 chars)
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={labelStyle}>Uploader Channel Key</label>
        <input
          type="text"
          value={uploaderChannelKey}
          onChange={(e) => setUploaderChannelKey(e.target.value)}
          disabled={!isActiveTutorialUploadLanguage(language)}
          style={{ ...inputStyle(false), fontFamily: "monospace" }}
          placeholder="tutorial_usa"
        />
        <span style={{ fontSize: 10, color: "rgba(205,195,215,0.55)" }}>
          {isActiveTutorialUploadLanguage(language)
            ? "Exact isolated-profile key configured in the uploader. Leave blank to block automated dispatch; it is never inferred."
            : "Archive-only languages cannot be mapped to automated uploads."}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={labelStyle}>Channel Language</label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          style={inputStyle(false)}
        >
          {CHANNEL_LANGUAGES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 10, color: "rgba(205,195,215,0.55)" }}>
          English is the source language; automatic translations use German,
          French, Italian, and Swedish.
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={labelStyle}>Origination</label>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            cursor: "pointer",
            padding: "10px 14px",
            background: "#111",
            border: "1px solid rgba(75,68,85,0.4)",
            borderRadius: 8,
          }}
        >
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span style={{ fontSize: 12, color: "#e5e2e1" }}>
            <strong>Primary channel</strong> — VAs can create original tutorials
            here on the Create tab.
            <br />
            <span style={{ color: "rgba(205,195,215,0.55)" }}>
              Leave off for translation-only channels (the language versions
              that only receive videos from the Localize tab).
            </span>
          </span>
        </label>
      </div>

      {errors.form && (
        <span style={{ fontSize: 12, color: "#ffb4ab" }}>{errors.form}</span>
      )}

      <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
        <button
          type="submit"
          disabled={loading}
          className="v2-btn-accent"
          style={{ opacity: loading ? 0.6 : 1 }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            save
          </span>
          {loading ? "Saving…" : "Save Changes"}
        </button>
        <Link href="/channels" className="v2-btn">
          Cancel
        </Link>
      </div>
    </form>
  );
}
