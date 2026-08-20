"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MediaAssetCard } from "./media-asset-card";
import { BulkDeleteModal } from "./bulk-delete-modal";
import { BulkTagModal } from "./bulk-tag-modal";
import type { AssetCardAsset } from "./asset-card";

/**
 * MediaFilesTab Component
 *
 * Displays media assets (video/audio/image) in a virtualized list with category filters.
 * Integrated into the main asset library as a separate tab.
 *
 * Features:
 * - Real-time search with debounced input
 * - Category filter pills (All / Videos / Audio / Images)
 * - Advanced filters: duration, file size, date added
 * - Result count display
 * - Clear all filters button
 * - Virtualized rendering for performance (500+ assets)
 * - Empty state with helpful messaging
 * - Drag-drop support via MediaAssetCard
 */

interface MediaFilesTabProps {
  assets: AssetCardAsset[];
  onEdit: (asset: AssetCardAsset) => void;
}

interface Filters {
  duration: string;
  size: string;
  date: string;
  unusedOnly: boolean;
}

const CATEGORY_FILTERS = [
  { value: "", label: "All", icon: "video_library" },
  { value: "video", label: "Videos", icon: "videocam" },
  { value: "audio", label: "Audio", icon: "audio_file" },
  { value: "image", label: "Images", icon: "image" },
];

const DURATION_FILTERS = [
  { value: "", label: "Any duration" },
  { value: "<30", label: "<30s" },
  { value: "30-120", label: "30s-2m" },
  { value: "120-600", label: "2m-10m" },
  { value: ">600", label: ">10m" },
];

const SIZE_FILTERS = [
  { value: "", label: "Any size" },
  { value: "<1", label: "<1MB" },
  { value: "1-10", label: "1-10MB" },
  { value: "10-100", label: "10-100MB" },
  { value: ">100", label: ">100MB" },
];

