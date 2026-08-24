"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { V2Button, V2Input, GlassCard } from "../../_components";
import {
  createTutorialPrompt,
  updateTutorialPrompt,
  updateTutorialSettingsAction,
} from "@/app/actions/tutorial";
import type { TutorialPromptPreset, TutorialSettingsRow } from "@repo/db";
import { TUTORIAL_PROVIDERS } from "@repo/contracts";
import { voiceControlsFor } from "./voice-controls";

type PromptCategory =
  | "THREE_MIN"
  | "SIX_MIN"
  | "SIX_MIN_STITCH"
  | "SHORT_MATCH"
  | "SHORT_PLUS";

interface SettingsProps {
  presets: TutorialPromptPreset[];
  settings: TutorialSettingsRow;
  /** manage:tutorial-settings — full admin. Reserved for admin-only surfaces. */
  canManage: boolean;
  /**
   * edit:tutorial-workflow — a producer VA may tune the workflow settings on
   * this tab (prompts, recording defaults, voice defaults). None of these are
   * secrets; credentials live on the admin /settings page.
   */
  canEditWorkflow: boolean;
}

function PromptLibrary({ presets }: { presets: TutorialPromptPreset[] }) {
  const [activeCategory, setActiveCategory] =
    useState<PromptCategory>("THREE_MIN");
  const [editing, setEditing] = useState<TutorialPromptPreset | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = presets.filter((p) => p.category === activeCategory);
  const seeded = filtered.filter((p) => p.is_seeded);
  const custom = filtered.filter((p) => !p.is_seeded);

  const CATS: Array<{ id: PromptCategory; label: string }> = [
    { id: "THREE_MIN", label: "3-Min" },
    { id: "SHORT_MATCH", label: "Short · Match" },
    { id: "SHORT_PLUS", label: "Short · Plus" },
    { id: "SIX_MIN", label: "6-Min" },
    { id: "SIX_MIN_STITCH", label: "6-Min Stitch" },
  ];

  async function handleCreate() {
    if (!newName.trim() || !newPrompt.trim()) return;
    setSaving(true);
    try {
      const result = await createTutorialPrompt({
        category: activeCategory,
        name: newName.trim(),
        system_prompt: newPrompt.trim(),
      });
      if (result.success) {
        toast.success("Prompt created.");
        setCreating(false);
        setNewName("");
        setNewPrompt("");
      } else {
        toast.error(result.error ?? "Failed to create prompt.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, name: string, system_prompt: string) {
    setSaving(true);
    try {
      const result = await updateTutorialPrompt({ id, name, system_prompt });
      if (result.success) {
        toast.success("Prompt updated.");
        setEditing(null);
      } else {
        toast.error(result.error ?? "Failed to update.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Category tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {CATS.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCategory(c.id)}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              border: "1px solid",
              cursor: "pointer",
              background:
                activeCategory === c.id
                  ? "rgba(var(--v2-accent-rgb), 0.15)"
                  : "transparent",
              borderColor:
                activeCategory === c.id
                  ? "rgba(var(--v2-accent-rgb), 0.4)"
                  : "rgba(255,255,255,0.1)",
              color:
                activeCategory === c.id
                  ? "var(--v2-accent)"
                  : "var(--v2-text-2)",
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Seeded presets (editable) */}
      {seeded.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 8,
            }}
          >
            Default Presets
          </div>
          {seeded.map((p) => (
            <div
              key={p.id}
              style={{
                padding: "10px 14px",
                background: "rgba(255,255,255,0.02)",
                borderRadius: 8,
                marginBottom: 6,
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {editing?.id === p.id ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <input
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                    style={{
                      background: "var(--v2-surface-2)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      color: "var(--v2-text-1)",
                      fontSize: 12,
                    }}
                  />
                  <textarea
                    rows={10}
                    value={editing.system_prompt}
                    onChange={(e) =>
                      setEditing({ ...editing, system_prompt: e.target.value })
                    }
                    style={{
                      background: "var(--v2-surface-2)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      color: "var(--v2-text-1)",
                      fontSize: 12,
                      fontFamily: "inherit",
                      resize: "vertical",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <V2Button
                      size="sm"
                      variant="accent"
                      disabled={saving}
                      onClick={() =>
                        handleUpdate(
                          editing.id,
                          editing.name,
                          editing.system_prompt,
                        )
                      }
                    >
                      {saving ? "Saving…" : "Save"}
                    </V2Button>
                    <V2Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </V2Button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--v2-text-1)",
                        marginBottom: 4,
                      }}
                    >
                      {p.name}
                      {p.is_default && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 9,
                            color: "var(--v2-accent)",
                            fontWeight: 700,
                            textTransform: "uppercase",
                          }}
                        >
                          Default
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--v2-text-2)",
                        whiteSpace: "pre-wrap",
                        maxHeight: 60,
                        overflow: "hidden",
                      }}
                    >
                      {p.system_prompt.slice(0, 200)}
                      {p.system_prompt.length > 200 ? "…" : ""}
                    </div>
                  </div>
                  <V2Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(p)}
                  >
                    Edit
                  </V2Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Custom presets (editable) */}
      {custom.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 8,
            }}
          >
            Your Custom Presets
          </div>
          {custom.map((p) => (
            <div
              key={p.id}
              style={{
                padding: "10px 14px",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 8,
                marginBottom: 6,
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {editing?.id === p.id ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <input
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                    style={{
                      background: "var(--v2-surface-2)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      color: "var(--v2-text-1)",
                      fontSize: 12,
                    }}
                  />
                  <textarea
                    rows={4}
                    value={editing.system_prompt}
                    onChange={(e) =>
                      setEditing({ ...editing, system_prompt: e.target.value })
                    }
                    style={{
                      background: "var(--v2-surface-2)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      color: "var(--v2-text-1)",
                      fontSize: 12,
                      fontFamily: "inherit",
                      resize: "vertical",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <V2Button
                      size="sm"
                      variant="accent"
                      disabled={saving}
                      onClick={() =>
                        handleUpdate(
                          editing.id,
                          editing.name,
                          editing.system_prompt,
                        )
                      }
                    >
                      {saving ? "Saving…" : "Save"}
                    </V2Button>
                    <V2Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </V2Button>
                  </div>
                </div>
              ) : (
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--v2-text-1)",
                        marginBottom: 4,
                      }}
                    >
                      {p.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                      {p.system_prompt.slice(0, 100)}
                      {p.system_prompt.length > 100 ? "…" : ""}
                    </div>
                  </div>
                  <V2Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(p)}
                  >
                    Edit
                  </V2Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create new */}
      {creating ? (
        <div
          style={{
            padding: 16,
            background: "rgba(255,255,255,0.03)",
            borderRadius: 8,
            border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 12,
            }}
          >
            New Prompt for {activeCategory.replace(/_/g, "-")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <V2Input
              label="Name"
              placeholder="e.g. Friendly Step-by-Step"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              fullWidth
            />
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--v2-text-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 6,
                }}
              >
                System Prompt
              </div>
              <textarea
                rows={5}
                placeholder="Write a clear, friendly tutorial script…"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                style={{
                  width: "100%",
                  background: "var(--v2-surface-2)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "var(--v2-text-1)",
                  fontSize: 12,
                  fontFamily: "inherit",
                  resize: "vertical",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <V2Button
                size="sm"
                variant="accent"
                onClick={handleCreate}
                disabled={saving || !newName.trim() || !newPrompt.trim()}
              >
                {saving ? "Creating…" : "Create Prompt"}
              </V2Button>
              <V2Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                  setNewPrompt("");
                }}
              >
                Cancel
              </V2Button>
            </div>
          </div>
        </div>
      ) : (
        <V2Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          + New Custom Prompt
        </V2Button>
      )}
    </div>
  );
}

function RecordingDefaults({ settings }: { settings: TutorialSettingsRow }) {
  const [hotkey, setHotkey] = useState(settings.record_hotkey ?? "F8");
  const [listening, setListening] = useState(false);
  const [speed, setSpeed] = useState(
    Number(settings.default_playback_speed ?? 1),
  );
  const [saving, setSaving] = useState(false);

  // "Click to set, then press a key" capture. While listening, the next
  // keydown becomes the hotkey. We store it in the SAME format Studio compares
  // against (studio.tsx onKey: `const code = e.code === "Space" ? "Space" : e.key`)
  // — Space by its e.code ("Space"), every other key by e.key ("F8", "a", …) —
  // so the value round-trips through the existing matcher unchanged. Escape (or
  // blurring the button) cancels without changing anything.
  useEffect(() => {
    if (!listening) return;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setListening(false);
        return;
      }
      // Ignore a lone modifier press — wait for the actual key.
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      setHotkey(e.code === "Space" ? "Space" : e.key);
      setListening(false);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening]);

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateTutorialSettingsAction({
        record_hotkey: hotkey,
        default_playback_speed: speed,
      });
      if (result.success) {
        toast.success("Recording defaults saved.");
      } else {
        toast.error(result.error ?? "Failed to save.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--v2-text-2)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 8,
          }}
        >
          Record Hotkey
        </div>
        <button
          type="button"
          onClick={() => setListening((v) => !v)}
          onBlur={() => setListening(false)}
          aria-label={
            listening
              ? "Listening — press a key to set the record hotkey, or Escape to cancel"
              : `Record hotkey is ${hotkey}. Click to set a new key.`
          }
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--v2-surface-2)",
            border: listening
              ? "1px solid var(--v2-accent)"
              : "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "8px 12px",
            color: "var(--v2-text-1)",
            fontSize: 12,
            cursor: "pointer",
            outline: "none",
            boxShadow: listening
              ? "0 0 0 3px rgba(var(--v2-accent-rgb), 0.15)"
              : "none",
            textAlign: "left",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 16,
              color: listening ? "var(--v2-accent)" : "var(--v2-text-2)",
            }}
          >
            keyboard
          </span>
          {listening ? (
            <span style={{ color: "var(--v2-accent)", fontWeight: 600 }}>
              Press a key…
            </span>
          ) : (
            <kbd
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 6,
                padding: "2px 8px",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "inherit",
                color: "var(--v2-text-1)",
              }}
            >
              {hotkey}
            </kbd>
          )}
        </button>
        <div style={{ fontSize: 9, color: "var(--v2-text-2)", marginTop: 6 }}>
          Toggles audio play/pause in Studio (default: F8). Click, then press
          the key you want — Esc to cancel.
        </div>
      </div>

      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--v2-text-2)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 8,
          }}
        >
          Default Playback Speed — {speed.toFixed(1)}×
        </div>
        <input
          type="range"
          min="0.5"
          max="2.5"
          step="0.1"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          style={{
            width: "100%",
            accentColor: "var(--v2-accent)",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "var(--v2-text-2)",
            marginTop: 4,
          }}
        >
          <span>0.5×</span>
          <span>1.0×</span>
          <span>1.5×</span>
          <span>2.0×</span>
          <span>2.5×</span>
        </div>
      </div>

      <div>
        <V2Button variant="accent" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Defaults"}
        </V2Button>
      </div>
    </div>
  );
}

