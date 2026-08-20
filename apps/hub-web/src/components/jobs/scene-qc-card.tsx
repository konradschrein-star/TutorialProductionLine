"use client";

import { useState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { regenerateSceneImage, replaceSceneImage } from "@/app/actions/jobs";
import { V2Button } from "@/app/(authenticated)/_components";
import { SceneErrorPanel } from "./scene-error-panel";

interface Scene {
  scene_index: number;
  paragraph: string;
  visual_asset_key: string | null;
  image_prompt?: string | null;
}

interface GenerationLogEntry {
  stage: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  model: string;
  prompt_system?: string;
  prompt_user?: string;
  raw_output?: string;
  success: boolean;
  error?: string;
}

interface SceneQCCardProps {
  jobId: string;
  scene: Scene;
  imageUrl: string | null;
  isSelected: boolean;
  isBatchSelected?: boolean;
  isRegenerating?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onRegenerate?: (sceneIndex: number) => void;
  onUpload?: (sceneIndex: number) => void;
  onRegenerated: () => void;
  generationLog?: GenerationLogEntry[];
  onViewLogs?: () => void;
}

export function SceneQCCard({
  jobId,
  scene,
  imageUrl,
  isSelected,
  isBatchSelected = false,
  isRegenerating = false,
  onClick,
  onRegenerate,
  onUpload,
  onRegenerated,
  generationLog = [],
  onViewLogs,
}: SceneQCCardProps) {
  const [localRegenerating, setLocalRegenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrorPanel, setShowErrorPanel] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasImage = !!imageUrl;
  const regenerating = isRegenerating || localRegenerating;

  // Check if there are errors in generation log for this scene
  const sceneErrors = generationLog.filter(
    (entry) => entry.stage === "scene_image" && entry.error && !entry.success,
  );

  async function handleRegenerate(e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);

    if (onRegenerate) {
      onRegenerate(scene.scene_index);
    } else {
      // Fallback for old API
      setLocalRegenerating(true);
      const result = await regenerateSceneImage(jobId, scene.scene_index);
      if (!result.success) setError(result.error ?? "Failed");
      setLocalRegenerating(false);
      onRegenerated();
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const result = await replaceSceneImage(jobId, scene.scene_index, fd);
    if (!result.success) setError(result.error ?? "Failed");
    setUploading(false);
    e.target.value = "";

    if (onUpload) {
      onUpload(scene.scene_index);
    } else {
      onRegenerated();
    }
  }

  async function handleRetryWithPrompt(editedPrompt: string) {
    setRetrying(true);
    setError(null);
    try {
      // Regenerate the image
      // Note: To support custom prompts, the regenerateSceneImage action would need to be updated
      // For now, we'll just trigger a standard regeneration
      const result = await regenerateSceneImage(jobId, scene.scene_index);
      if (!result.success) {
        setError(result.error ?? "Failed to regenerate");
      } else {
        setShowErrorPanel(false);
      }
    } finally {
      setRetrying(false);
      onRegenerated();
    }
  }

  return (
    <div
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) =>
        e.key === "Enter" && onClick(e as unknown as React.MouseEvent)
      }
      style={{
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s, background 0.15s",
        outline: "none",
        border: isSelected
          ? "2px solid var(--v2-accent)"
          : isBatchSelected
            ? "2px solid rgba(var(--v2-accent-rgb), 0.5)"
            : hasImage
              ? "1px solid var(--v2-border-1)"
              : "1px solid rgba(var(--v2-error-rgb), 0.3)",
        boxShadow: isSelected
          ? "0 0 12px rgba(var(--v2-accent-rgb), 0.2)"
          : isBatchSelected
            ? "0 0 8px rgba(var(--v2-accent-rgb), 0.15)"
            : "none",
        background: isBatchSelected
          ? "rgba(var(--v2-accent-rgb), 0.04)"
          : "transparent",
      }}
    >
      {/* Image area */}
      <div
        style={{
          aspectRatio: "16/9",
          background: "var(--v2-surface-2)",
          position: "relative",
        }}
      >
        {hasImage ? (
          <img
            src={imageUrl!}
            alt={`Scene ${scene.scene_index}`}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(var(--v2-error-rgb), 0.06)",
              borderBottom: "1px solid rgba(var(--v2-error-rgb), 0.2)",
              gap: 4,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 28, color: "var(--v2-error-soft)" }}
            >
              hide_image
            </span>
            <span
              style={{
                fontSize: 10,
                color: "var(--v2-error-soft)",
                fontWeight: 600,
              }}
            >
              No image
            </span>
          </div>
        )}

        {/* Scene index badge */}
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            background: "rgba(var(--v2-surface-0-rgb, 0,0,0), 0.85)",
            color: "var(--v2-text-1)",
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
          {regenerating ? (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                background: "rgba(var(--v2-surface-0-rgb, 0,0,0), 0.85)",
                color: "var(--v2-text-1)",
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
              Regenerating
            </span>
          ) : hasImage ? (
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 16,
                color: "var(--v2-success)",
                filter: "drop-shadow(0 0 4px rgba(var(--v2-success-rgb), 0.5))",
              }}
            >
              check_circle
            </span>
          ) : (
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 16,
                color: "var(--v2-error-soft)",
                filter: "drop-shadow(0 0 4px rgba(var(--v2-error-rgb), 0.5))",
              }}
            >
              error
            </span>
          )}
        </div>
      </div>

      {/* Caption */}
      <div style={{ padding: "8px 10px", background: "var(--v2-surface-1)" }}>
        <p
          style={{
            fontSize: 10,
            color: "var(--v2-text-2)",
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

        {error && (
          <p
            style={{
              fontSize: 10,
              color: "var(--v2-error-soft)",
              marginTop: 4,
            }}
          >
            {error}
          </p>
        )}

        {/* Show error indicator if generation failed */}
        {sceneErrors.length > 0 && !showErrorPanel && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowErrorPanel(true);
            }}
            style={{
              fontSize: 9,
              color: "var(--v2-error-soft)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: 0,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 12 }}
            >
              error
            </span>
            {sceneErrors.length} generation error
            {sceneErrors.length > 1 ? "s" : ""}
          </button>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <V2Button
            onClick={handleRegenerate}
            disabled={regenerating || uploading || retrying}
            size="sm"
            title="Regenerate (R)"
          >
            {regenerating ? (
              <Loader2
                style={{
                  width: 10,
                  height: 10,
                  animation: "spin 1s linear infinite",
                }}
              />
            ) : (
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 12 }}
              >
                refresh
              </span>
            )}
            Regen
          </V2Button>

          <V2Button
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            disabled={regenerating || uploading || retrying}
            size="sm"
            title="Upload custom image"
          >
            {uploading ? (
              <Loader2
                style={{
                  width: 10,
                  height: 10,
                  animation: "spin 1s linear infinite",
                }}
              />
            ) : (
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 12 }}
              >
                upload
              </span>
            )}
            Upload
          </V2Button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>

        {/* Error panel (expandable) */}
        {showErrorPanel && (
          <div
            style={{
              borderTop: "1px solid var(--v2-border-1)",
              marginTop: 8,
              paddingTop: 8,
            }}
          >
            <SceneErrorPanel
              sceneIndex={scene.scene_index}
              generationLog={generationLog}
              onEditPrompt={(newPrompt) => {
                // Just save the prompt without regenerating
                setShowErrorPanel(false);
              }}
              onRetryWithPrompt={handleRetryWithPrompt}
              onViewLogs={onViewLogs}
            />
          </div>
        )}
      </div>
    </div>
  );
}
