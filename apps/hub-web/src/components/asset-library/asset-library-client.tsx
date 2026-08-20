"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import {
  Search,
  Upload,
  Image as ImageIcon,
  ChevronDown,
  LayoutGrid,
  List,
  Check,
  Pencil,
  Trash2,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AssetCard, type AssetCardAsset } from "./asset-card";
import { AssetUploadDrawer } from "./asset-upload-drawer";
import { AssetEditModal } from "./asset-edit-modal";
import { MediaFilesTab } from "./media-files-tab";
import { BatchUploadProgress, type UploadItem } from "./batch-upload-progress";

interface Archetype {
  id: string;
  name: string;
}

interface Character {
  id: string;
  name: string;
}

interface Channel {
  id: string;
  name: string;
}

interface AssetLibraryClientProps {
  initialAssets: AssetCardAsset[];
  initialArchetypes: Archetype[];
  initialCharacters?: Character[];
  initialChannels?: Channel[];
}

const ASSET_TYPE_FILTERS = [
  { value: "", label: "All" },
  { value: "style_guide", label: "Style Guide" },
  { value: "character", label: "Character" },
  { value: "character_state", label: "Character State" },
  { value: "background", label: "Background" },
  { value: "object", label: "Object" },
  { value: "prompt_template", label: "Prompt Template" },
  { value: "color_palette", label: "Color Palette" },
];

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "deprecated", label: "Deprecated" },
];

type SortKey = "name" | "asset_type" | "status" | "created_at" | "size_bytes";
type SortDir = "asc" | "desc";

// ---- Helpers ----

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function StarRating({ rating }: { rating: number | null | undefined }) {
  if (rating == null) return <span className="text-text-muted/40">—</span>;
  return (
    <span className="text-xs tracking-tight text-warning/80">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i}>{i < rating ? "★" : "☆"}</span>
      ))}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "approved"
      ? "bg-success/15 text-success border-success/30"
      : status === "draft"
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-surface-bright/40 text-text-muted/60 border-surface-bright";
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize",
        cls,
      )}
    >
      {status}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const label = type.replace(/_/g, " ");
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-primary/10 text-primary border-primary/20 capitalize">
      {label}
    </span>
  );
}

// ---- Table view ----

interface TableViewProps {
  assets: AssetCardAsset[];
  archetypeMap: Record<string, string>;
  onEdit: (asset: AssetCardAsset) => void;
  onApprove: (id: string) => void;
  onDelete: (id: string) => void;
}