function DefaultVoiceSettings({ settings }: { settings: TutorialSettingsRow }) {
  const raw = (settings.default_voice_settings ?? {}) as Record<
    string,
    unknown
  >;
  const [model, setModel] = useState(String(raw.model ?? ""));
  const [speed, setSpeed] = useState<number | "">(
    typeof raw.speed === "number" ? raw.speed : "",
  );
  const [stability, setStability] = useState<number | "">(
    typeof raw.stability === "number" ? raw.stability : "",
  );
  const [similarity, setSimilarity] = useState<number | "">(
    typeof raw.similarity === "number" ? raw.similarity : "",
  );
  const [pitch, setPitch] = useState<number | "">(
    typeof raw.pitch === "number" ? raw.pitch : "",
  );
  const [volume, setVolume] = useState<number | "">(
    typeof raw.volume === "number" ? raw.volume : "",
  );
  const [language, setLanguage] = useState(String(raw.language ?? ""));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const vs: Record<string, unknown> = {};
    if (model.trim()) vs.model = model.trim();
    if (speed !== "") vs.speed = speed;
    if (stability !== "") vs.stability = stability;
    if (similarity !== "") vs.similarity = similarity;
    if (pitch !== "") vs.pitch = pitch;
    if (volume !== "") vs.volume = volume;
    if (language.trim()) vs.language = language.trim();

    try {
      const result = await updateTutorialSettingsAction({
        default_voice_settings: Object.keys(vs).length > 0 ? vs : undefined,
      });
      if (result.success) {
        toast.success("Default voice settings saved.");
      } else {
        toast.error(result.error ?? "Failed to save.");
      }
    } finally {
      setSaving(false);
    }
  }

  function SliderRow({
    label,
    min,
    max,
    step,
    value,
    onChange,
    hint,
  }: {
    label: string;
    min: number;
    max: number;
    step: number;
    value: number | "";
    onChange: (v: number | "") => void;
    hint?: string;
  }) {
    const displayValue =
      value === "" ? "—" : (value as number).toFixed(step < 1 ? 2 : 0);
    return (
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            {label}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontSize: 12,
                color: "var(--v2-text-1)",
                fontWeight: 600,
              }}
            >
              {displayValue}
            </span>
            {value !== "" && (
              <button
                onClick={() => onChange("")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--v2-text-2)",
                  fontSize: 10,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value === "" ? min + (max - min) / 2 : value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: "100%", accentColor: "var(--v2-accent)" }}
        />
        {hint && (
          <div style={{ fontSize: 9, color: "var(--v2-text-2)", marginTop: 3 }}>
            {hint}
          </div>
        )}
      </div>
    );
  }

  // Only render controls the configured engine honours. This page used to show
  // all seven unconditionally, including two labelled "(ElevenLabs)", on a
  // studio whose engine is Fish Audio — every one of them was silently
  // discarded by the worker.
  const provider = settings.default_tts_provider;
  const controls = voiceControlsFor(provider);
  const providerLabel =
    TUTORIAL_PROVIDERS.tts.find((p) => p.id === provider)?.label ?? provider;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
        These apply to all new jobs. Job-level settings override these defaults.
        Only the controls <strong>{providerLabel}</strong> actually applies are
        shown — the rest would be discarded before the audio is made.
      </div>
      {controls.has("model") && (
        <V2Input
          label="Default Model"
          placeholder="Leave blank for provider default"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          fullWidth
        />
      )}
      {controls.has("speed") && (
        <SliderRow
          label="Speed"
          min={0.5}
          max={2.5}
          step={0.05}
          value={speed}
          onChange={setSpeed}
          hint="0.5–2.5; blank = provider default"
        />
      )}
      {controls.has("stability") && (
        <SliderRow
          label="Stability"
          min={0}
          max={1}
          step={0.05}
          value={stability}
          onChange={setStability}
          hint="0–1; blank = provider default"
        />
      )}
      {controls.has("similarity") && (
        <SliderRow
          label="Similarity"
          min={0}
          max={1}
          step={0.05}
          value={similarity}
          onChange={setSimilarity}
          hint="0–1; blank = provider default"
        />
      )}
      {controls.has("pitch") && (
        <SliderRow
          label="Pitch (semitones)"
          min={-12}
          max={12}
          step={1}
          value={pitch}
          onChange={setPitch}
          hint="-12 to +12; blank = provider default"
        />
      )}
      {controls.has("volume") && (
        <SliderRow
          label="Volume"
          min={0}
          max={2}
          step={0.05}
          value={volume}
          onChange={setVolume}
          hint="0–2; blank = provider default"
        />
      )}
      {controls.has("language") && (
        <V2Input
          label="Language / Boost (e.g. en, zh)"
          placeholder="Leave blank for auto-detect"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          fullWidth
        />
      )}
      <V2Button variant="accent" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save Default Voice Settings"}
      </V2Button>
    </div>
  );
}

