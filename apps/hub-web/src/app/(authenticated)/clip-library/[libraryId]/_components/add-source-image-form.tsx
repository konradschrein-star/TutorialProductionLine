"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  libraryId: string;
}

type SourceKind = "stock" | "upload" | "other" | "movie" | "series";

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
  { value: "stock", label: "Stock (Pexels)", hint: "By Pexels photo id" },
  { value: "upload", label: "Upload", hint: "URL or local file path" },
  { value: "movie", label: "Movie still", hint: "Promo / press image" },
  { value: "series", label: "Series still", hint: "Season + episode" },
  { value: "other", label: "Other", hint: "Custom slug + id" },
];

export function AddSourceImageForm({ libraryId }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [sourceKind, setSourceKind] = useState<SourceKind>("stock");
  const [workSlug, setWorkSlug] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [season, setSeason] = useState("");
  const [episode, setEpisode] = useState("");
  const [externalProvider, setExternalProvider] = useState("pexels");
  const [externalId, setExternalId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFilePath, setSourceFilePath] = useState("");
  const [locationMode, setLocationMode] = useState<"url" | "file">("url");

  function resetFields() {
    setWorkSlug("");
    setWorkTitle("");
    setSeason("");
    setEpisode("");
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

      switch (sourceKind) {
        case "stock":
          if (!externalProvider.trim() || !externalId.trim()) {
            throw new Error("Stock requires provider and external_id");
          }
          body.external_provider = externalProvider.trim();
          body.external_id = externalId.trim();
          if (workTitle.trim()) body.work_title = workTitle.trim();
          // Pexels can resolve URL from id; URL+path optional.
          if (sourceUrl.trim()) body.source_url = sourceUrl.trim();
          if (sourceFilePath.trim())
            body.source_file_path = sourceFilePath.trim();
          break;
        case "movie":
          if (!workSlug.trim() || !workTitle.trim() || !externalId.trim()) {
            throw new Error(
              "Movie still requires work_slug, work_title, and external_id",
            );
          }
          body.work_slug = toSlug(workSlug);
          body.work_title = workTitle.trim();
          body.external_id = externalId.trim();
          break;
        case "series":
          if (
            !workSlug.trim() ||
            !workTitle.trim() ||
            !season.trim() ||
            !episode.trim() ||
            !externalId.trim()
          ) {
            throw new Error(
              "Series still requires work_slug, work_title, season, episode, external_id",
            );
          }
          body.work_slug = toSlug(workSlug);
          body.work_title = workTitle.trim();
          body.season = Number(season);
          body.episode = Number(episode);
          body.external_id = externalId.trim();
          break;
        case "upload":
        case "other":
          if (!workSlug.trim() || !externalId.trim()) {
            throw new Error(`${sourceKind} requires work_slug and external_id`);
          }
          body.work_slug = toSlug(workSlug);
          body.external_id = externalId.trim();
          if (workTitle.trim()) body.work_title = workTitle.trim();
          break;
      }

      // All kinds except stock need a location (URL or path).
      if (sourceKind !== "stock") {
        if (locationMode === "url") {
          if (!sourceUrl.trim()) throw new Error("URL is required");
          body.source_url = sourceUrl.trim();
        } else {
          if (!sourceFilePath.trim()) throw new Error("File path is required");
          body.source_file_path = sourceFilePath.trim();
        }
      }

      const res = await fetch("/api/clip-library/source-images", {
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
      setError(err instanceof Error ? err.message : "Failed to add image");
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

  const needsLocation = sourceKind !== "stock";

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
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
              value={externalProvider}
              onChange={(e) => setExternalProvider(e.target.value)}
              placeholder="pexels"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>External id (Pexels photo id)</label>
            <input
              type="text"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="12345"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Title (optional)</label>
            <input
              type="text"
              value={workTitle}
              onChange={(e) => setWorkTitle(e.target.value)}
              placeholder="Display title…"
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {sourceKind === "movie" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 2fr 2fr",
            gap: 10,
          }}
        >
          <div>
            <label style={labelStyle}>Work title</label>
            <input
              type="text"
              value={workTitle}
              onChange={(e) => {
                setWorkTitle(e.target.value);
                if (!workSlug.trim()) setWorkSlug(toSlug(e.target.value));
              }}
              placeholder="Harry Potter Sorcerer's Stone"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Slug</label>
            <input
              type="text"
              value={workSlug}
              onChange={(e) => setWorkSlug(e.target.value)}
              placeholder="harry-potter-sorcerers-stone"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>External id</label>
            <input
              type="text"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="promo-still-001"
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {sourceKind === "series" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 2fr 1fr 1fr 1fr",
            gap: 10,
          }}
        >
          <div>
            <label style={labelStyle}>Work title</label>
            <input
              type="text"
              value={workTitle}
              onChange={(e) => {
                setWorkTitle(e.target.value);
                if (!workSlug.trim()) setWorkSlug(toSlug(e.target.value));
              }}
              placeholder="The Clone Wars"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Slug</label>
            <input
              type="text"
              value={workSlug}
              onChange={(e) => setWorkSlug(e.target.value)}
              placeholder="the-clone-wars"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Season</label>
            <input
              type="number"
              min={0}
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="3"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Episode</label>
            <input
              type="number"
              min={1}
              value={episode}
              onChange={(e) => setEpisode(e.target.value)}
              placeholder="12"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>External id</label>
            <input
              type="text"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="frame-0001"
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
              value={workTitle}
              onChange={(e) => {
                setWorkTitle(e.target.value);
                if (!workSlug.trim()) setWorkSlug(toSlug(e.target.value));
              }}
              placeholder="My Image"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Slug</label>
            <input
              type="text"
              value={workSlug}
              onChange={(e) => setWorkSlug(e.target.value)}
              placeholder="my-image"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>External id</label>
            <input
              type="text"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="batch-001"
              style={inputStyle}
            />
          </div>
        </div>
      )}

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
              placeholder="https://…  (any direct image URL)"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              style={inputStyle}
            />
          ) : (
            <input
              type="text"
              placeholder="/opt/content-forge/media/image.jpg"
              value={sourceFilePath}
              onChange={(e) => setSourceFilePath(e.target.value)}
              style={inputStyle}
            />
          )}
        </div>
      )}

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
            {submitting ? "hourglass_empty" : "add_photo_alternate"}
          </span>
          {submitting ? "Adding…" : "Add source image"}
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
          Image added — ingest job dispatched
        </p>
      )}
    </form>
  );
}