const DATE_FILTERS = [
  { value: "", label: "All time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "older", label: "Older" },
];

export function MediaFilesTab({ assets, onEdit }: MediaFilesTabProps) {
  const [category, setCategory] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<Filters>({
    duration: "",
    size: "",
    date: "",
    unusedOnly: false,
  });

  // Selection state for bulk operations
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);

  // Ref for virtualized scroll container
  const parentRef = useRef<HTMLDivElement>(null);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Clear selection when category filter changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [category]);

  // Filter media assets with search and advanced filters
  const mediaAssets = useMemo(() => {
    return assets.filter((a) => {
      // Only show video, audio, image asset types
      if (!["video", "audio", "image"].includes(a.asset_type)) {
        return false;
      }

      // Apply category filter if selected
      if (category && a.asset_type !== category) {
        return false;
      }

      // Apply search query
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          a.name.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q) ||
          a.tags?.some((t) => t.toLowerCase().includes(q)) ||
          a.file_format?.toLowerCase().includes(q);

        if (!matchesSearch) {
          return false;
        }
      }

      // Apply duration filter (video/audio only)
      if (filters.duration) {
        if (!a.duration_seconds) return false;

        const dur = a.duration_seconds;
        if (filters.duration === "<30" && dur >= 30) return false;
        if (filters.duration === "30-120" && (dur < 30 || dur >= 120))
          return false;
        if (filters.duration === "120-600" && (dur < 120 || dur >= 600))
          return false;
        if (filters.duration === ">600" && dur < 600) return false;
      }

      // Apply size filter
      if (filters.size) {
        if (!a.size_bytes) return false;

        const sizeMB = a.size_bytes / (1024 * 1024);
        if (filters.size === "<1" && sizeMB >= 1) return false;
        if (filters.size === "1-10" && (sizeMB < 1 || sizeMB >= 10))
          return false;
        if (filters.size === "10-100" && (sizeMB < 10 || sizeMB >= 100))
          return false;
        if (filters.size === ">100" && sizeMB < 100) return false;
      }

      // Apply date filter
      if (filters.date) {
        const assetDate = new Date(a.created_at);
        const now = new Date();
        const dayMs = 24 * 60 * 60 * 1000;

        if (filters.date === "today") {
          const todayStart = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
          );
          if (assetDate < todayStart) return false;
        } else if (filters.date === "week") {
          const weekAgo = new Date(now.getTime() - 7 * dayMs);
          if (assetDate < weekAgo) return false;
        } else if (filters.date === "month") {
          const monthAgo = new Date(now.getTime() - 30 * dayMs);
          if (assetDate < monthAgo) return false;
        } else if (filters.date === "older") {
          const monthAgo = new Date(now.getTime() - 30 * dayMs);
          if (assetDate >= monthAgo) return false;
        }
      }

      return true;
    });
  }, [assets, category, searchQuery, filters]);

  // Count assets by category for filter badges
  const counts = useMemo(() => {
    const video = assets.filter((a) => a.asset_type === "video").length;
    const audio = assets.filter((a) => a.asset_type === "audio").length;
    const image = assets.filter((a) => a.asset_type === "image").length;
    return {
      all: video + audio + image,
      video,
      audio,
      image,
    };
  }, [assets]);

  // Virtualizer for performance with large asset lists
  const virtualizer = useVirtualizer({
    count: mediaAssets.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 220, // Card height estimate (200px card + 20px gap)
    overscan: 5, // Render 5 extra items above/below viewport
  });

  // Check if any filters are active
  const hasActiveFilters =
    searchQuery ||
    filters.duration ||
    filters.size ||
    filters.date ||
    filters.unusedOnly;

  // Clear all filters
  const handleClearFilters = () => {
    setSearchInput("");
    setSearchQuery("");
    setFilters({ duration: "", size: "", date: "", unusedOnly: false });
  };

  // Selection mode handlers
  const handleToggleSelectionMode = () => {
    setSelectionMode((prev) => !prev);
    if (selectionMode) {
      // Exiting selection mode - clear selection
      setSelectedIds(new Set());
    }
  };

  // Toggle individual asset selection
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all visible assets
  const handleSelectAll = () => {
    const allVisibleIds = new Set(mediaAssets.map((a) => a.id));
    setSelectedIds(allVisibleIds);
  };

  // Handle bulk delete
  const handleBulkDelete = async () => {
    const selectedAssets = mediaAssets.filter((a) => selectedIds.has(a.id));

    // Track results
    const results = await Promise.allSettled(
      selectedAssets.map((asset) =>
        fetch(`/api/assets/${asset.id}`, { method: "DELETE" }).then((res) => {
          if (!res.ok) throw new Error(`Failed to delete ${asset.name}`);
          return { id: asset.id, success: true };
        }),
      ),
    );

    // Separate successes and failures
    const succeeded = results
      .filter(
        (r): r is PromiseFulfilledResult<{ id: string; success: boolean }> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value.id);

    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    ).length;

    // Remove successful deletions from selection
    if (succeeded.length > 0) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        succeeded.forEach((id) => next.delete(id));
        return next;
      });

      // Notify parent to remove from assets list
      // (In real implementation, this would call a callback prop)
      // Successfully deleted assets
    }

    // Show result
    if (failed === 0) {
      alert(`Successfully deleted ${succeeded.length} assets`);
      setSelectionMode(false);
      setSelectedIds(new Set());
    } else {
      alert(
        `${succeeded.length} of ${selectedAssets.length} assets deleted successfully. ${failed} failed.`,
      );
    }

    setShowDeleteModal(false);
  };

  // Handle bulk add tags
  const handleBulkAddTags = async (newTags: string[]) => {
    const selectedAssets = mediaAssets.filter((a) => selectedIds.has(a.id));

    // Track results
    const results = await Promise.allSettled(
      selectedAssets.map(async (asset) => {
        // Merge tags (union, deduplicate) using local asset data
        const existingTags = asset.tags || [];
        const mergedTags = Array.from(new Set([...existingTags, ...newTags]));

        // Update asset with merged tags
        const patchRes = await fetch(`/api/assets/${asset.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: mergedTags }),
        });

        if (!patchRes.ok) throw new Error(`Failed to update ${asset.name}`);

        return { id: asset.id, success: true };
      }),
    );

    // Separate successes and failures
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    // Show result
    if (failed === 0) {
      alert(`Tags added to ${succeeded} assets successfully`);
      setSelectionMode(false);
      setSelectedIds(new Set());
    } else {
      alert(
        `Tags added to ${succeeded} of ${selectedAssets.length} assets. ${failed} failed.`,
      );

      // Remove successful ones from selection
      const failedIds = results
        .map((r, i) => (r.status === "rejected" ? selectedAssets[i].id : null))
        .filter((id): id is string => id !== null);

      setSelectedIds(new Set(failedIds));
    }

    setShowTagModal(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Selection toolbar (shown when selection mode is active) */}
      {selectionMode && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderRadius: 8,
            border: "1px solid var(--v2-surface-bright)",
            background: "var(--v2-surface-container)",
          }}
        >
          {/* Selection status */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18, color: "var(--v2-accent)" }}
            >
              check_circle
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--v2-text-1)",
              }}
            >
              {selectedIds.size} selected
            </span>
          </div>

          <div
            style={{
              width: 1,
              height: 24,
              background: "var(--v2-surface-bright)",
            }}
          />

          {/* Select All / Deselect All buttons */}
          <button
            onClick={handleSelectAll}
            disabled={selectedIds.size === mediaAssets.length}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              background: "var(--v2-surface-bright)",
              color: "var(--v2-text-2)",
              fontSize: 12,
              fontWeight: 500,
              cursor:
                selectedIds.size === mediaAssets.length
                  ? "not-allowed"
                  : "pointer",
              opacity: selectedIds.size === mediaAssets.length ? 0.5 : 1,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              select_all
            </span>
            Select All
          </button>

          <button
            onClick={() => setSelectedIds(new Set())}
            disabled={selectedIds.size === 0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              background: "var(--v2-surface-bright)",
              color: "var(--v2-text-2)",
              fontSize: 12,
              fontWeight: 500,
              cursor: selectedIds.size === 0 ? "not-allowed" : "pointer",
              opacity: selectedIds.size === 0 ? 0.5 : 1,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              clear_all
            </span>
            Deselect All
          </button>

          <div style={{ flex: 1 }} />

          {/* Bulk action buttons */}
          <button
            onClick={() => setShowTagModal(true)}
            disabled={selectedIds.size === 0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              background:
                selectedIds.size > 0
                  ? "rgba(var(--v2-accent-rgb), 0.15)"
                  : "var(--v2-surface-bright)",
              color:
                selectedIds.size > 0 ? "var(--v2-accent)" : "var(--v2-text-2)",
              fontSize: 12,
              fontWeight: 600,
              cursor: selectedIds.size === 0 ? "not-allowed" : "pointer",
              opacity: selectedIds.size === 0 ? 0.5 : 1,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (selectedIds.size > 0) {
                e.currentTarget.style.background =
                  "rgba(var(--v2-accent-rgb), 0.25)";
              }
            }}
            onMouseLeave={(e) => {
              if (selectedIds.size > 0) {
                e.currentTarget.style.background =
                  "rgba(var(--v2-accent-rgb), 0.15)";
              }
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              sell
            </span>
            Add Tags
          </button>

          <button
            onClick={() => setShowDeleteModal(true)}
            disabled={selectedIds.size === 0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              background:
                selectedIds.size > 0
                  ? "rgba(239, 68, 68, 0.15)"
                  : "var(--v2-surface-bright)",
              color: selectedIds.size > 0 ? "#ef4444" : "var(--v2-text-2)",
              fontSize: 12,
              fontWeight: 600,
              cursor: selectedIds.size === 0 ? "not-allowed" : "pointer",
              opacity: selectedIds.size === 0 ? 0.5 : 1,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (selectedIds.size > 0) {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.25)";
              }
            }}
            onMouseLeave={(e) => {
              if (selectedIds.size > 0) {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
              }
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              delete
            </span>
            Delete
          </button>

          <div
            style={{
              width: 1,
              height: 24,
              background: "var(--v2-surface-bright)",
            }}
          />

          {/* Cancel button */}
          <button
            onClick={handleToggleSelectionMode}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--v2-surface-bright)",
              background: "transparent",
              color: "var(--v2-text-2)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {/* Search bar */}
      <div style={{ position: "relative" }}>
        <span
          className="material-symbols-outlined"
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 20,
            color: "var(--v2-text-2)",
            pointerEvents: "none",
          }}
        >
          search
        </span>
        <input
          type="text"
          placeholder="Search by name, description, tags, or format..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 40px",
            borderRadius: 8,
            border: "1px solid var(--v2-surface-bright)",
            background: "var(--v2-surface-container)",
            color: "var(--v2-text-1)",
            fontSize: 14,
            outline: "none",
            transition: "border-color 0.2s ease",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor =
              "rgba(var(--v2-accent-rgb), 0.4)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--v2-surface-bright)";
          }}
        />
        {searchInput && (
          <button
            onClick={() => {
              setSearchInput("");
              setSearchQuery("");
            }}
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              padding: 4,
              borderRadius: 4,
              border: "none",
              background: "transparent",
              color: "var(--v2-text-2)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              close
            </span>
          </button>
        )}
      </div>

      {/* Category filter pills */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {CATEGORY_FILTERS.map((f) => {
          const count = f.value
            ? counts[f.value as keyof typeof counts]
            : counts.all;
          const isActive = category === f.value;

          return (
            <button
              key={f.value}
              onClick={() => setCategory(f.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid",
                borderColor: isActive
                  ? "rgba(var(--v2-accent-rgb), 0.4)"
                  : "var(--v2-surface-bright)",
                background: isActive
                  ? "rgba(var(--v2-accent-rgb), 0.15)"
                  : "var(--v2-surface-container)",
                color: isActive ? "var(--v2-accent)" : "var(--v2-text-2)",
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "var(--v2-surface-bright)";
                  e.currentTarget.style.color = "var(--v2-text-1)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background =
                    "var(--v2-surface-container)";
                  e.currentTarget.style.color = "var(--v2-text-2)";
                }
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                {f.icon}
              </span>
              <span>{f.label}</span>
              {count > 0 && (
                <span
                  style={{
                    padding: "1px 6px",
                    borderRadius: 10,
                    background: isActive
                      ? "rgba(var(--v2-accent-rgb), 0.2)"
                      : "rgba(var(--v2-text-2-rgb), 0.1)",
                    fontSize: 11,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}

        {/* Select mode toggle button */}
        {!selectionMode && mediaAssets.length > 0 && (
          <>
            <div style={{ flex: 1 }} />
            <button
              onClick={handleToggleSelectionMode}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid var(--v2-surface-bright)",
                background: "var(--v2-surface-container)",
                color: "var(--v2-text-2)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--v2-surface-bright)";
                e.currentTarget.style.color = "var(--v2-text-1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  "var(--v2-surface-container)";
                e.currentTarget.style.color = "var(--v2-text-2)";
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                check_box
              </span>
              Select
            </button>
          </>
        )}
      </div>

      {/* Advanced filters */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        {/* Duration filter (video/audio only) */}
        {["video", "audio", ""].includes(category) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontSize: 12,
                color: "var(--v2-text-2)",
                fontWeight: 500,
              }}
            >
              Duration:
            </span>
            <select
              value={filters.duration}
              onChange={(e) =>
                setFilters({ ...filters, duration: e.target.value })
              }
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--v2-surface-bright)",
                background: "var(--v2-surface-container)",
                color: "var(--v2-text-1)",
                fontSize: 12,
                cursor: "pointer",
                outline: "none",
              }}
            >
              {DURATION_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Size filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{ fontSize: 12, color: "var(--v2-text-2)", fontWeight: 500 }}
          >
            Size:
          </span>
          <select
            value={filters.size}
            onChange={(e) => setFilters({ ...filters, size: e.target.value })}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--v2-surface-bright)",
              background: "var(--v2-surface-container)",
              color: "var(--v2-text-1)",
              fontSize: 12,
              cursor: "pointer",
              outline: "none",
            }}
          >
            {SIZE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Date filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{ fontSize: 12, color: "var(--v2-text-2)", fontWeight: 500 }}
          >
            Added:
          </span>
          <select
            value={filters.date}
            onChange={(e) => setFilters({ ...filters, date: e.target.value })}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--v2-surface-bright)",
              background: "var(--v2-surface-container)",
              color: "var(--v2-text-1)",
              fontSize: 12,
              cursor: "pointer",
              outline: "none",
            }}
          >
            {DATE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Unused only filter */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid",
            borderColor: filters.unusedOnly
              ? "rgba(var(--v2-accent-rgb), 0.4)"
              : "var(--v2-surface-bright)",
            background: filters.unusedOnly
              ? "rgba(var(--v2-accent-rgb), 0.1)"
              : "var(--v2-surface-container)",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--v2-text-1)",
            cursor: "pointer",
            transition: "all 0.2s ease",
            userSelect: "none",
          }}
          onMouseEnter={(e) => {
            if (!filters.unusedOnly) {
              e.currentTarget.style.background = "var(--v2-surface-bright)";
            }
          }}
          onMouseLeave={(e) => {
            if (!filters.unusedOnly) {
              e.currentTarget.style.background = "var(--v2-surface-container)";
            }
          }}
        >
          <input
            type="checkbox"
            checked={filters.unusedOnly}
            onChange={(e) =>
              setFilters({ ...filters, unusedOnly: e.target.checked })
            }
            style={{
              width: 14,
              height: 14,
              cursor: "pointer",
              accentColor: "var(--v2-accent)",
            }}
          />
          <span>Unused only</span>
        </label>

        {/* Clear filters button */}
        {hasActiveFilters && (
          <button
            onClick={handleClearFilters}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--v2-surface-bright)",
              background: "var(--v2-surface-container)",
              color: "var(--v2-text-2)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--v2-surface-bright)";
              e.currentTarget.style.color = "var(--v2-text-1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--v2-surface-container)";
              e.currentTarget.style.color = "var(--v2-text-2)";
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              filter_alt_off
            </span>
            Clear filters
          </button>
        )}

        {/* Result count */}
        <div
          style={{
            marginLeft: "auto",
            fontSize: 13,
            color: "var(--v2-text-2)",
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {mediaAssets.length} {mediaAssets.length === 1 ? "asset" : "assets"}{" "}
          found
        </div>
      </div>

      {/* Media grid or empty state */}
      {mediaAssets.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "80px 20px",
            borderRadius: 16,
            background: "var(--v2-surface-container)",
            border: "1px solid var(--v2-surface-bright)",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 48,
              color: "rgba(var(--v2-text-2-rgb), 0.2)",
              marginBottom: 16,
            }}
          >
            video_library
          </span>
          <p
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--v2-text-1)",
              margin: "0 0 8px 0",
            }}
          >
            {hasActiveFilters
              ? "No assets match your filters"
              : "No media files"}
          </p>
          <p
            style={{
              fontSize: 13,
              color: "var(--v2-text-2)",
              margin: 0,
              textAlign: "center",
              maxWidth: 400,
            }}
          >
            {hasActiveFilters
              ? "Try adjusting your search or filters to see more results."
              : category
                ? `No ${CATEGORY_FILTERS.find((f) => f.value === category)?.label.toLowerCase()} found. Try selecting a different category or upload new media assets.`
                : "Upload video, audio, or image assets to get started. Media files can be reused across multiple jobs."}
          </p>
        </div>
      ) : (
        <div
          ref={parentRef}
          style={{
            height: "calc(100vh - 300px)",
            overflow: "auto",
            borderRadius: 12,
            border: "1px solid var(--v2-surface-bright)",
            background: "var(--v2-surface-container)",
          }}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const asset = mediaAssets[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: "50%",
                    transform: `translateX(-50%) translateY(${virtualItem.start}px)`,
                    width: "100%",
                    maxWidth: "200px",
                    padding: "10px",
                  }}
                >
                  <MediaAssetCard
                    asset={asset}
                    onEdit={onEdit}
                    selectionMode={selectionMode}
                    isSelected={selectedIds.has(asset.id)}
                    onToggleSelect={handleToggleSelect}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bulk delete confirmation modal */}
      <BulkDeleteModal
        open={showDeleteModal}
        assets={mediaAssets.filter((a) => selectedIds.has(a.id))}
        onConfirm={handleBulkDelete}
        onCancel={() => setShowDeleteModal(false)}
      />

      {/* Bulk add tags modal */}
      <BulkTagModal
        open={showTagModal}
        assetCount={selectedIds.size}
        onConfirm={handleBulkAddTags}
        onCancel={() => setShowTagModal(false)}
      />
    </div>
  );
}