export function ProductionSettings({
  presets,
  settings,
  canManage,
  canEditWorkflow,
}: SettingsProps) {
  if (!canEditWorkflow) {
    return (
      <GlassCard style={{ padding: 40, textAlign: "center" }}>
        <p style={{ fontSize: 14, color: "var(--v2-text-2)" }}>
          You do not have access to production settings.
        </p>
      </GlassCard>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Provider API keys are no longer entered per-VA. They live in the ONE
          secrets area (Settings → Credentials, admin only). VAs never handle
          keys — and the pointer to the admin page is hidden from them, since
          they cannot open it anyway. */}
      {canManage && (
        <GlassCard style={{ padding: 24 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--v2-text-1)",
              marginBottom: 8,
            }}
          >
            Provider API Keys
          </div>
          <p style={{ fontSize: 12, color: "var(--v2-text-2)", margin: 0 }}>
            API keys are managed centrally by an administrator in{" "}
            <a href="/settings" style={{ color: "var(--v2-accent)" }}>
              Settings → Credentials
            </a>
            . Assistants no longer enter or see keys here.
          </p>
        </GlassCard>
      )}

      {/* Prompt Library */}
      <GlassCard style={{ padding: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--v2-text-1)",
            marginBottom: 16,
          }}
        >
          Prompt Library
        </div>
        <PromptLibrary presets={presets} />
      </GlassCard>

      {/* Recording Defaults */}
      <GlassCard style={{ padding: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--v2-text-1)",
            marginBottom: 16,
          }}
        >
          Recording Defaults
        </div>
        <RecordingDefaults settings={settings} />
      </GlassCard>

      {/* Default Voice Settings */}
      <GlassCard style={{ padding: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--v2-text-1)",
            marginBottom: 16,
          }}
        >
          Default Voice Settings
        </div>
        <DefaultVoiceSettings settings={settings} />
      </GlassCard>

      {/* The "Voice Cloning (AI33) — Coming Soon" card that sat here was
          removed. AI33 is no longer a TTS provider in this system, so the card
          advertised a feature that was not coming: a permanent disabled button
          promising something built on a dependency that had been dropped.
          Cloning against the current engine (Fish) is a different feature and
          belongs here only when it exists. */}
    </div>
  );
}
