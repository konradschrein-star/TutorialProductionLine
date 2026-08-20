"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  libraryId: string;
}

type SourceKind = "movie" | "series" | "youtube" | "stock" | "upload" | "other";

// Slug helper — exposed so users see what they're about to commit to.
function toSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

const KIND_OPTIONS: { value: SourceKind; label: string; hint: string }[] = [
  { value: "movie", label: "Movie", hint: "Single film, optional multi-disc" },
  { value: "series", label: "Series", hint: "Season + episode" },
  { value: "youtube", label: "YouTube", hint: "URL or video id" },
  { value: "stock", label: "Stock", hint: "Pexels / Pixabay / Storyblocks" },
  { value: "upload", label: "Upload", hint: "Custom slug + id" },
  { value: "other", label: "Other", hint: "Catch-all" },
];

export function AddSourceVideoForm({ libraryId }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [sourceKind, setSourceKind] = useState<SourceKind>("movie");
  const [workSlug, setWorkSlug] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [workPart, setWorkPart] = useState("");
  const [season, setSeason] = useState("");
  const [episode, setEpisode] = useState("");
  const [youtubeRef, setYoutubeRef] = useState(""); // URL or bare id
  const [externalProvider, setExternalProvider] = useState("pexels");
  const [externalId, setExternalId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFilePath, setSourceFilePath] = useState("");
  const [locationMode, setLocationMode] = useState<"url" | "file">("url");

  function resetFields() {
    setWorkSlug("");
    setWorkTitle("");
    setWorkPart("");
    setSeason("");
    setEpisode("");
    setYoutubeRef("");
    setExternalId("");
    setSourceUrl("");
    setSourceFilePath("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        library_id: libraryId,
        source_kind: sourceKind,
      };

      // Per-kind required fields.
      switch (sourceKind) {
        case "movie": {
          if (!workSlug.trim() || !workTitle.trim()) {
            throw new Error("Movie requires work_slug and work_title");
          }
          body.work_slug = toSlug(workSlug);
          body.work_title = workTitle.trim();
          if (workPart.trim()) body.work_part = Number(workPart);
          break;
        }
        case "series": {
          if (!workSlug.trim() || !workTitle.trim()) {
            throw new Error("Series requires work_slug and work_title");
          }
          if (!season.trim() || !episode.trim()) {
            throw new Error("Series requires season and episode");
          }
          body.work_slug = toSlug(workSlug);
          body.work_title = workTitle.trim();
          body.season = Number(season);
          body.episode = Number(episode);
          break;
        }
        case "youtube": {
          if (!youtubeRef.trim()) {
            throw new Error("YouTube requires URL or video id");
          }
          // Server parses URL → id automatically; pass whichever shape we got.
          if (/^https?:\/\//i.test(youtubeRef.trim())) {
            body.source_url = youtubeRef.trim();
          } else {
            body.youtube_id = youtubeRef.trim();
          }
          if (workTitle.trim()) body.work_title = workTitle.trim();
          break;
        }
        case "stock": {
          if (!externalProvider.trim() || !externalId.trim()) {
            throw new Error("Stock requires provider and external_id");
          }
          body.external_provider = externalProvider.trim();
          body.external_id = externalId.trim();
          if (workTitle.trim()) body.work_title = workTitle.trim();
          break;
        }
        case "upload":
        case "other": {
          if (!workSlug.trim() || !externalId.trim()) {
            throw new Error(`${sourceKind} requires work_slug and external_id`);
          }
          body.work_slug = toSlug(workSlug);
          body.external_id = externalId.trim();
          if (workTitle.trim()) body.work_title = workTitle.trim();
          break;
        }
      }

      // Source location (URL or file) for every kind except youtube where
      // it can be inferred from youtube_id.
      if (sourceKind !== "youtube") {
        if (locationMode === "url") {
          if (!sourceUrl.trim()) {
            throw new Error("URL is required");
          }
          body.source_url = sourceUrl.trim();
        } else {
          if (!sourceFilePath.trim()) {
            throw new Error("File path is required");
          }
          body.source_file_path = sourceFilePath.trim();
        }
      }

      const res = await fetch("/api/clip-library/source-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        const details = data.details
          ? ` (${JSON.stringify(data.details)})`
          : "";
        throw new Error(`${data.error ?? `HTTP ${res.status}`}${details}`);
      }

      setSuccess(true);
      resetFields();
      router.refresh();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add video");
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 6,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
    color: "#e5e2e1",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 10,
    fontWeight: 700,
    color: "rgba(205,195,215,0.5)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 6,
  };

  const needsLocation = sourceKind !== "youtube";

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      {/* Source kind selector */}
      <div>
        <label style={labelStyle}>Source kind</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {KIND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setSourceKind(opt.value);
                resetFields();
              }}
              title={opt.hint}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: "pointer",
                border: "none",
                background:
                  sourceKind === opt.value
                    ? "rgba(var(--v2-accent-rgb),0.15)"
                    : "rgba(255,255,255,0.05)",
                color:
                  sourceKind === opt.value
                    ? "var(--v2-accent)"
                    : "rgba(205,195,215,0.6)",
                outline:
                  sourceKind === opt.value
                    ? "1px solid rgba(var(--v2-accent-rgb),0.3)"
                    : "none",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Per-kind identity fields */}
      {sourceKind === "movie" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 2fr 1fr",
            gap: 10,
          }}
        >
          <div>
            <label style={labelStyle}>Work title</label>
            <input
              type="text"
              placeholder="Star Wars Episode IV"
              value={workTitle}
              onChange={(e) => {
                setWorkTitle(e.target.value);
                if (!workSlug.trim()) setWorkSlug(toSlug(e.target.value));
              }}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Slug (kebab-case)</label>
            <input
              type="text"
              placeholder="star-wars-episode-iv"
              value={workSlug}
              onChange={(e) => setWorkSlug(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Part (optional)</label>
            <input
              type="number"
              min={1}
              placeholder="1"
              value={workPart}
              onChange={(e) => setWorkPart(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {sourceKind === "series" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 2fr 1fr 1fr",
            gap: 10,
          }}
        >
          <div>
            <label style={labelStyle}>Work title</label>
            <input
              type="text"
              placeholder="The Clone Wars"
              value={workTitle}
              onChange={(e) => {
                setWorkTitle(e.target.value);
                if (!workSlug.trim()) setWorkSlug(toSlug(e.target.value));
              }}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Slug</label>
            <input
              type="text"
              placeholder="the-clone-wars"
              value={workSlug}
              onChange={(e) => setWorkSlug(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Season</label>
            <input
              type="number"
              min={0}
              placeholder="3"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Episode</label>
            <input
              type="number"
              min={1}
              placeholder="12"
              value={episode}
              onChange={(e) => setEpisode(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {sourceKind === "youtube" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gap: 10,
          }}
        >
          <div>
            <label style={labelStyle}>URL or video id</label>
            <input
              type="text"
              placeholder="https://www.youtube.com/watch?v=…  or  dQw4w9WgXcQ"
              value={youtubeRef}
              onChange={(e) => setYoutubeRef(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Title (optional)</label>
            <input
              type="text"
              placeholder="Video title…"
              value={workTitle}
              onChange={(e) => setWorkTitle(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {sourceKind === "stock" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr 2fr",
            gap: 10,
          }}
        >
          <div>
            <label style={labelStyle}>Provider</label>
            <input
              type="text"
              placeholder="pexels"
              value={externalProvider}
              onChange={(e) => setExternalProvider(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>External id</label>
            <input
              type="text"
              placeholder="12345-fire-burning"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Title (optional)</label>
            <input
              type="text"
              placeholder="Display title…"
              value={workTitle}
              onChange={(e) => setWorkTitle(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {(sourceKind === "upload" || sourceKind === "other") && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 2fr 2fr",
            gap: 10,
          }}
        >
          <div>
            <label style={labelStyle}>Title</label>
            <input
              type="text"
              placeholder="My Video"
              value={workTitle}
              onChange={(e) => {
                setWorkTitle(e.target.value);
                if (!workSlug.trim()) setWorkSlug(toSlug(e.target.value));
              }}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Slug</label>
            <input
              type="text"
              placeholder="my-video"
              value={workSlug}
              onChange={(e) => setWorkSlug(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>External id</label>
            <input
              type="text"
              placeholder="batch-001"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {/* Source location (URL or file path) — youtube can skip */}
      {needsLocation && (
        <div>
          <label style={labelStyle}>Source location</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {(["url", "file"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setLocationMode(m)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 5,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  cursor: "pointer",
                  border: "none",
                  background:
                    locationMode === m
                      ? "rgba(var(--v2-accent-rgb),0.15)"
                      : "rgba(255,255,255,0.05)",
                  color:
                    locationMode === m
                      ? "var(--v2-accent)"
                      : "rgba(205,195,215,0.5)",
                  outline:
                    locationMode === m
                      ? "1px solid rgba(var(--v2-accent-rgb),0.3)"
                      : "none",
                }}
              >
                {m === "url" ? "URL" : "File path"}
              </button>
            ))}
          </div>
          {locationMode === "url" ? (
            <input
              type="url"
              placeholder="https://… or any direct video URL"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              style={inputStyle}
            />
          ) : (
            <input
              type="text"
              placeholder="/opt/content-forge/media/video.mp4"
              value={sourceFilePath}
              onChange={(e) => setSourceFilePath(e.target.value)}
              style={inputStyle}
            />
          )}
        </div>
      )}

      {/* Submit */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: "9px 18px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            cursor: submitting ? "not-allowed" : "pointer",
            border: "none",
            background: submitting
              ? "rgba(var(--v2-accent-rgb),0.4)"
              : "var(--v2-accent)",
            color: "#000",
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            {submitting ? "hourglass_empty" : "add"}
          </span>
          {submitting ? "Adding…" : "Add source video"}
        </button>
      </div>

      {error && (
        <p
          style={{
            color: "#ff5050",
            fontSize: 12,
            margin: 0,
            padding: "8px 12px",
            background: "rgba(255,80,80,0.08)",
            borderRadius: 6,
            border: "1px solid rgba(255,80,80,0.2)",
          }}
        >
          {error}
        </p>
      )}

      {success && (
        <p
          style={{
            color: "#00dc82",
            fontSize: 12,
            margin: 0,
            padding: "8px 12px",
            background: "rgba(0,220,130,0.08)",
            borderRadius: 6,
            border: "1px solid rgba(0,220,130,0.2)",
          }}
        >
          Video added — ingest job dispatched
        </p>
      )}
    </form>
  );
}
