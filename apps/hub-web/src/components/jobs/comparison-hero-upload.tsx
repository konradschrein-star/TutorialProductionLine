"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { V2Label, V2Text, V2Button } from "@/app/(authenticated)/_components";

interface ComparisonHeroUploadProps {
  jobId: string;
  channelId: string;
  productAName: string;
  productBName: string;
  productAHeroKey: string | null;
  productBHeroKey: string | null;
}

export function ComparisonHeroUpload({
  jobId,
  channelId,
  productAName,
  productBName,
  productAHeroKey,
  productBHeroKey,
}: ComparisonHeroUploadProps) {
  const router = useRouter();
  const fileInputARef = useRef<HTMLInputElement>(null);
  const fileInputBRef = useRef<HTMLInputElement>(null);

  const [uploadingA, setUploadingA] = useState(false);
  const [uploadingB, setUploadingB] = useState(false);
  const [draggingA, setDraggingA] = useState(false);
  const [draggingB, setDraggingB] = useState(false);
  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);

  async function uploadHeroImage(slot: "A" | "B", file: File) {
    const setUploading = slot === "A" ? setUploadingA : setUploadingB;
    const setError = slot === "A" ? setErrorA : setErrorB;

    setUploading(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("job_id", jobId);
      fd.append("channel_id", channelId);
      fd.append("slot", slot);
      fd.append("hero_image", file);

      const res = await fetch("/api/jobs/comparison-hero-upload", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `Upload failed (${res.status})`);
        return;
      }

      // Refresh to show updated hero image
      router.refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(slot: "A" | "B") {
    return (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (slot === "A") setDraggingA(false);
      else setDraggingB(false);

      if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith("image/")) {
          uploadHeroImage(slot, file);
        } else {
          const setError = slot === "A" ? setErrorA : setErrorB;
          setError("Please upload an image file (PNG, JPG, WebP)");
        }
      }
    };
  }

  function handleDragOver(slot: "A" | "B") {
    return (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (slot === "A") setDraggingA(true);
      else setDraggingB(true);
    };
  }

  function handleDragLeave(slot: "A" | "B") {
    return (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        if (slot === "A") setDraggingA(false);
        else setDraggingB(false);
      }
    };
  }

  function handleBrowse(slot: "A" | "B") {
    return () => {
      if (slot === "A") fileInputARef.current?.click();
      else fileInputBRef.current?.click();
    };
  }

  function handleFileInputChange(slot: "A" | "B") {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        uploadHeroImage(slot, e.target.files[0]);
      }
    };
  }

  function renderUploadZone(
    slot: "A" | "B",
    productName: string,
    heroKey: string | null,
    uploading: boolean,
    dragging: boolean,
    error: string | null,
    setError: (err: string | null) => void,
    fileInputRef: React.RefObject<HTMLInputElement>,
    color: { border: string; accent: string },
  ) {
    return (
      <div
        style={{
          padding: 16,
          flex: 1,
          borderRadius: 8,
          background: "rgba(255, 255, 255, 0.02)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255, 255, 255, 0.09)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 14, color: color.accent }}
          >
            image
          </span>
          <span
            style={{ fontSize: 12, fontWeight: 700, color: "var(--v2-text-1)" }}
          >
            Product {slot}: {productName}
          </span>
        </div>

        {/* Preview if uploaded */}
        {heroKey && !uploading && (
          <div
            style={{
              marginBottom: 12,
              borderRadius: 8,
              overflow: "hidden",
              border: `1px solid ${color.border}`,
            }}
          >
            <img
              src={`/api/assets/preview?key=${encodeURIComponent(heroKey)}`}
              alt={`${productName} hero`}
              style={{ width: "100%", height: "auto", display: "block" }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              padding: "10px 12px",
              marginBottom: 12,
              background: "rgba(248,113,113,0.06)",
              border: "1px solid rgba(248,113,113,0.25)",
              borderRadius: 8,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14, color: "#f87171", flexShrink: 0 }}
            >
              error
            </span>
            <div style={{ flex: 1, fontSize: 10, color: "#f87171" }}>
              {error}
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "rgba(248,113,113,0.5)",
                padding: 0,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 12 }}
              >
                close
              </span>
            </button>
          </div>
        )}

        {/* Drop zone */}
        <div
          onDragOver={handleDragOver(slot)}
          onDragLeave={handleDragLeave(slot)}
          onDrop={handleDrop(slot)}
          style={{
            border: `2px dashed ${dragging ? color.accent : uploading ? `${color.border}80` : color.border}`,
            borderRadius: 8,
            padding: uploading ? "24px 16px" : "20px 16px",
            textAlign: "center",
            background: dragging ? `${color.accent}15` : `${color.accent}05`,
            transition: "all 0.15s ease",
            pointerEvents: uploading ? "none" : "auto",
          }}
        >
          {uploading ? (
            <>
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 24,
                  color: color.accent,
                  display: "block",
                  marginBottom: 8,
                  animation: "spin 1s linear infinite",
                }}
              >
                progress_activity
              </span>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--v2-text-3)",
                }}
              >
                Uploading...
              </div>
            </>
          ) : dragging ? (
            <>
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 28,
                  color: color.accent,
                  display: "block",
                  marginBottom: 8,
                }}
              >
                file_download
              </span>
              <div
                style={{ fontSize: 12, fontWeight: 700, color: color.accent }}
              >
                Drop to upload
              </div>
            </>
          ) : (
            <>
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 24,
                  color: `${color.accent}80`,
                  display: "block",
                  marginBottom: 8,
                }}
              >
                {heroKey ? "sync" : "upload_file"}
              </span>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--v2-text-2)",
                  marginBottom: 4,
                }}
              >
                {heroKey ? "Replace hero image" : "Drag hero image here"}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--v2-text-3)",
                  marginBottom: 10,
                }}
              >
                PNG, JPG, WebP · 1920x1080 recommended
              </div>
              <button
                type="button"
                onClick={handleBrowse(slot)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  border: `1px solid ${color.border}`,
                  background: "transparent",
                  color: color.accent,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    `${color.accent}15`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "transparent";
                }}
              >
                Browse files
              </button>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            style={{ display: "none" }}
            onChange={handleFileInputChange(slot)}
          />
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <V2Label>Hero Images</V2Label>
        <V2Text variant="caption" muted>
          Upload product images for visual comparison blocks (1920x1080
          recommended)
        </V2Text>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {renderUploadZone(
          "A",
          productAName,
          productAHeroKey,
          uploadingA,
          draggingA,
          errorA,
          setErrorA,
          fileInputARef,
          { border: "rgba(255,107,107,0.25)", accent: "#ff6b6b" },
        )}
        {renderUploadZone(
          "B",
          productBName,
          productBHeroKey,
          uploadingB,
          draggingB,
          errorB,
          setErrorB,
          fileInputBRef,
          { border: "rgba(72,219,251,0.25)", accent: "#48dbfb" },
        )}
      </div>
    </div>
  );
}
