"use client";

import { useState, useCallback, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  libraryId: string;
  initialTagVocabulary: Record<string, string[]>;
  initialName: string;
  initialDescription: string;
  initialIsActive: boolean;
}

// ── Tag vocabulary sections ───────────────────────────────────────────────────

const TAG_SECTIONS = [
  { key: "characters", label: "Characters", icon: "person", color: "#a78bfa" },
  { key: "mood", label: "Moods", icon: "mood", color: "#34d399" },
  {
    key: "location",
    label: "Locations",
    icon: "location_on",
    color: "#60a5fa",
  },
  { key: "action", label: "Actions", icon: "play_circle", color: "#f97316" },
  { key: "custom", label: "Custom", icon: "label", color: "#f59e0b" },
] as const;

// ── Tag Section Component ─────────────────────────────────────────────────────

function TagSection({
  sectionKey,
  label,
  icon,
  color,
  tags,
  onAdd,
  onRemove,
}: {
  sectionKey: string;
  label: string;
  icon: string;
  color: string;
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [inputValue, setInputValue] = useState("");

  function handleAdd() {
    const trimmed = inputValue.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onAdd(trimmed);
    setInputValue("");
  }

  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
        overflow: "hidden",
      }}
    >
      {/* Section header */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "rgba(255,255,255,0.02)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 16, color }}
          >
            {icon}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#e5e2e1" }}>
            {label}
          </span>
          <span
            style={{
              padding: "2px 7px",
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
              background: `${color}18`,
              color,
              border: `1px solid ${color}30`,
            }}
          >
            {tags.length}
          </span>
        </div>
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 18,
            color: "rgba(205,195,215,0.4)",
            transition: "transform 0.2s",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          expand_more
        </span>
      </button>

      {/* Section body */}
      {open && (
        <div
          style={{
            padding: "14px 16px",
            background: "rgba(255,255,255,0.01)",
            borderTop: "1px solid rgba(var(--v2-accent-rgb),0.06)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Tags */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {tags.length === 0 ? (
              <p
                style={{
                  color: "rgba(205,195,215,0.3)",
                  fontSize: 12,
                  margin: 0,
                  fontStyle: "italic",
                }}
              >
                No tags yet
              </p>
            ) : (
              tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 10px",
                    borderRadius: 5,
                    fontSize: 12,
                    fontWeight: 600,
                    background: `${color}18`,
                    color,
                    border: `1px solid ${color}30`,
                  }}
                >
                  {tag}
                  <button
                    onClick={() => onRemove(tag)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      color,
                      opacity: 0.6,
                    }}
                    title={`Remove "${tag}"`}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14 }}
                    >
                      close
                    </span>
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Add tag input */}
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              placeholder={`Add ${label.toLowerCase().slice(0, -1)} tag...`}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: 6,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
                color: "#e5e2e1",
                fontSize: 12,
                outline: "none",
              }}
            />
            <button
              onClick={handleAdd}
              disabled={!inputValue.trim()}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                cursor: !inputValue.trim() ? "not-allowed" : "pointer",
                background: !inputValue.trim()
                  ? "rgba(var(--v2-accent-rgb),0.3)"
                  : `${color}20`,
                color: !inputValue.trim() ? "rgba(205,195,215,0.3)" : color,
                border: `1px solid ${color}30`,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                add
              </span>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Format Configs section ────────────────────────────────────────────────────

const FORMAT_OPTIONS = [
  "VIDEO_ESSAY",
  "CASUALLY_EXPLAINED",
  "EXPLAINER",
  "TECH_COMPARISON",
  "DOCUMENTARY",
  "BUNDESTAG",
] as const;

const FORMAT_COLORS: Record<string, string> = {
  VIDEO_ESSAY: "#60a5fa",
  CASUALLY_EXPLAINED: "#34d399",
  EXPLAINER: "#a78bfa",
  TECH_COMPARISON: "#f59e0b",
  DOCUMENTARY: "#06b6d4",
  BUNDESTAG: "#e879f9",
};

interface ClipLibraryConfig {
  id: string;
  format: string;
  clip_selection_enabled: boolean;
  hitl_clip_review: boolean;
  clips_per_sentence: number;
  min_gap_before_repeat: number;
  character_continuity: string;
  broll_fallback_enabled: boolean;
}

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        width: 34,
        height: 18,
        borderRadius: 9,
        border: "none",
        cursor: "pointer",
        background: value ? "var(--v2-accent)" : "rgba(255,255,255,0.1)",
        position: "relative",
        transition: "background 0.2s",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 2,
          left: value ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.2s",
        }}
      />
    </button>
  );
}

