"use client";

import { useState } from "react";
import { TTSVoicePicker } from "@/components/tts/tts-voice-picker";

export interface BatchDefaults {
  template_id: string;
  channel_id: string;
  production_version: "V1" | "V2" | "V3";
  subtitles: boolean;
  auto_start: boolean;
  skip_image_qc: boolean;
  skip_final_qc: boolean;
  language: string;
  voice_id?: string; // Optional TTS voice selection
}

interface BatchDefaultsPanelProps {
  templates: Array<{
    id: string;
    name: string;
    format?: string;
    description?: string | null;
  }>;
  channels: Array<{ id: string; name: string; language: string }>;
  defaults: BatchDefaults;
  onChange: (defaults: BatchDefaults) => void;
  format?: string;
}

const PRODUCTION_VERSIONS = [
  { value: "V1" as const, label: "V1", description: "Clean layout" },
  { value: "V2" as const, label: "V2", description: "Biome-based" },
  { value: "V3" as const, label: "V3", description: "Future" },
];

export function BatchDefaultsPanel({
  templates,
  channels,
  defaults,
  onChange,
  format,
}: BatchDefaultsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  function update(partial: Partial<BatchDefaults>) {
    onChange({ ...defaults, ...partial });
  }

  // Hide production version selector for CASUALLY_EXPLAINED (templates encode all rendering decisions)
  const showProductionVersion = format !== "CASUALLY_EXPLAINED";

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
        borderRadius: 12,
      }}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "rgba(205,195,215,0.6)",
          }}
        >
          Batch Defaults
        </span>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 18, color: "rgba(205,195,215,0.6)" }}
        >
          {collapsed ? "chevron_right" : "expand_more"}
        </span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[240px]">
            <label
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "rgba(205,195,215,0.6)",
                marginBottom: 8,
              }}
            >
              Template
            </label>
            <select
              value={defaults.template_id}
              onChange={(e) => update({ template_id: e.target.value })}
              style={{
                width: "100%",
                padding: "12px 14px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                borderRadius: 8,
                color: "#e5e2e1",
                fontSize: 13,
                outline: "none",
              }}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {/* Show selected template description */}
            {templates.find((t) => t.id === defaults.template_id)
              ?.description && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 12px",
                  background: "rgba(var(--v2-accent-rgb), 0.05)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
                  borderRadius: 6,
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: "rgba(205,195,215,0.7)",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 14,
                    verticalAlign: "middle",
                    marginRight: 4,
                  }}
                >
                  info
                </span>
                {
                  templates.find((t) => t.id === defaults.template_id)
                    ?.description
                }
              </div>
            )}
          </div>

          <div className="min-w-[180px]">
            <label
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "rgba(205,195,215,0.6)",
                marginBottom: 8,
              }}
            >
              Channel
            </label>
            <select
              value={defaults.channel_id}
              onChange={(e) => update({ channel_id: e.target.value })}
              style={{
                width: "100%",
                padding: "12px 14px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                borderRadius: 8,
                color: "#e5e2e1",
                fontSize: 13,
                outline: "none",
              }}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[140px]">
            <label
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "rgba(205,195,215,0.6)",
                marginBottom: 8,
              }}
            >
              Language
            </label>
            <select
              value={defaults.language}
              onChange={(e) => update({ language: e.target.value })}
              style={{
                width: "100%",
                padding: "12px 14px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                borderRadius: 8,
                color: "#e5e2e1",
                fontSize: 13,
                outline: "none",
              }}
            >
              <option value="en">English</option>
              <option value="de">German</option>
            </select>
          </div>

          {/* TTS Voice Selection */}
          <div className="flex-1 min-w-[240px]">
            <TTSVoicePicker
              value={defaults.voice_id ?? ""}
              onChange={(voiceId) => update({ voice_id: voiceId })}
              language={defaults.language}
            />
          </div>

          {/* Production Version — Animated multi-select with green swooshing */}
          {/* Hidden for CASUALLY_EXPLAINED — templates encode all rendering decisions */}
          {showProductionVersion && (
            <div className="flex flex-col gap-1">
              <label
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "rgba(205,195,215,0.6)",
                }}
              >
                Production Version
              </label>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  position: "relative",
                  padding: 6,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(var(--v2-accent-rgb), 0.15)",
                  borderRadius: 8,
                }}
              >
                {/* Animated highlight background */}
                <div
                  style={{
                    position: "absolute",
                    top: 6,
                    left:
                      6 +
                      PRODUCTION_VERSIONS.findIndex(
                        (v) => v.value === defaults.production_version,
                      ) *
                        (60 + 6),
                    width: 60,
                    height: 32,
                    background: "var(--v2-accent)",
                    borderRadius: 6,
                    transition: "left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                    zIndex: 0,
                  }}
                />
                {PRODUCTION_VERSIONS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    title={v.description}
                    onClick={() => update({ production_version: v.value })}
                    style={{
                      position: "relative",
                      zIndex: 1,
                      width: 60,
                      height: 32,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "transparent",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      color:
                        defaults.production_version === v.value
                          ? "#000"
                          : "rgba(205,195,215,0.5)",
                      cursor: "pointer",
                      transition: "color 0.2s",
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Button-style toggles (no checkboxes) */}
          <button
            type="button"
            onClick={() => update({ subtitles: !defaults.subtitles })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              background: defaults.subtitles
                ? "rgba(var(--v2-accent-rgb), 0.15)"
                : "rgba(255,255,255,0.03)",
              border: defaults.subtitles
                ? "1px solid rgba(var(--v2-accent-rgb), 0.4)"
                : "1px solid rgba(var(--v2-accent-rgb), 0.1)",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              color: defaults.subtitles
                ? "var(--v2-accent)"
                : "rgba(205,195,215,0.5)",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              {defaults.subtitles ? "check_circle" : "radio_button_unchecked"}
            </span>
            Subtitles
          </button>

          <button
            type="button"
            onClick={() => update({ auto_start: !defaults.auto_start })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              background: defaults.auto_start
                ? "rgba(var(--v2-accent-rgb), 0.15)"
                : "rgba(255,255,255,0.03)",
              border: defaults.auto_start
                ? "1px solid rgba(var(--v2-accent-rgb), 0.4)"
                : "1px solid rgba(var(--v2-accent-rgb), 0.1)",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              color: defaults.auto_start
                ? "var(--v2-accent)"
                : "rgba(205,195,215,0.5)",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              {defaults.auto_start ? "check_circle" : "radio_button_unchecked"}
            </span>
            Auto-start
          </button>

          <button
            type="button"
            onClick={() => update({ skip_image_qc: !defaults.skip_image_qc })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              background: defaults.skip_image_qc
                ? "rgba(var(--v2-accent-rgb), 0.15)"
                : "rgba(255,255,255,0.03)",
              border: defaults.skip_image_qc
                ? "1px solid rgba(var(--v2-accent-rgb), 0.4)"
                : "1px solid rgba(var(--v2-accent-rgb), 0.1)",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              color: defaults.skip_image_qc
                ? "var(--v2-accent)"
                : "rgba(205,195,215,0.5)",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              {defaults.skip_image_qc
                ? "check_circle"
                : "radio_button_unchecked"}
            </span>
            Skip Image QC
          </button>

          <button
            type="button"
            onClick={() => update({ skip_final_qc: !defaults.skip_final_qc })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              background: defaults.skip_final_qc
                ? "rgba(var(--v2-accent-rgb), 0.15)"
                : "rgba(255,255,255,0.03)",
              border: defaults.skip_final_qc
                ? "1px solid rgba(var(--v2-accent-rgb), 0.4)"
                : "1px solid rgba(var(--v2-accent-rgb), 0.1)",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              color: defaults.skip_final_qc
                ? "var(--v2-accent)"
                : "rgba(205,195,215,0.5)",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              {defaults.skip_final_qc
                ? "check_circle"
                : "radio_button_unchecked"}
            </span>
            Skip Final QC
          </button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "rgba(205,195,215,0.5)",
              marginTop: 8,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              info
            </span>
            <span>Rows with scripts will skip AI generation automatically</span>
          </div>
        </div>
      )}
    </div>
  );
}
