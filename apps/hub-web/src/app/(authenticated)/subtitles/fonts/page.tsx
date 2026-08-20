"use client";
import Link from "next/link";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GlassCard } from "../../_components/glass-card";
import {
  buildFontFaceCss,
  invalidateSubtitleFontCache,
  type SubtitleFontRow,
} from "@/components/subtitles/font-faces";

type Font = SubtitleFontRow;

const DEFAULT_PREVIEW = "The quick brown fox jumps";
// Kept in lockstep with ALLOWED_FORMATS in the POST handler — the renderer
// reads these files directly, so the server is the authority here.
const ALLOWED_EXT = ["ttf", "otf", "woff2"] as const;

/** Per-font CSS family alias so each card previews in its OWN font. */
function previewFamily(id: string): string {
  return `sf-preview-${id}`;
}

function extOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Family name a locally-selected (not yet uploaded) file previews under. */
const STAGED_FAMILY = "sf-staged-upload";

export default function FontsPage() {
  const [fonts, setFonts] = useState<Font[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [stagedUrl, setStagedUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/subtitle-fonts");
      if (!r.ok) throw new Error(`Font list failed (${r.status})`);
      const rows = await r.json();
      if (!Array.isArray(rows))
        throw new Error("Font list: unexpected payload");
      setFonts(rows);
      setListError(null);
    } catch (e) {
      setFonts([]);
      setListError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Registered @font-face for every stored font, per weight, so both the big
  // sample line and the weight chips render in the real typeface.
  const fontFaceCss = useMemo(() => {
    const aliased = fonts.map((f) => ({ ...f, name: previewFamily(f.id) }));
    // buildFontFaceCss also declares the real family/display names, which the
    // caption previews elsewhere rely on; here we only need the per-card alias.
    return buildFontFaceCss(
      aliased.map((f) => ({ ...f, family: previewFamily(f.id) })),
    );
  }, [fonts]);

  // Instant local preview of a picked file (before upload) via a blob URL.
  const stagedCss = stagedUrl
    ? `@font-face{font-family:'${STAGED_FAMILY}';src:url('${stagedUrl}');font-display:swap;}`
    : "";

  const selectFile = useCallback(
    (picked: File | null) => {
      setError(null);
      if (stagedUrl) URL.revokeObjectURL(stagedUrl);
      if (!picked) {
        setFile(null);
        setStagedUrl(null);
        return;
      }
      const ext = extOf(picked.name);
      if (!ALLOWED_EXT.includes(ext as (typeof ALLOWED_EXT)[number])) {
        setFile(null);
        setStagedUrl(null);
        setError(
          `"${picked.name}" is a .${ext || "?"} file. Only ${ALLOWED_EXT.join(", ").toUpperCase()} are supported.`,
        );
        return;
      }
      setFile(picked);
      setStagedUrl(URL.createObjectURL(picked));
      // Pre-fill the name from the filename if the user hasn't typed one.
      setName((n) =>
        n.trim()
          ? n
          : picked.name
              .replace(/\.[^.]+$/, "")
              .replace(/[-_]+/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
      );
    },
    [stagedUrl],
  );

  // Revoke the blob URL on unmount.
  useEffect(() => {
    return () => {
      if (stagedUrl) URL.revokeObjectURL(stagedUrl);
    };
  }, [stagedUrl]);

  const upload = async () => {
    if (!file) {
      setError("Pick a font file first.");
      return;
    }
    if (!name.trim()) {
      setError("Give the font a name — it is what presets refer to.");
      return;
    }
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name.trim());
    const res = await fetch("/api/v1/subtitle-fonts", {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Upload failed (${res.status})`);
      setUploading(false);
      return;
    }
    setName("");
    selectFile(null);
    if (fileRef.current) fileRef.current.value = "";
    invalidateSubtitleFontCache();
    await load();
    setUploading(false);
  };

  const deleteFont = async (id: string) => {
    const res = await fetch(`/api/v1/subtitle-fonts/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Delete failed (${res.status})`);
      return;
    }
    invalidateSubtitleFontCache();
    await load();
  };

  const builtins = fonts.filter((f) => f.is_builtin);
  const uploads = fonts.filter((f) => !f.is_builtin);

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <style dangerouslySetInnerHTML={{ __html: fontFaceCss }} />
      {stagedCss && <style dangerouslySetInnerHTML={{ __html: stagedCss }} />}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <Link
          href="/subtitles"
          style={{ color: "var(--v2-accent)", fontSize: 13 }}
        >
          ← Back to Presets
        </Link>
        <h1
          style={{ fontSize: 22, fontWeight: 700, color: "#e5e2e1", margin: 0 }}
        >
          Subtitle Fonts
        </h1>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Upload                                                            */}
      {/* ---------------------------------------------------------------- */}
      <GlassCard style={{ padding: 20, marginBottom: 24 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#e5e2e1",
            margin: "0 0 14px",
          }}
        >
          Add a font
        </h3>

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            selectFile(e.dataTransfer.files?.[0] ?? null);
          }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
          }}
          style={{
            border: `1.5px dashed ${
              dragging
                ? "var(--v2-accent)"
                : file
                  ? "rgba(var(--v2-accent-rgb),0.45)"
                  : "rgba(var(--v2-accent-rgb),0.25)"
            }`,
            background: dragging
              ? "rgba(var(--v2-accent-rgb),0.10)"
              : "rgba(255,255,255,0.03)",
            borderRadius: 12,
            padding: file ? 16 : 28,
            textAlign: "center",
            cursor: "pointer",
            transition: "all 0.15s",
            outline: "none",
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".ttf,.otf,.woff2"
            onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
            style={{ display: "none" }}
          />

          {file ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 20, color: "var(--v2-accent)" }}
                >
                  font_download
                </span>
                <span
                  style={{ fontSize: 13, color: "#e5e2e1", fontWeight: 600 }}
                >
                  {file.name}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    background: "rgba(255,255,255,0.06)",
                    color: "#cdc3d7",
                    padding: "2px 8px",
                    borderRadius: 20,
                    textTransform: "uppercase",
                  }}
                >
                  {extOf(file.name)}
                </span>
                <span style={{ fontSize: 11, color: "#8a8594" }}>
                  {humanSize(file.size)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    selectFile(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  title="Remove"
                  style={{
                    background: "none",
                    border: "none",
                    color: "#f87171",
                    cursor: "pointer",
                    display: "inline-flex",
                    padding: 2,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    close
                  </span>
                </button>
              </div>

              {/* Instant local preview of the picked face. */}
              <div
                style={{
                  fontFamily: `'${STAGED_FAMILY}', sans-serif`,
                  fontSize: 30,
                  color: "#e5e2e1",
                  lineHeight: 1.25,
                  padding: "6px 0",
                }}
              >
                {DEFAULT_PREVIEW}
              </div>
              <div style={{ fontSize: 10, color: "#8a8594" }}>
                Live preview of the selected file — click to choose a different
                one
              </div>
            </div>
          ) : (
            <>
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 30,
                  color: "var(--v2-accent)",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                upload_file
              </span>
              <div style={{ fontSize: 14, color: "#e5e2e1", fontWeight: 600 }}>
                Drop a font file here, or click to browse
              </div>
              <div style={{ fontSize: 11, color: "#8a8594", marginTop: 4 }}>
                TTF · OTF · WOFF2
              </div>
            </>
          )}
        </div>

        {/* Name + submit */}
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-end",
            marginTop: 14,
          }}
        >
          <div style={{ flex: 1 }}>
            <label
              style={{
                fontSize: 12,
                color: "#cdc3d7",
                display: "block",
                marginBottom: 4,
              }}
            >
              Name (what presets will refer to)
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Montserrat Bold"
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                borderRadius: 6,
                color: "#e5e2e1",
                padding: "8px 10px",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            onClick={upload}
            disabled={uploading || !file || !name.trim()}
            style={{
              padding: "9px 22px",
              borderRadius: 8,
              border: "none",
              background:
                uploading || !file || !name.trim()
                  ? "rgba(255,255,255,0.08)"
                  : "var(--v2-accent)",
              color: uploading || !file || !name.trim() ? "#8a8594" : "#fff",
              cursor:
                uploading || !file || !name.trim() ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {uploading ? "Uploading..." : "Add font"}
          </button>
        </div>

        <p style={{ fontSize: 11, color: "#8a8594", margin: "10px 0 0" }}>
          The real family name and available weights are read from the file
          automatically. Uploaded fonts are immediately selectable in the preset
          editor and used by the renderer.
        </p>
        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 6,
              background: "rgba(248,113,113,0.10)",
              border: "1px solid rgba(248,113,113,0.35)",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16, color: "#f87171" }}
            >
              error
            </span>
            <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>
          </div>
        )}
      </GlassCard>

      {listError && (
        <GlassCard
          style={{
            padding: 16,
            marginBottom: 20,
            border: "1px solid rgba(248,113,113,0.35)",
          }}
        >
          <span style={{ fontSize: 13, color: "#f87171" }}>
            Could not load the font list: {listError}
          </span>
        </GlassCard>
      )}

      {builtins.length > 0 && (
        <SectionLabel>Built-in ({builtins.length})</SectionLabel>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: 24,
        }}
      >
        {builtins.map((font) => (
          <FontRow key={font.id} font={font} />
        ))}
      </div>

      <SectionLabel>Uploaded ({uploads.length})</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {uploads.map((font) => (
          <FontRow key={font.id} font={font} onDelete={deleteFont} />
        ))}
        {uploads.length === 0 && !listError && (
          <GlassCard style={{ padding: 32, textAlign: "center" }}>
            <p style={{ color: "#cdc3d7", margin: 0 }}>
              No custom fonts uploaded yet.
            </p>
          </GlassCard>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: "#8a8594",
        margin: "0 0 10px",
      }}
    >
      {children}
    </div>
  );
}

function FontRow({
  font,
  onDelete,
}: {
  font: Font;
  onDelete?: (id: string) => void;
}) {
  const weights = Array.isArray(font.weights) ? font.weights : [];
  const [fileError, setFileError] = useState<string | null>(null);

  // Ask the browser to actually load the face. document.fonts.load resolves
  // with an EMPTY array when the @font-face src could not be fetched/parsed —
  // that is the only reliable way to tell "previewing in the real font" from
  // "silently previewing in the fallback", which is exactly the failure mode
  // that made this page look broken.
  useEffect(() => {
    let alive = true;
    const family = previewFamily(font.id);
    if (typeof document === "undefined" || !document.fonts) return;
    document.fonts
      .load(`1em '${family}'`)
      .then((faces) => {
        if (!alive) return;
        setFileError(
          faces.length === 0
            ? "the font file could not be loaded from the server"
            : null,
        );
      })
      .catch((e: unknown) => {
        if (alive) setFileError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [font.id]);

  return (
    <GlassCard
      style={{
        padding: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 6,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: "#e5e2e1" }}>
            {font.name}
          </span>
          {font.family && font.family !== font.name && (
            <span style={{ fontSize: 11, color: "#8a8594" }}>
              ({font.family})
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              background: font.is_builtin
                ? "rgba(120,180,255,0.12)"
                : "rgba(var(--v2-accent-rgb),0.1)",
              color: font.is_builtin ? "#78b4ff" : "var(--v2-accent)",
              padding: "2px 8px",
              borderRadius: 20,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            {font.is_builtin ? "Built-in" : "Upload"}
          </span>
          <span
            style={{
              fontSize: 10,
              background: "rgba(255,255,255,0.06)",
              color: "#cdc3d7",
              padding: "2px 8px",
              borderRadius: 20,
            }}
          >
            {(font.format || "").toUpperCase()}
          </span>
        </div>

        {/* Preview rendered in the font's own typeface. */}
        {fileError ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "#f87171",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              font_download_off
            </span>
            Cannot preview — {fileError}
          </div>
        ) : (
          <div
            style={{
              fontFamily: `'${previewFamily(font.id)}', sans-serif`,
              fontSize: 26,
              lineHeight: 1.2,
              color: "#e5e2e1",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {font.preview_text || DEFAULT_PREVIEW}
          </div>
        )}

        {/* Available weights, each rendered at its own weight. */}
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}
        >
          {weights.length === 0 ? (
            <span style={{ fontSize: 11, color: "#8a8594" }}>
              No weight metadata
            </span>
          ) : (
            weights
              .slice()
              .sort((a, b) => a.weight - b.weight)
              .map((wt) => (
                <span
                  key={wt.weight}
                  style={{
                    fontSize: 12,
                    fontFamily: fileError
                      ? undefined
                      : `'${previewFamily(font.id)}', sans-serif`,
                    fontWeight: wt.weight,
                    background: "rgba(255,255,255,0.05)",
                    color: "#cdc3d7",
                    padding: "2px 8px",
                    borderRadius: 6,
                    border: "1px solid rgba(var(--v2-accent-rgb),0.12)",
                  }}
                >
                  {wt.label} {wt.weight}
                </span>
              ))
          )}
        </div>
      </div>

      {onDelete && !font.is_builtin && (
        <button
          onClick={() => onDelete(font.id)}
          title="Delete font"
          style={{
            background: "none",
            border: "none",
            color: "#f87171",
            cursor: "pointer",
            padding: 4,
            alignSelf: "flex-start",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            delete
          </span>
        </button>
      )}
    </GlassCard>
  );
}