function FormatConfigsSection({ libraryId }: { libraryId: string }) {
  const [configs, setConfigs] = useState<ClipLibraryConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [newFormat, setNewFormat] = useState<string>("VIDEO_ESSAY");
  const [newClipSelection, setNewClipSelection] = useState(true);
  const [newHitlReview, setNewHitlReview] = useState(true);
  const [newClipsPerSentence, setNewClipsPerSentence] = useState(1);
  const [newMinGap, setNewMinGap] = useState(5);
  const [newCharContinuity, setNewCharContinuity] = useState<
    "off" | "soft" | "strict"
  >("soft");

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch(`/api/clip-library/${libraryId}/configs`);
      if (res.ok) {
        const data = (await res.json()) as { configs: ClipLibraryConfig[] };
        setConfigs(data.configs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [libraryId]);

  useEffect(() => {
    void fetchConfigs();
  }, [fetchConfigs]);

  async function handleAdd() {
    if (adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/clip-library/${libraryId}/configs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: newFormat,
          clip_selection_enabled: newClipSelection,
          hitl_clip_review: newHitlReview,
          clips_per_sentence: newClipsPerSentence,
          min_gap_before_repeat: newMinGap,
          character_continuity: newCharContinuity,
          broll_fallback_enabled: true,
          playbook: {
            format: newFormat,
            system_prompt_addendum: "",
            clips_per_sentence: newClipsPerSentence,
            preferred_shot_scales: [],
            avoid_audio_classes: [],
            character_continuity: newCharContinuity,
            min_clip_duration_ms: 1500,
            max_clip_duration_ms: 8000,
            transition_style: "cut",
            music_volume: 0.3,
            music_ducking_volume: 0.08,
            visual_mode: "full_screen",
          },
        }),
      });
      const data = (await res.json()) as {
        config?: ClipLibraryConfig;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setConfigs((prev) => [...prev, data.config!]);
      setShowAddForm(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add config");
    } finally {
      setAdding(false);
    }
  }

  const accentColor = "rgba(var(--v2-accent-rgb),0.08)";

  return (
    <div
      style={{
        padding: 20,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h2
            style={{
              color: "#e5e2e1",
              fontSize: 12,
              fontWeight: 700,
              margin: "0 0 4px 0",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Format Configs
          </h2>
          <p
            style={{ color: "rgba(205,195,215,0.4)", fontSize: 11, margin: 0 }}
          >
            Controls which content formats use this library for clip selection.
          </p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              background: accentColor,
              color: "var(--v2-accent)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.25)",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14 }}
            >
              add
            </span>
            Add Config
          </button>
        )}
      </div>

      {/* Existing configs */}
      {loading ? (
        <p style={{ color: "rgba(205,195,215,0.4)", fontSize: 12, margin: 0 }}>
          Loading…
        </p>
      ) : configs.length === 0 && !showAddForm ? (
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 8,
            background: "rgba(255,200,0,0.05)",
            border: "1px solid rgba(255,200,0,0.15)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 15, color: "#ffc800" }}
          >
            warning
          </span>
          <p
            style={{
              color: "rgba(255,200,0,0.7)",
              fontSize: 11,
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            No format configs — clip selection is disabled for all formats. Add
            a config to enable clip-based rendering for a content format.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {configs.map((cfg) => {
            const color = FORMAT_COLORS[cfg.format] ?? "#cdc3d7";
            return (
              <div
                key={cfg.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.08)",
                }}
              >
                {/* Format badge */}
                <span
                  style={{
                    padding: "3px 8px",
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    background: `${color}18`,
                    color,
                    border: `1px solid ${color}30`,
                    flexShrink: 0,
                  }}
                >
                  {cfg.format.replace(/_/g, " ")}
                </span>

                {/* Toggles */}
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    flex: 1,
                    flexWrap: "wrap",
                  }}
                >
                  <StatusChip
                    on={cfg.clip_selection_enabled}
                    label="Clip Selection"
                  />
                  <StatusChip on={cfg.hitl_clip_review} label="HITL Review" />
                  <span
                    style={{
                      fontSize: 11,
                      color: "rgba(205,195,215,0.5)",
                    }}
                  >
                    {cfg.clips_per_sentence}{" "}
                    {cfg.clips_per_sentence === 1 ? "clip" : "clips"}/sentence
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "rgba(205,195,215,0.5)",
                    }}
                  >
                    continuity: {cfg.character_continuity}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div
          style={{
            padding: "16px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--v2-accent)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: 0,
            }}
          >
            New Format Config
          </p>

          {/* Format selector */}
          <div>
            <label
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "rgba(205,195,215,0.4)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                display: "block",
                marginBottom: 6,
              }}
            >
              Format
            </label>
            <select
              value={newFormat}
              onChange={(e) => setNewFormat(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                color: "#e5e2e1",
                fontSize: 12,
                outline: "none",
                cursor: "pointer",
              }}
            >
              {FORMAT_OPTIONS.map((f) => (
                <option key={f} value={f} style={{ background: "#1a1a2e" }}>
                  {f.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {/* Toggles row */}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Toggle value={newClipSelection} onChange={setNewClipSelection} />
              <span style={{ fontSize: 12, color: "#cdc3d7" }}>
                Clip Selection
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Toggle value={newHitlReview} onChange={setNewHitlReview} />
              <span style={{ fontSize: 12, color: "#cdc3d7" }}>
                HITL Review
              </span>
            </div>
          </div>

          {/* Numeric inputs */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div>
              <label
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Clips / Sentence
              </label>
              <input
                type="number"
                min={1}
                max={5}
                value={newClipsPerSentence}
                onChange={(e) =>
                  setNewClipsPerSentence(parseInt(e.target.value, 10) || 1)
                }
                style={{
                  width: 64,
                  padding: "5px 8px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
                  color: "#e5e2e1",
                  fontSize: 12,
                  outline: "none",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Min Gap Before Repeat
              </label>
              <input
                type="number"
                min={0}
                max={20}
                value={newMinGap}
                onChange={(e) =>
                  setNewMinGap(parseInt(e.target.value, 10) || 0)
                }
                style={{
                  width: 64,
                  padding: "5px 8px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
                  color: "#e5e2e1",
                  fontSize: 12,
                  outline: "none",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "rgba(205,195,215,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Character Continuity
              </label>
              <select
                value={newCharContinuity}
                onChange={(e) =>
                  setNewCharContinuity(
                    e.target.value as "off" | "soft" | "strict",
                  )
                }
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
                  color: "#e5e2e1",
                  fontSize: 12,
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="off" style={{ background: "#1a1a2e" }}>
                  Off
                </option>
                <option value="soft" style={{ background: "#1a1a2e" }}>
                  Soft
                </option>
                <option value="strict" style={{ background: "#1a1a2e" }}>
                  Strict
                </option>
              </select>
            </div>
          </div>

          {addError && (
            <p style={{ fontSize: 11, color: "#ff5050", margin: 0 }}>
              {addError}
            </p>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => void handleAdd()}
              disabled={adding}
              style={{
                padding: "8px 18px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: adding ? "not-allowed" : "pointer",
                background: adding
                  ? "rgba(var(--v2-accent-rgb),0.4)"
                  : "var(--v2-accent)",
                color: "#000",
                border: "none",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 14,
                  animation: adding ? "spin 1.5s linear infinite" : undefined,
                }}
              >
                {adding ? "progress_activity" : "add_circle"}
              </span>
              {adding ? "Adding..." : "Add Config"}
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setAddError(null);
              }}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(205,195,215,0.6)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusChip({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        color: on ? "#00dc82" : "rgba(205,195,215,0.35)",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
        {on ? "check_circle" : "cancel"}
      </span>
      {label}
    </span>
  );
}

// ── VLM Labeling section ──────────────────────────────────────────────────────

interface VlmConfig {
  enabled: boolean;
  lm_studio_url: string;
  lm_studio_token: string;
  lm_studio_model: string;
  concurrency: number;
  vps_host: string;
  vps_user: string;
  ssh_key_path: string;
  vps_media_root: string;
}

interface VlmProgress {
  total: number;
  labeled: number;
  pending: number;
  has_description: number;
  by_step: Record<string, number>;
}

interface DaemonStatus {
  running: boolean;
  pid: number | null;
  logs: string[];
}

const DEFAULT_VLM_CONFIG: VlmConfig = {
  enabled: false,
  lm_studio_url: "",
  lm_studio_token: "",
  lm_studio_model: "",
  concurrency: 1,
  vps_host: "65.108.6.149",
  vps_user: "root",
  ssh_key_path: "~/.ssh/content-forge-key",
  vps_media_root: "/opt/content-forge/media",
};

function VlmLabelingSection({ libraryId }: { libraryId: string }) {
  const [cfg, setCfg] = useState<VlmConfig>(DEFAULT_VLM_CONFIG);
  const [loadingCfg, setLoadingCfg] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [progress, setProgress] = useState<VlmProgress | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [testState, setTestState] = useState<"idle" | "loading" | "ok" | "err">(
    "idle",
  );
  const [testMsg, setTestMsg] = useState("");

  const [daemon, setDaemon] = useState<DaemonStatus>({
    running: false,
    pid: null,
    logs: [],
  });
  const [daemonAction, setDaemonAction] = useState<
    "idle" | "starting" | "stopping"
  >("idle");
  const [daemonError, setDaemonError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const logsEndRef = useCallback((el: HTMLDivElement | null) => {
    el?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load config from DB
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clip-library/${libraryId}/vlm-config`);
        if (res.ok) {
          const data = (await res.json()) as { config: VlmConfig };
          if (data.config) setCfg((prev) => ({ ...prev, ...data.config }));
        }
      } finally {
        setLoadingCfg(false);
      }
    })();
  }, [libraryId]);

  // Poll daemon status + progress
  const fetchDaemonStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/vlm-daemon/status");
      if (res.ok) setDaemon((await res.json()) as DaemonStatus);
    } catch {
      /* non-fatal */
    }
  }, []);

  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/clip-library/${libraryId}/vlm-config/progress`,
      );
      if (res.ok) setProgress((await res.json()) as VlmProgress);
    } catch {
      /* non-fatal */
    }
  }, [libraryId]);

  // Initial fetch
  useEffect(() => {
    void fetchDaemonStatus();
    void fetchProgress();
  }, [fetchDaemonStatus, fetchProgress]);

  // Auto-refresh every 6s while running; every 30s otherwise
  useEffect(() => {
    const interval = setInterval(
      () => {
        void fetchDaemonStatus();
        if (daemon.running) void fetchProgress();
      },
      daemon.running ? 6000 : 30000,
    );
    return () => clearInterval(interval);
  }, [daemon.running, fetchDaemonStatus, fetchProgress]);

  const fetchModels = useCallback(async () => {
    if (!cfg.lm_studio_url) {
      setModels([]);
      return;
    }
    setLoadingModels(true);
    setModelsError(null);
    try {
      const res = await fetch(
        `/api/clip-library/${libraryId}/vlm-config/models`,
      );
      const data = (await res.json()) as { models: string[]; error?: string };
      if (data.error && data.models.length === 0) {
        setModelsError(data.error);
      } else {
        setModels(data.models);
        if (data.models.length > 0 && !cfg.lm_studio_model) {
          setCfg((prev) => ({ ...prev, lm_studio_model: data.models[0] }));
        }
      }
    } catch {
      setModelsError("Could not reach LM Studio proxy");
    } finally {
      setLoadingModels(false);
    }
  }, [libraryId, cfg.lm_studio_url]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleTestConnection() {
    setTestState("loading");
    setTestMsg("");
    try {
      const res = await fetch(
        `/api/clip-library/${libraryId}/vlm-config/models`,
      );
      const data = (await res.json()) as { models: string[]; error?: string };
      if (data.error && data.models.length === 0) {
        setTestState("err");
        setTestMsg(data.error);
      } else {
        setTestState("ok");
        setTestMsg(`Connected — ${data.models.length} model(s) available`);
        setModels(data.models);
      }
    } catch {
      setTestState("err");
      setTestMsg("Request failed");
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/clip-library/${libraryId}/vlm-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSavedAt(new Date());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleStartDaemon() {
    setDaemonAction("starting");
    setDaemonError(null);
    // Save config first so daemon picks up latest settings
    await handleSave();
    try {
      const res = await fetch("/api/vlm-daemon/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ libraryId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setShowLogs(true);
      await fetchDaemonStatus();
    } catch (err) {
      setDaemonError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setDaemonAction("idle");
    }
  }

  async function handleStopDaemon() {
    setDaemonAction("stopping");
    setDaemonError(null);
    try {
      const res = await fetch("/api/vlm-daemon/stop", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await fetchDaemonStatus();
    } catch (err) {
      setDaemonError(err instanceof Error ? err.message : "Failed to stop");
    } finally {
      setDaemonAction("idle");
    }
  }

  function field(
    label: string,
    key: keyof VlmConfig,
    type = "text",
    masked = false,
  ) {
    return (
      <div>
        <label
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "rgba(205,195,215,0.4)",
            textTransform: "uppercase" as const,
            letterSpacing: "0.06em",
            display: "block",
            marginBottom: 5,
          }}
        >
          {label}
        </label>
        <input
          type={masked ? "password" : type}
          value={String(cfg[key] ?? "")}
          onChange={(e) =>
            setCfg((prev) => ({
              ...prev,
              [key]:
                type === "number" ? Number(e.target.value) : e.target.value,
            }))
          }
          style={{
            width: "100%",
            padding: "7px 10px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
            color: "#e5e2e1",
            fontSize: 12,
            outline: "none",
          }}
        />
      </div>
    );
  }

  const pct = progress
    ? Math.round((progress.labeled / Math.max(progress.total, 1)) * 100)
    : 0;

  if (loadingCfg) return null;

  return (
    <div
      style={{
        padding: 20,
        background: "rgba(255,255,255,0.02)",
        border: daemon.running
          ? "1px solid rgba(0,220,130,0.25)"
          : "1px solid rgba(var(--v2-accent-rgb),0.1)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        transition: "border-color 0.3s",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <h2
              style={{
                color: "#e5e2e1",
                fontSize: 12,
                fontWeight: 700,
                margin: 0,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              VLM Labeling
            </h2>
            {/* Running indicator */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 700,
                background: daemon.running
                  ? "rgba(0,220,130,0.12)"
                  : "rgba(255,255,255,0.05)",
                color: daemon.running ? "#00dc82" : "rgba(205,195,215,0.35)",
                border: `1px solid ${daemon.running ? "rgba(0,220,130,0.3)" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: daemon.running
                    ? "#00dc82"
                    : "rgba(205,195,215,0.25)",
                  boxShadow: daemon.running ? "0 0 6px #00dc82" : "none",
                }}
              />
              {daemon.running ? `Running (PID ${daemon.pid})` : "Stopped"}
            </span>
          </div>
          <p
            style={{ color: "rgba(205,195,215,0.4)", fontSize: 11, margin: 0 }}
          >
            Autonomous visual clip labeling via local LM Studio. Runs as a
            background process — no terminal needed.
          </p>
        </div>

        {/* Start / Stop */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 6,
            flexShrink: 0,
          }}
        >
          {!daemon.running ? (
            <button
              onClick={() => void handleStartDaemon()}
              disabled={
                daemonAction !== "idle" ||
                !cfg.lm_studio_url ||
                !cfg.lm_studio_model
              }
              title={
                !cfg.lm_studio_url
                  ? "Configure LM Studio URL first"
                  : !cfg.lm_studio_model
                    ? "Select a model first"
                    : ""
              }
              style={{
                padding: "8px 18px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase" as const,
                letterSpacing: "0.06em",
                cursor:
                  daemonAction !== "idle" &&
                  cfg.lm_studio_url &&
                  cfg.lm_studio_model
                    ? "not-allowed"
                    : "pointer",
                background: "rgba(0,220,130,0.15)",
                color: "#00dc82",
                border: "1px solid rgba(0,220,130,0.35)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 15,
                  animation:
                    daemonAction === "starting"
                      ? "spin 1.5s linear infinite"
                      : undefined,
                }}
              >
                {daemonAction === "starting"
                  ? "progress_activity"
                  : "play_circle"}
              </span>
              {daemonAction === "starting" ? "Starting..." : "Start Labeling"}
            </button>
          ) : (
            <button
              onClick={() => void handleStopDaemon()}
              disabled={daemonAction !== "idle"}
              style={{
                padding: "8px 18px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase" as const,
                letterSpacing: "0.06em",
                cursor: daemonAction !== "idle" ? "not-allowed" : "pointer",
                background: "rgba(255,80,80,0.12)",
                color: "#ff5050",
                border: "1px solid rgba(255,80,80,0.3)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 15,
                  animation:
                    daemonAction === "stopping"
                      ? "spin 1.5s linear infinite"
                      : undefined,
                }}
              >
                {daemonAction === "stopping"
                  ? "progress_activity"
                  : "stop_circle"}
              </span>
              {daemonAction === "stopping" ? "Stopping..." : "Stop"}
            </button>
          )}
          {daemonError && (
            <span
              style={{
                fontSize: 10,
                color: "#ff5050",
                maxWidth: 200,
                textAlign: "right",
              }}
            >
              {daemonError}
            </span>
          )}
        </div>
      </div>

      {/* ── Progress bar ── */}
      {progress && progress.total > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 11, color: "rgba(205,195,215,0.6)" }}>
              Labeling progress
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: pct === 100 ? "#00dc82" : "var(--v2-accent)",
              }}
            >
              {progress.labeled.toLocaleString()} /{" "}
              {progress.total.toLocaleString()} clips ({pct}%)
            </span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: "rgba(255,255,255,0.06)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: pct === 100 ? "#00dc82" : "var(--v2-accent)",
                borderRadius: 3,
                transition: "width 1s ease",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "rgba(205,195,215,0.35)" }}>
              {progress.pending.toLocaleString()} pending
            </span>
            <span style={{ fontSize: 10, color: "rgba(205,195,215,0.35)" }}>
              {progress.has_description.toLocaleString()} with description
            </span>
            <button
              onClick={() => void fetchProgress()}
              style={{
                fontSize: 10,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--v2-accent)",
                padding: 0,
              }}
            >
              refresh
            </button>
          </div>
        </div>
      )}

      {/* ── Log tail ── */}
      <div>
        <button
          onClick={() => {
            setShowLogs((v) => !v);
            if (!showLogs) void fetchDaemonStatus();
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "rgba(205,195,215,0.4)",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 14,
              transform: showLogs ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
            }}
          >
            chevron_right
          </span>
          Live log output{" "}
          {daemon.running && (
            <span style={{ color: "#00dc82", marginLeft: 4 }}>● live</span>
          )}
        </button>

        {showLogs && (
          <div
            style={{
              marginTop: 8,
              borderRadius: 8,
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.06)",
              padding: "10px 12px",
              maxHeight: 200,
              overflowY: "auto",
              fontFamily: "monospace",
            }}
          >
            {daemon.logs.length === 0 ? (
              <p
                style={{
                  color: "rgba(205,195,215,0.3)",
                  fontSize: 11,
                  margin: 0,
                }}
              >
                No log output yet — start the daemon to see output here.
              </p>
            ) : (
              daemon.logs.map((line, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 10.5,
                    lineHeight: 1.6,
                    color:
                      line.includes("[ERR]") || line.includes("error")
                        ? "#ff7070"
                        : line.includes("[WARN]")
                          ? "#ffc800"
                          : line.includes("[OK]") || line.includes("Done")
                            ? "#00dc82"
                            : "rgba(205,195,215,0.7)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {line}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>

      {/* ── LM Studio connection ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "rgba(205,195,215,0.4)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: 0,
          }}
        >
          LM Studio Connection
        </p>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          {field("LM Studio URL", "lm_studio_url")}
          {field("API Token", "lm_studio_token", "text", true)}
        </div>

        {/* Model dropdown */}
        <div>
          <label
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(205,195,215,0.4)",
              textTransform: "uppercase" as const,
              letterSpacing: "0.06em",
              display: "block",
              marginBottom: 5,
            }}
          >
            Model
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={cfg.lm_studio_model}
              onChange={(e) =>
                setCfg((prev) => ({ ...prev, lm_studio_model: e.target.value }))
              }
              style={{
                flex: 1,
                padding: "7px 10px",
                borderRadius: 6,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
                color: "#e5e2e1",
                fontSize: 12,
                outline: "none",
                cursor: "pointer",
              }}
            >
              {cfg.lm_studio_model && !models.includes(cfg.lm_studio_model) && (
                <option
                  value={cfg.lm_studio_model}
                  style={{ background: "#1a1a2e" }}
                >
                  {cfg.lm_studio_model}
                </option>
              )}
              {models.map((m) => (
                <option key={m} value={m} style={{ background: "#1a1a2e" }}>
                  {m}
                </option>
              ))}
              {models.length === 0 && !cfg.lm_studio_model && (
                <option value="" style={{ background: "#1a1a2e" }}>
                  -- load models first --
                </option>
              )}
            </select>
            <button
              onClick={() => void fetchModels()}
              disabled={loadingModels || !cfg.lm_studio_url}
              style={{
                padding: "7px 12px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                cursor:
                  loadingModels || !cfg.lm_studio_url
                    ? "not-allowed"
                    : "pointer",
                background: "rgba(var(--v2-accent-rgb),0.08)",
                color: loadingModels
                  ? "rgba(205,195,215,0.3)"
                  : "var(--v2-accent)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 14,
                  animation: loadingModels
                    ? "spin 1.5s linear infinite"
                    : undefined,
                }}
              >
                {loadingModels ? "progress_activity" : "refresh"}
              </span>
              {loadingModels ? "Loading..." : "Load"}
            </button>
          </div>
          {modelsError && (
            <p style={{ fontSize: 10, color: "#ff5050", margin: "4px 0 0" }}>
              {modelsError}
            </p>
          )}
        </div>

        {/* Concurrency */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(205,195,215,0.4)",
              textTransform: "uppercase" as const,
              letterSpacing: "0.06em",
              flexShrink: 0,
            }}
          >
            Concurrency
          </label>
          <input
            type="range"
            min={1}
            max={4}
            step={1}
            value={cfg.concurrency}
            onChange={(e) =>
              setCfg((prev) => ({
                ...prev,
                concurrency: Number(e.target.value),
              }))
            }
            style={{ flex: 1, accentColor: "var(--v2-accent)" }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--v2-accent)",
              width: 16,
              textAlign: "center",
            }}
          >
            {cfg.concurrency}
          </span>
        </div>

        {/* Test connection */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => void handleTestConnection()}
            disabled={testState === "loading" || !cfg.lm_studio_url}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor:
                testState === "loading" || !cfg.lm_studio_url
                  ? "not-allowed"
                  : "pointer",
              background: "rgba(var(--v2-accent-rgb),0.08)",
              color:
                testState === "loading"
                  ? "rgba(205,195,215,0.3)"
                  : "var(--v2-accent)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 14,
                animation:
                  testState === "loading"
                    ? "spin 1.5s linear infinite"
                    : undefined,
              }}
            >
              {testState === "loading"
                ? "progress_activity"
                : testState === "ok"
                  ? "check_circle"
                  : "wifi_find"}
            </span>
            Test Connection
          </button>
          {testMsg && (
            <span
              style={{
                fontSize: 11,
                color: testState === "ok" ? "#00dc82" : "#ff5050",
              }}
            >
              {testMsg}
            </span>
          )}
        </div>
      </div>

      {/* ── Advanced SSH / VPS ── */}
      <div>
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "rgba(205,195,215,0.4)",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 14,
              transform: showAdvanced ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
            }}
          >
            chevron_right
          </span>
          Advanced SSH / VPS Settings
        </button>

        {showAdvanced && (
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            {field("VPS Host", "vps_host")}
            {field("VPS User", "vps_user")}
            {field("SSH Key Path", "ssh_key_path")}
            {field("VPS Media Root", "vps_media_root")}
          </div>
        )}
      </div>

      {/* ── Save row ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={{
            padding: "8px 20px",
            borderRadius: 7,
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase" as const,
            letterSpacing: "0.06em",
            cursor: saving ? "not-allowed" : "pointer",
            background: saving
              ? "rgba(var(--v2-accent-rgb),0.5)"
              : "var(--v2-accent)",
            color: "#000",
            border: "none",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 14,
              animation: saving ? "spin 1.5s linear infinite" : undefined,
            }}
          >
            {saving ? "progress_activity" : "save"}
          </span>
          {saving ? "Saving..." : "Save Config"}
        </button>
        {saveError && (
          <span style={{ fontSize: 11, color: "#ff5050" }}>{saveError}</span>
        )}
        {savedAt && !saveError && (
          <span style={{ fontSize: 11, color: "#00dc82" }}>
            Saved{" "}
            {savedAt.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Maintenance section ───────────────────────────────────────────────────────

function MaintenanceSection({ libraryId }: { libraryId: string }) {
  const [retagState, setRetagState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [retagCount, setRetagCount] = useState(0);
  const [reembedState, setReembedState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [reembedCount, setReembedCount] = useState(0);
  const [retagError, setRetagError] = useState<string | null>(null);
  const [reembedError, setReembedError] = useState<string | null>(null);

  const handleRetag = useCallback(async () => {
    if (retagState === "loading") return;
    setRetagState("loading");
    setRetagError(null);
    try {
      const res = await fetch(`/api/clip-library/${libraryId}/retag`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRetagCount(data.enqueued ?? 0);
      setRetagState("done");
    } catch (err) {
      setRetagError(err instanceof Error ? err.message : "Failed");
      setRetagState("error");
    }
  }, [libraryId, retagState]);

  const handleReembed = useCallback(async () => {
    if (reembedState === "loading") return;
    setReembedState("loading");
    setReembedError(null);
    try {
      const res = await fetch(`/api/clip-library/${libraryId}/reembed`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setReembedCount(data.enqueued ?? 0);
      setReembedState("done");
    } catch (err) {
      setReembedError(err instanceof Error ? err.message : "Failed");
      setReembedState("error");
    }
  }, [libraryId, reembedState]);

  function ActionButton({
    label,
    icon,
    description,
    state,
    doneLabel,
    error,
    onClick,
    color,
  }: {
    label: string;
    icon: string;
    description: string;
    state: "idle" | "loading" | "done" | "error";
    doneLabel: string;
    error: string | null;
    onClick: () => void;
    color: string;
  }) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "12px 16px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb),0.08)",
          borderRadius: 8,
        }}
      >
        <div style={{ flex: 1 }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#e5e2e1",
              margin: "0 0 2px",
            }}
          >
            {label}
          </p>
          <p
            style={{ fontSize: 11, color: "rgba(205,195,215,0.4)", margin: 0 }}
          >
            {description}
          </p>
          {state === "done" && (
            <p
              style={{
                fontSize: 11,
                color: "#00dc82",
                margin: "4px 0 0",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 13 }}
              >
                check_circle
              </span>
              {doneLabel}
            </p>
          )}
          {state === "error" && error && (
            <p style={{ fontSize: 11, color: "#ff5050", margin: "4px 0 0" }}>
              {error}
            </p>
          )}
        </div>
        <button
          onClick={onClick}
          disabled={state === "loading"}
          style={{
            padding: "7px 16px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            cursor: state === "loading" ? "not-allowed" : "pointer",
            background: `${color}18`,
            color: state === "loading" ? "rgba(205,195,215,0.3)" : color,
            border: `1px solid ${color}30`,
            display: "flex",
            alignItems: "center",
            gap: 5,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 14,
              animation:
                state === "loading" ? "spin 1.5s linear infinite" : undefined,
            }}
          >
            {state === "loading" ? "progress_activity" : icon}
          </span>
          {state === "loading" ? "Working..." : label}
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 20,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <h2
          style={{
            color: "#e5e2e1",
            fontSize: 12,
            fontWeight: 700,
            margin: "0 0 4px 0",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Maintenance
        </h2>
        <p style={{ color: "rgba(205,195,215,0.4)", fontSize: 11, margin: 0 }}>
          Bulk operations for clip tag and embedding management.
        </p>
      </div>

      <ActionButton
        label="Re-tag All Clips"
        icon="sell"
        description="Re-assigns vocabulary tags from existing descriptions using Claude. Run after updating tag vocabulary."
        state={retagState}
        doneLabel={`${retagCount} clips queued for re-tagging`}
        error={retagError}
        onClick={() => void handleRetag()}
        color="#a78bfa"
      />

      <ActionButton
        label="Re-embed All Clips"
        icon="database"
        description="Regenerates all clip embeddings. Run after changing the embedding model or fixing dimension issues."
        state={reembedState}
        doneLabel={`${reembedCount} clips queued for re-embedding`}
        error={reembedError}
        onClick={() => void handleReembed()}
        color="#60a5fa"
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LibrarySettingsClient({
  libraryId,
  initialTagVocabulary,
  initialName,
  initialDescription,
  initialIsActive,
}: Props) {
  const [tagVocabulary, setTagVocabulary] = useState<Record<string, string[]>>(
    () => {
      const vocab: Record<string, string[]> = {};
      for (const section of TAG_SECTIONS) {
        vocab[section.key] = initialTagVocabulary[section.key] ?? [];
      }
      return vocab;
    },
  );
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [isActive, setIsActive] = useState(initialIsActive);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  function addTag(section: string, tag: string) {
    setTagVocabulary((prev) => ({
      ...prev,
      [section]: [...(prev[section] ?? []), tag],
    }));
  }

  function removeTag(section: string, tag: string) {
    setTagVocabulary((prev) => ({
      ...prev,
      [section]: (prev[section] ?? []).filter((t) => t !== tag),
    }));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/clip-library/${libraryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag_vocabulary: tagVocabulary,
          name: name.trim(),
          description: description.trim() || null,
          is_active: isActive,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const totalTagCount = Object.values(tagVocabulary).reduce(
    (sum, tags) => sum + tags.length,
    0,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* General settings */}
      <div
        style={{
          padding: 20,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h2
          style={{
            color: "#e5e2e1",
            fontSize: 12,
            fontWeight: 700,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          General
        </h2>

        {/* Name */}
        <div>
          <label
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(205,195,215,0.4)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              display: "block",
              marginBottom: 6,
            }}
          >
            Library Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 7,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
              color: "#e5e2e1",
              fontSize: 13,
              outline: "none",
              width: "100%",
              maxWidth: 400,
            }}
          />
        </div>

        {/* Description */}
        <div>
          <label
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "rgba(205,195,215,0.4)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              display: "block",
              marginBottom: 6,
            }}
          >
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{
              padding: "8px 12px",
              borderRadius: 7,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
              color: "#e5e2e1",
              fontSize: 13,
              outline: "none",
              width: "100%",
              maxWidth: 520,
              resize: "vertical",
            }}
          />
        </div>

        {/* Active toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => setIsActive((v) => !v)}
            style={{
              width: 40,
              height: 22,
              borderRadius: 11,
              border: "none",
              cursor: "pointer",
              background: isActive
                ? "var(--v2-accent)"
                : "rgba(255,255,255,0.1)",
              position: "relative",
              transition: "background 0.2s",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 3,
                left: isActive ? 21 : 3,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#fff",
                transition: "left 0.2s",
              }}
            />
          </button>
          <span
            style={{
              fontSize: 13,
              color: isActive ? "#e5e2e1" : "rgba(205,195,215,0.5)",
              fontWeight: 600,
            }}
          >
            {isActive ? "Library is active" : "Library is inactive"}
          </span>
        </div>
      </div>

      {/* Tag Vocabulary */}
      <div
        style={{
          padding: 20,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h2
              style={{
                color: "#e5e2e1",
                fontSize: 12,
                fontWeight: 700,
                margin: "0 0 4px 0",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Tag Vocabulary
            </h2>
            <p
              style={{
                color: "rgba(205,195,215,0.4)",
                fontSize: 11,
                margin: 0,
              }}
            >
              {totalTagCount} tags across {TAG_SECTIONS.length} categories.
              These are the only valid tags for HITL review.
            </p>
          </div>
          <span
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              background: "rgba(var(--v2-accent-rgb),0.08)",
              color: "var(--v2-accent)",
              border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
            }}
          >
            {totalTagCount} total
          </span>
        </div>

        {/* Warning: removing tags */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "10px 12px",
            background: "rgba(255,200,0,0.06)",
            border: "1px solid rgba(255,200,0,0.2)",
            borderRadius: 8,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 15, color: "#ffc800", flexShrink: 0 }}
          >
            warning
          </span>
          <p
            style={{
              color: "rgba(255,200,0,0.8)",
              fontSize: 11,
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Removing a tag that is already applied to clips will not
            automatically clean up those clips. Existing clips will retain the
            removed tag until manually edited.
          </p>
        </div>

        {/* Sections */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {TAG_SECTIONS.map((section) => (
            <TagSection
              key={section.key}
              sectionKey={section.key}
              label={section.label}
              icon={section.icon}
              color={section.color}
              tags={tagVocabulary[section.key] ?? []}
              onAdd={(tag) => addTag(section.key, tag)}
              onRemove={(tag) => removeTag(section.key, tag)}
            />
          ))}
        </div>
      </div>

      {/* Format Configs */}
      <FormatConfigsSection libraryId={libraryId} />

      {/* VLM Labeling */}
      <VlmLabelingSection libraryId={libraryId} />

      {/* Maintenance */}
      <MaintenanceSection libraryId={libraryId} />

      {/* Save bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 20px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(var(--v2-accent-rgb),0.1)",
          borderRadius: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {error && (
            <span
              style={{
                color: "#ff5050",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15 }}
              >
                error
              </span>
              {error}
            </span>
          )}
          {savedAt && !error && (
            <span
              style={{
                color: "#00dc82",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15 }}
              >
                check_circle
              </span>
              Saved at{" "}
              {savedAt.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
        </div>

        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={{
            padding: "10px 24px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            cursor: saving ? "not-allowed" : "pointer",
            background: saving
              ? "rgba(var(--v2-accent-rgb),0.5)"
              : "var(--v2-accent)",
            color: "#000",
            border: "none",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {saving ? (
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16, animation: "spin 1.5s linear infinite" }}
            >
              progress_activity
            </span>
          ) : (
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              save
            </span>
          )}
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
