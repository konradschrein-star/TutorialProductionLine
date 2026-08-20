"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
  Loader2,
  Upload,
  Copy,
  Plus,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { replaceSceneImage } from "@/app/actions/jobs";

interface ImageValidationResult {
  valid: boolean;
  error?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
}

const MIN_WIDTH = 1280;
const MIN_HEIGHT = 720;
const ALLOWED_ASPECT_RATIOS = ["16:9", "9:16"];
const BLACK_PIXEL_THRESHOLD = 0.95; // 95%+ dark pixels = black screen

async function validateImage(file: File): Promise<ImageValidationResult> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const { width, height } = img;

      // Check minimum resolution
      if (width < MIN_WIDTH || height < MIN_HEIGHT) {
        URL.revokeObjectURL(objectUrl);
        resolve({
          valid: false,
          error: `Image resolution too low. Minimum: ${MIN_WIDTH}x${MIN_HEIGHT}. Current: ${width}x${height}`,
        });
        return;
      }

      // Check aspect ratio (tolerance: 2% for encoding variations)
      const aspectRatio = width / height;
      const ratio16_9 = 16 / 9;
      const ratio9_16 = 9 / 16;
      const tolerance = 0.02;

      const is16_9 = Math.abs(aspectRatio - ratio16_9) <= tolerance;
      const is9_16 = Math.abs(aspectRatio - ratio9_16) <= tolerance;

      if (!is16_9 && !is9_16) {
        URL.revokeObjectURL(objectUrl);
        resolve({
          valid: false,
          error: `Invalid aspect ratio. Expected 16:9 or 9:16. Current: ${width}:${height} (${aspectRatio.toFixed(2)})`,
        });
        return;
      }

      // Check for black screen using canvas
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        resolve({
          valid: false,
          error: "Failed to create canvas context for validation",
        });
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, width, height);
      const pixels = imageData.data;

      // Count dark pixels (RGB < 30 each = dark)
      let darkPixels = 0;
      const totalPixels = width * height;

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        if (r < 30 && g < 30 && b < 30) {
          darkPixels++;
        }
      }

      const darkRatio = darkPixels / totalPixels;

      if (darkRatio >= BLACK_PIXEL_THRESHOLD) {
        URL.revokeObjectURL(objectUrl);
        resolve({
          valid: false,
          error: `Image appears to be a black screen (${(darkRatio * 100).toFixed(1)}% dark pixels)`,
        });
        return;
      }

      URL.revokeObjectURL(objectUrl);
      resolve({
        valid: true,
        width,
        height,
        aspectRatio: is16_9 ? "16:9" : "9:16",
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        valid: false,
        error: "Failed to load image for validation",
      });
    };

    img.src = objectUrl;
  });
}

interface Scene {
  scene_index: number;
  paragraph: string;
  visual_asset_key: string | null;
  image_prompt?: string | null;
}

interface SceneUploadCardProps {
  jobId: string;
  scene: Scene;
  imageUrl: string | null;
  isSelected: boolean;
  onClick: () => void;
  onUploaded: () => void;
}

/**
 * Scene Upload Card - Manual Mode
 *
 * Used when image_generation_mode === 'manual'. Allows VA to upload
 * manually-created images for each scene via drag-and-drop or click.
 */