function TableView({
  assets,
  archetypeMap,
  onEdit,
  onApprove,
  onDelete,
}: TableViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    return [...assets].sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      switch (sortKey) {
        case "name":
          av = a.name;
          bv = b.name;
          break;
        case "asset_type":
          av = a.asset_type;
          bv = b.asset_type;
          break;
        case "status":
          av = a.status;
          bv = b.status;
          break;
        case "created_at":
          av = a.created_at;
          bv = b.created_at;
          break;
        case "size_bytes":
          av = a.size_bytes ?? 0;
          bv = b.size_bytes ?? 0;
          break;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [assets, sortKey, sortDir]);

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col)
      return <ChevronDown className="w-3 h-3 opacity-30 ml-1 inline-block" />;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 ml-1 inline-block text-primary" />
    ) : (
      <ChevronDown className="w-3 h-3 ml-1 inline-block text-primary" />
    );
  };

  const sortableTh = (col: SortKey, label: string) => (
    <th
      className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-text-muted cursor-pointer select-none hover:text-text transition-colors"
      onClick={() => handleSort(col)}
    >
      {label}
      <SortIcon col={col} />
    </th>
  );

  return (
    <div className="glass-card rounded-xl overflow-hidden border border-surface-bright">
      <table className="w-full border-collapse">
        <thead className="border-b border-surface-bright bg-surface-container/50">
          <tr>
            <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-text-muted w-10">
              {/* thumbnail */}
            </th>
            {sortableTh("name", "Name")}
            {sortableTh("asset_type", "Type")}
            <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              Archetype
            </th>
            {sortableTh("status", "Status")}
            <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              Quality
            </th>
            {sortableTh("size_bytes", "Size")}
            {sortableTh("created_at", "Created")}
            <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((asset) => (
            <tr
              key={asset.id}
              onClick={() => onEdit(asset)}
              className="border-b border-surface-bright/50 transition-colors hover:bg-surface-bright/30 cursor-pointer"
            >
              {/* Thumbnail */}
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <div className="w-10 h-10 rounded overflow-hidden bg-surface-bright/30 flex-shrink-0">
                  {asset.id ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/assets/${asset.id}`}
                      alt={asset.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display =
                          "none";
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-4 h-4 text-text-muted/30" />
                    </div>
                  )}
                </div>
              </td>

              {/* Name */}
              <td className="px-3 py-2 font-medium text-text text-sm max-w-[180px]">
                <span className="block truncate">{asset.name}</span>
              </td>

              {/* Type */}
              <td className="px-3 py-2">
                <TypeBadge type={asset.asset_type} />
              </td>

              {/* Archetype */}
              <td className="px-3 py-2 text-sm text-text-muted">
                {asset.archetype_id
                  ? (archetypeMap[asset.archetype_id] ?? "—")
                  : "—"}
              </td>

              {/* Status */}
              <td className="px-3 py-2">
                <StatusBadge status={asset.status} />
              </td>

              {/* Quality */}
              <td className="px-3 py-2">
                <StarRating rating={asset.quality_rating} />
              </td>

              {/* Size */}
              <td className="px-3 py-2 text-sm text-text-muted whitespace-nowrap">
                {formatBytes(asset.size_bytes)}
              </td>

              {/* Created */}
              <td className="px-3 py-2 text-sm text-text-muted whitespace-nowrap">
                {asset.created_at
                  ? new Date(asset.created_at).toLocaleDateString()
                  : "—"}
              </td>

              {/* Actions */}
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-end gap-1">
                  {asset.status !== "approved" && (
                    <button
                      onClick={() => onApprove(asset.id)}
                      title="Approve"
                      className="p-1.5 rounded hover:bg-surface-bright text-text-muted hover:text-success transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => onEdit(asset)}
                    title="Edit"
                    className="p-1.5 rounded hover:bg-surface-bright text-text-muted hover:text-text transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(asset.id)}
                    title="Delete"
                    className="p-1.5 rounded hover:bg-surface-bright text-text-muted hover:text-error transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Main component ----

export function AssetLibraryClient({
  initialAssets,
  initialArchetypes,
  initialChannels = [],
}: AssetLibraryClientProps) {
  const [assets, setAssets] = useState<AssetCardAsset[]>(initialAssets);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [archetypeFilter, setArchetypeFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetCardAsset | null>(null);
  const [view, setView] = useState<"grid" | "table">("grid");
  const [activeTab, setActiveTab] = useState<"templates" | "media">(
    "templates",
  ); // NEW: Tab state
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [showUploadProgress, setShowUploadProgress] = useState(false);
  const batchFileInputRef = useRef<HTMLInputElement>(null);

  // Build archetype id→name map for table view
  const archetypeMap = useMemo<Record<string, string>>(
    () => Object.fromEntries(initialArchetypes.map((a) => [a.id, a.name])),
    [initialArchetypes],
  );

  // ---- Client-side filtering (no extra API calls) ----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (
        q &&
        !a.name.toLowerCase().includes(q) &&
        !a.description.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (typeFilter && a.asset_type !== typeFilter) return false;
      if (statusFilter && a.status !== statusFilter) return false;
      if (archetypeFilter && a.archetype_id !== archetypeFilter) return false;
      return true;
    });
  }, [assets, search, typeFilter, statusFilter, archetypeFilter]);

  // ---- Approve ----
  const handleApprove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      if (!res.ok) return;
      const json = await res.json();
      setAssets((prev) =>
        prev.map((a) => (a.id === id ? (json.asset as AssetCardAsset) : a)),
      );
    } catch {
      // silently ignore — user will see status unchanged
    }
  }, []);

  // ---- Delete ----
  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this asset? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        alert(json.error ?? "Delete failed");
        return;
      }
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch {
      alert("Delete failed");
    }
  }, []);

  // ---- After upload ----
  const handleAssetCreated = useCallback((asset: AssetCardAsset) => {
    setAssets((prev) => [asset, ...prev]);
  }, []);

  // ---- After edit ----
  const handleAssetUpdated = useCallback((updated: AssetCardAsset) => {
    setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }, []);

  // ---- Batch upload handler ----
  const handleBatchUpload = useCallback(async (files: FileList | File[]) => {
    const filesArray = Array.from(files);
    if (filesArray.length === 0) return;

    // Initialize upload queue
    const items: UploadItem[] = filesArray.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      progress: 0,
      status: "pending" as const,
      error: null,
    }));

    setUploadQueue(items);
    setShowUploadProgress(true);

    // Upload with concurrency limit (3 at a time)
    const concurrency = 3;
    const uploadFile = async (item: UploadItem) => {
      // Update status to uploading
      setUploadQueue((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: "uploading" as const } : i,
        ),
      );

      try {
        const formData = new FormData();
        formData.append("file", item.file);

        // Detect asset type from file
        const fileType = item.file.type.split("/")[0];
        const assetType = ["video", "audio", "image"].includes(fileType)
          ? fileType
          : "image";

        formData.append("asset_type", assetType);
        formData.append("name", item.file.name);
        formData.append("description", `Uploaded ${assetType} file`);
        formData.append("origin", "real");
        formData.append("status", "draft");

        // Upload with progress tracking (XMLHttpRequest for progress events)
        const xhr = new XMLHttpRequest();

        await new Promise<void>((resolve, reject) => {
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              const percentComplete = (e.loaded / e.total) * 90; // 0-90% for upload
              setUploadQueue((prev) =>
                prev.map((i) =>
                  i.id === item.id ? { ...i, progress: percentComplete } : i,
                ),
              );
            }
          });

          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              // Processing phase (90-100%)
              setUploadQueue((prev) =>
                prev.map((i) =>
                  i.id === item.id
                    ? { ...i, status: "processing" as const, progress: 95 }
                    : i,
                ),
              );

              try {
                const response = JSON.parse(xhr.responseText);
                // Success
                setUploadQueue((prev) =>
                  prev.map((i) =>
                    i.id === item.id
                      ? {
                          ...i,
                          status: "success" as const,
                          progress: 100,
                          assetId: response.asset?.id,
                        }
                      : i,
                  ),
                );

                if (response.asset) {
                  // Add to assets list (optimistic UI)
                  setAssets((prev) => [response.asset, ...prev]);
                }

                resolve();
              } catch (err) {
                setUploadQueue((prev) =>
                  prev.map((i) =>
                    i.id === item.id
                      ? {
                          ...i,
                          status: "error" as const,
                          error: "Invalid response",
                        }
                      : i,
                  ),
                );
                reject(err);
              }
            } else {
              // Error response
              let errorMessage = "Upload failed";
              try {
                const response = JSON.parse(xhr.responseText);
                errorMessage = response.error || errorMessage;
              } catch {}

              setUploadQueue((prev) =>
                prev.map((i) =>
                  i.id === item.id
                    ? { ...i, status: "error" as const, error: errorMessage }
                    : i,
                ),
              );
              reject(new Error(errorMessage));
            }
          });

          xhr.addEventListener("error", () => {
            setUploadQueue((prev) =>
              prev.map((i) =>
                i.id === item.id
                  ? { ...i, status: "error" as const, error: "Network error" }
                  : i,
              ),
            );
            reject(new Error("Network error"));
          });

          xhr.open("POST", "/api/assets");
          xhr.send(formData);
        });
      } catch (err) {
        // Error handled in xhr callbacks
      }
    };

    // Process uploads in batches of 3
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      await Promise.all(batch.map((item) => uploadFile(item)));
    }
  }, []);

  // ---- Retry failed upload ----
  const handleRetryUpload = useCallback(
    (itemId: string) => {
      const item = uploadQueue.find((i) => i.id === itemId);
      if (!item) return;

      // Reset item and re-upload
      setUploadQueue((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? { ...i, status: "pending" as const, progress: 0, error: null }
            : i,
        ),
      );

      handleBatchUpload([item.file]);
    },
    [uploadQueue, handleBatchUpload],
  );

  // ---- Batch file input handler ----
  const handleBatchFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) {
        handleBatchUpload(files);
      }
      // Reset input
      if (batchFileInputRef.current) {
        batchFileInputRef.current.value = "";
      }
    },
    [handleBatchUpload],
  );

  const approvedCount = assets.filter((a) => a.status === "approved").length;

  return (
    <div className="flex gap-6 items-start">
      {/* ---- Left sidebar ---- */}
      <aside className="w-60 flex-shrink-0 space-y-5 sticky top-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted/50 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/50 focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* Asset Type filter */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">
            Asset Type
          </p>
          <div className="flex flex-col gap-1">
            {ASSET_TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={cn(
                  "text-left px-3 py-1.5 rounded-lg text-sm transition-colors",
                  typeFilter === f.value
                    ? "bg-primary/20 text-primary font-medium"
                    : "text-text-muted hover:text-text hover:bg-surface-bright",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Status filter */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">
            Status
          </p>
          <div className="flex flex-col gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={cn(
                  "text-left px-3 py-1.5 rounded-lg text-sm transition-colors",
                  statusFilter === f.value
                    ? "bg-primary/20 text-primary font-medium"
                    : "text-text-muted hover:text-text hover:bg-surface-bright",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Archetype filter */}
        {initialArchetypes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">
              Archetype
            </p>
            <div className="relative">
              <select
                value={archetypeFilter}
                onChange={(e) => setArchetypeFilter(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text appearance-none focus:outline-none focus:border-primary/50 pr-9"
              >
                <option value="">All</option>
                {initialArchetypes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="glass-card rounded-xl p-4 space-y-2 border border-primary/10">
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">
            Library Stats
          </p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Total</span>
            <span className="font-bold text-text">{assets.length}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Approved</span>
            <span className="font-bold text-success">{approvedCount}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Draft</span>
            <span className="font-bold text-warning">
              {assets.filter((a) => a.status === "draft").length}
            </span>
          </div>
        </div>
      </aside>

      {/* ---- Main area ---- */}
      <div className="flex-1 min-w-0 space-y-5">
        {/* NEW: Tab switcher */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("templates")}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
              activeTab === "templates"
                ? "bg-primary/20 text-primary"
                : "bg-surface-container text-text-muted hover:text-text hover:bg-surface-bright",
            )}
          >
            Templates
          </button>
          <button
            onClick={() => setActiveTab("media")}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
              activeTab === "media"
                ? "bg-primary/20 text-primary"
                : "bg-surface-container text-text-muted hover:text-text hover:bg-surface-bright",
            )}
          >
            Media Files
          </button>
        </div>

        {/* Conditional content based on active tab */}
        {activeTab === "templates" ? (
          <>
            {/* Top bar */}
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-text-muted">
                <span className="font-semibold text-text">
                  {filtered.length}
                </span>{" "}
                {filtered.length === 1 ? "asset" : "assets"}
                {(typeFilter || statusFilter || archetypeFilter || search) && (
                  <span className="ml-1 text-text-muted/60">(filtered)</span>
                )}
              </p>

              <div className="flex items-center gap-2">
                {/* View toggle */}
                <div className="flex items-center rounded-lg border border-surface-bright overflow-hidden">
                  {(["grid", "table"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      title={v === "grid" ? "Grid view" : "Table view"}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                        view === v
                          ? "bg-primary/20 text-primary"
                          : "text-text-muted hover:text-text hover:bg-surface-bright",
                      )}
                    >
                      {v === "grid" ? (
                        <LayoutGrid className="w-3.5 h-3.5" />
                      ) : (
                        <List className="w-3.5 h-3.5" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Upload buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDrawerOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 shadow-[0_0_15px_hsl(var(--primary)/0.3)] transition-all"
                  >
                    <Upload className="w-4 h-4" />
                    Upload Asset
                  </button>

                  {/* Batch upload button (media only) */}
                  {(activeTab as string) === "media" && (
                    <>
                      <input
                        ref={batchFileInputRef}
                        type="file"
                        multiple
                        accept="video/*,audio/*,image/*"
                        onChange={handleBatchFileSelect}
                        style={{ display: "none" }}
                      />
                      <button
                        onClick={() => batchFileInputRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-bright text-text text-sm font-semibold hover:bg-surface-bright/80 border border-surface-bright transition-all"
                      >
                        <Upload className="w-4 h-4" />
                        Batch Upload
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Empty state */}
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-text-muted glass-card rounded-2xl">
                <ImageIcon className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-base font-semibold text-text mb-1">
                  No assets found
                </p>
                <p className="text-sm text-text-muted">
                  {assets.length === 0
                    ? "Upload your first asset to get started."
                    : "Try adjusting your filters."}
                </p>
              </div>
            ) : view === "grid" ? (
              /* Grid view */
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {filtered.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    onEdit={setEditingAsset}
                    onApprove={handleApprove}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            ) : (
              /* Table view */
              <TableView
                assets={filtered}
                archetypeMap={archetypeMap}
                onEdit={setEditingAsset}
                onApprove={handleApprove}
                onDelete={handleDelete}
              />
            )}
          </>
        ) : (
          /* NEW: Media Files Tab */
          <MediaFilesTab assets={assets} onEdit={setEditingAsset} />
        )}
      </div>

      {/* ---- Upload Drawer ---- */}
      <AssetUploadDrawer
        open={drawerOpen}
        archetypes={initialArchetypes}
        channels={initialChannels}
        onClose={() => setDrawerOpen(false)}
        onAssetCreated={handleAssetCreated}
      />

      {/* ---- Edit Modal ---- */}
      <AssetEditModal
        asset={editingAsset}
        onClose={() => setEditingAsset(null)}
        onUpdated={handleAssetUpdated}
      />

      {/* ---- Batch Upload Progress ---- */}
      {showUploadProgress && uploadQueue.length > 0 && (
        <BatchUploadProgress
          items={uploadQueue}
          onRetry={handleRetryUpload}
          onClose={() => setShowUploadProgress(false)}
        />
      )}
    </div>
  );
}
