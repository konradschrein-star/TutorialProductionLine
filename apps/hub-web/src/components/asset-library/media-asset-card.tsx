"use client";

import { useState, useEffect } from "react";
import { AudioWaveform } from "./audio-waveform";
import { AssetUsageModal } from "./asset-usage-modal";
import type { AssetCardAsset } from "./asset-card";

/**
 * MediaAssetCard Component
 *
 * Displays a single media asset (video/audio/image) with:
 * - Thumbnail preview (video/image)
 * - Waveform visualization (audio)
 * - Duration badge
 * - Usage badge (shows number of jobs using this asset)
 * - Drag handle (appears on hover)
 * - File size tooltip
 *
 * Fully draggable with data transfer protocol for job creation integration.
 */

interface MediaAssetCardProps {
  asset: AssetCardAsset;
  onEdit: (asset: AssetCardAsset) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}

/**
 * Format duration in seconds to MM:SS
 */
function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

export function MediaAssetCard({
  asset,
  onEdit,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}: MediaAssetCardProps) {
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [usageCount, setUsageCount] = useState<number | null>(null);
  const [showUsageModal, setShowUsageModal] = useState(false);

  // Fetch waveform for audio assets
  useEffect(() => {
    if (asset.asset_type === "audio" && !asset.waveform_data) {
      setWaveformLoading(true);
      fetch(`/api/assets/${asset.id}/waveform`)
        .then((res) => res.json())
        .then((data) => {
          setWaveformData(data.data || []);
          setWaveformLoading(false);
        })
        .catch(() => {
          setWaveformData([]);
          setWaveformLoading(false);
        });
    } else if (asset.asset_type === "audio" && asset.waveform_data) {
      // Use cached waveform from database
      setWaveformData(asset.waveform_data as number[]);
    }
  }, [asset.id, asset.asset_type, asset.waveform_data]);

  // Fetch usage count
  useEffect(() => {
    fetch(`/api/assets/${asset.id}/usage`)
      .then((res) => res.json())
      .then((data) => {
        setUsageCount(data.total_jobs ?? 0);
      })
      .catch(() => {
        setUsageCount(null);
      });
  }, [asset.id]);

  /**
   * Handle drag start - set data transfer with media asset metadata
   */
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({
        source: "media-library",
        asset_id: asset.id,
        asset_type: asset.asset_type,
        name: asset.name,
        file_path: asset.file_path,
        size_bytes: asset.size_bytes,
        duration_seconds: asset.duration_seconds,
      }),
    );

    // Set drag image preview (use the card itself)
    e.dataTransfer.effectAllowed = "copy";
  };

  /**
   * Handle checkbox click - toggle selection without triggering card click
   */
  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleSelect) {
      onToggleSelect(asset.id);
    }
  };

  return (
    <div
      draggable={!selectionMode}
      onDragStart={handleDragStart}
      onClick={() => !selectionMode && onEdit(asset)}
      className="group relative"
      style={{
        width: 160,
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--v2-surface-container)",
        border: isSelected
          ? "2px solid rgba(var(--v2-accent-rgb), 0.6)"
          : "1px solid var(--v2-surface-bright)",
        transition: "all 0.2s ease",
        cursor: selectionMode ? "default" : "pointer",
        transform: isSelected ? "translateY(-2px)" : "none",
        boxShadow: isSelected
          ? "0 4px 12px rgba(var(--v2-accent-rgb), 0.2)"
          : "none",
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.background =
            "rgba(var(--v2-surface-bright-rgb), 0.5)";
          e.currentTarget.style.borderColor = "rgba(var(--v2-accent-rgb), 0.3)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.background = "var(--v2-surface-container)";
          e.currentTarget.style.borderColor = "var(--v2-surface-bright)";
        }
      }}
    >
      {/* Preview area */}
      <div
        className="relative flex items-center justify-center"
        style={{
          height: 96,
          background: "rgba(var(--v2-surface-bright-rgb), 0.3)",
          overflow: "hidden",
        }}
      >
        {/* Checkbox overlay (only visible in selection mode) */}
        {selectionMode && (
          <div
            onClick={handleCheckboxClick}
            style={{
              position: "absolute",
              top: 6,
              left: 6,
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              zIndex: 10,
              transition: "transform 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "scale(1.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 20,
                color: "white",
                filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.4))",
              }}
            >
              {isSelected ? "check_box" : "check_box_outline_blank"}
            </span>
          </div>
        )}

        {/* Video/Image: Show thumbnail */}
        {(asset.asset_type === "video" || asset.asset_type === "image") &&
        !imgError ? (
          <img
            src={`/api/assets/${asset.id}/thumbnail`}
            alt={asset.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
            onError={() => setImgError(true)}
          />
        ) : null}

        {/* Video/Image: Fallback icon */}
        {(asset.asset_type === "video" || asset.asset_type === "image") &&
        imgError ? (
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 32,
              color: "rgba(var(--v2-text-2-rgb), 0.3)",
            }}
          >
            {asset.asset_type === "video" ? "videocam" : "image"}
          </span>
        ) : null}

        {/* Audio: Show waveform */}
        {asset.asset_type === "audio" ? (
          <div style={{ padding: "0 8px", width: "100%" }}>
            {waveformLoading ? (
              <div
                style={{
                  textAlign: "center",
                  color: "var(--v2-text-2)",
                  fontSize: 11,
                }}
              >
                Loading...
              </div>
            ) : (
              <AudioWaveform data={waveformData} width={144} height={60} />
            )}
          </div>
        ) : null}

        {/* Duration badge */}
        {asset.duration_seconds ? (
          <div
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(0, 0, 0, 0.7)",
              color: "white",
              fontSize: 10,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatDuration(asset.duration_seconds)}
          </div>
        ) : null}

        {/* Drag indicator */}
        <div
          className="opacity-0 group-hover:opacity-100"
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            transition: "opacity 0.2s ease",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 16,
              color: "white",
              filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))",
            }}
          >
            drag_indicator
          </span>
        </div>

        {/* Usage badge */}
        {usageCount !== null && usageCount > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowUsageModal(true);
            }}
            style={{
              position: "absolute",
              bottom: 6,
              left: 6,
              padding: "4px 8px",
              borderRadius: 6,
              background: "rgba(var(--v2-accent-rgb), 0.95)",
              color: "white",
              fontSize: 10,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "all 0.2s ease",
              boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--v2-accent)";
              e.currentTarget.style.transform = "scale(1.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                "rgba(var(--v2-accent-rgb), 0.95)";
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 12 }}
            >
              work
            </span>
            Used in {usageCount}
          </button>
        )}
      </div>

      {/* Usage modal */}
      {showUsageModal && (
        <AssetUsageModal
          asset={asset}
          onClose={() => setShowUsageModal(false)}
        />
      )}

      {/* Info area */}
      <div style={{ padding: 8 }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--v2-text-1)",
            margin: "0 0 4px 0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={asset.name}
        >
          {asset.name}
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {asset.file_format}
          </span>
          <span
            style={{
              fontSize: 10,
              color: "var(--v2-text-2)",
            }}
            title={`File size: ${formatBytes(asset.size_bytes)}`}
          >
            {formatBytes(asset.size_bytes)}
          </span>
        </div>
      </div>
    </div>
  );
}