export function SceneUploadCard({
  jobId,
  scene,
  imageUrl,
  isSelected,
  onClick,
  onUploaded,
}: SceneUploadCardProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationInfo, setValidationInfo] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const hasImage = !!imageUrl;

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      const file = acceptedFiles[0];
      setError(null);
      setValidationInfo(null);

      // Basic file type check
      if (!file.type.startsWith("image/")) {
        setError("File must be an image");
        return;
      }

      // Basic size check (50MB)
      const maxSize = 50 * 1024 * 1024;
      if (file.size > maxSize) {
        setError("Image size exceeds 50MB limit");
        return;
      }

      // Run validation
      setUploading(true);
      const validation = await validateImage(file);

      if (!validation.valid) {
        setError(validation.error || "Image validation failed");
        setUploading(false);
        return;
      }

      // Show validation success info
      setValidationInfo(
        `✓ Valid image: ${validation.width}x${validation.height} (${validation.aspectRatio})`,
      );

      // Proceed with upload
      const formData = new FormData();
      formData.append("file", file);
      formData.append("jobId", jobId);
      formData.append("sceneIndex", String(scene.scene_index));

      try {
        await replaceSceneImage(jobId, scene.scene_index, formData);
        setUploading(false);
        onUploaded?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        setUploading(false);
      }
    },
    [jobId, scene.scene_index, onUploaded],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    maxFiles: 1,
    disabled: uploading,
    noClick: false,
  });

  async function handleCopyPrompt(e: React.MouseEvent) {
    e.stopPropagation();
    if (!scene.image_prompt) return;

    try {
      await navigator.clipboard.writeText(scene.image_prompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch (err) {
      console.error("Failed to copy prompt:", err);
    }
  }

  return (
    <div
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={{
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        outline: "none",
        border: isSelected
          ? "2px solid var(--v2-accent, #aaff00)"
          : hasImage
            ? "1px solid rgba(75,68,85,0.3)"
            : "1px solid rgba(255,180,171,0.4)",
        boxShadow: isSelected
          ? "0 0 12px rgba(var(--v2-accent-rgb, 170,255,0), 0.2)"
          : "none",
      }}
    >
      {/* Image area with dropzone */}
      <div
        {...getRootProps()}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        style={{
          aspectRatio: "16/9",
          background: isDragActive ? "#1a1a1a" : "#0e0e0e",
          border: isDragActive ? "2px dashed #3b82f6" : "2px dashed #333",
          borderRadius: "8px",
          position: "relative",
          cursor: uploading ? "wait" : "pointer",
          transition: "all 0.2s ease",
          minHeight: hasImage ? "auto" : "300px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <input {...getInputProps()} />

        {hasImage ? (
          <>
            {/* Image preview */}
            <img
              src={imageUrl!}
              alt={`Scene ${scene.scene_index + 1}`}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                borderRadius: "8px",
              }}
            />
            {/* Hover overlay for re-upload */}
            {!uploading && (isHovering || isFocused) && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0, 0, 0, 0.7)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: 1,
                  transition: "opacity 0.2s",
                  borderRadius: "8px",
                  pointerEvents: "none",
                }}
              >
                <Upload size={48} color="#3b82f6" />
                <p
                  style={{ color: "#fff", marginTop: "12px", fontSize: "16px" }}
                >
                  Drop new image to replace
                </p>
              </div>
            )}
          </>
        ) : (
          /* Empty state with large plus icon */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "40px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "120px",
                height: "120px",
                borderRadius: "50%",
                border: "3px dashed #3b82f6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "24px",
              }}
            >
              <Plus size={60} color="#3b82f6" strokeWidth={3} />
            </div>
            <p
              style={{
                color: "#9ca3af",
                fontSize: "18px",
                fontWeight: 500,
              }}
            >
              {isDragActive ? "Drop image here" : "Drag and drop image here"}
            </p>
            <p style={{ color: "#6b7280", fontSize: "14px", marginTop: "8px" }}>
              or click to browse
            </p>
            <p
              style={{
                color: "#4b5563",
                fontSize: "12px",
                marginTop: "16px",
              }}
            >
              Required: 1280x720+ resolution, 16:9 or 9:16 aspect ratio
            </p>
          </div>
        )}

        {uploading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0, 0, 0, 0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
            }}
          >
            <Loader2 className="animate-spin" size={48} color="#3b82f6" />
          </div>
        )}

        {/* Scene index badge */}
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            background: "rgba(0,0,0,0.7)",
            color: "#e5e2e1",
            fontSize: 9,
            fontFamily: "monospace",
            fontWeight: 700,
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          #{scene.scene_index}
        </div>

        {/* Status badge */}
        <div style={{ position: "absolute", top: 6, right: 6 }}>
          {uploading ? (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                background: "rgba(0,0,0,0.7)",
                color: "#e5e2e1",
                fontSize: 9,
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              <Loader2
                style={{
                  width: 10,
                  height: 10,
                  animation: "spin 1s linear infinite",
                }}
              />{" "}
              Uploading
            </span>
          ) : hasImage ? (
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 16,
                color: "#23decb",
                filter: "drop-shadow(0 0 4px rgba(35,222,203,0.5))",
              }}
            >
              check_circle
            </span>
          ) : (
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 16,
                color: "#ffb4ab",
                filter: "drop-shadow(0 0 4px rgba(255,180,171,0.5))",
              }}
            >
              error
            </span>
          )}
        </div>
      </div>

      {/* Validation feedback */}
      <div style={{ marginTop: "12px", minHeight: "24px" }}>
        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              background: "#7f1d1d",
              border: "1px solid #991b1b",
              borderRadius: "6px",
            }}
          >
            <AlertCircle size={16} color="#fca5a5" />
            <p style={{ color: "#fca5a5", fontSize: "14px", margin: 0 }}>
              {error}
            </p>
          </div>
        )}

        {validationInfo && !error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              background: "#064e3b",
              border: "1px solid #047857",
              borderRadius: "6px",
            }}
          >
            <CheckCircle size={16} color="#6ee7b7" />
            <p style={{ color: "#6ee7b7", fontSize: "14px", margin: 0 }}>
              {validationInfo}
            </p>
          </div>
        )}
      </div>

      {/* Caption */}
      <div style={{ padding: "8px 10px", background: "#111" }}>
        <p
          style={{
            fontSize: 10,
            color: "rgba(205,195,215,0.5)",
            lineHeight: 1.4,
            margin: 0,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {scene.paragraph.slice(0, 100)}
          {scene.paragraph.length > 100 ? "…" : ""}
        </p>

        {/* Actions */}
        {scene.image_prompt && (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              onClick={handleCopyPrompt}
              disabled={uploading}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                borderRadius: 6,
                border: "none",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
                background: copiedPrompt
                  ? "rgba(35,222,203,0.2)"
                  : "rgba(75,68,85,0.3)",
                color: copiedPrompt ? "#23decb" : "rgba(205,195,215,0.7)",
                transition: "background 0.12s, color 0.12s",
                opacity: uploading ? 0.5 : 1,
              }}
              title="Copy image prompt to clipboard"
            >
              {copiedPrompt ? (
                <>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 12 }}
                  >
                    check
                  </span>
                  Copied!
                </>
              ) : (
                <>
                  <Copy style={{ width: 10, height: 10 }} />
                  Copy Prompt
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
