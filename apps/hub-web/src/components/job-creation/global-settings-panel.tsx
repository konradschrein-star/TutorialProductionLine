"use client";

import { useState } from "react";
import { useJobPresets, type JobPreset } from "@/lib/hooks/use-job-presets";
import { MusicSelector } from "./music-selector";

interface Channel {
  id: string;
  name: string;
  language: string;
}

interface GlobalSettingsPanelProps {
  templateId: string;
  templateFormat: string;
  channels: Channel[];
  settings: Omit<JobPreset, "template_id">;
  onSettingsChange: (settings: Omit<JobPreset, "template_id">) => void;
}

export function GlobalSettingsPanel({
  templateId,
  templateFormat,
  channels,
  settings,
  onSettingsChange,
}: GlobalSettingsPanelProps) {
  const { preset, savePreset, clearPreset, hasPreset } =
    useJobPresets(templateId);
  const [saved, setSaved] = useState(false);

  function handleSavePreset() {
    const result = savePreset(settings);
    if (result.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  function handleClearPreset() {
    clearPreset();
    setSaved(false);
  }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
        borderRadius: 12,
        padding: 20,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <h3
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "rgba(205,195,215,0.6)",
              margin: "0 0 4px 0",
            }}
          >
            Global Settings
          </h3>
          <p
            style={{ fontSize: 11, color: "rgba(205,195,215,0.5)", margin: 0 }}
          >
            These settings apply to all jobs created in this batch
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {hasPreset && (
            <button
              onClick={handleClearPreset}
              style={{
                padding: "6px 12px",
                background: "rgba(255,80,80,0.15)",
                border: "1px solid rgba(255,80,80,0.3)",
                borderRadius: 6,
                color: "#ff8080",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Reset
            </button>
          )}
          <button
            onClick={handleSavePreset}
            style={{
              padding: "6px 12px",
              background: saved
                ? "rgba(var(--v2-accent-rgb), 0.3)"
                : "rgba(var(--v2-accent-rgb), 0.15)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.3)",
              borderRadius: 6,
              color: "var(--v2-accent)",
              fontSize: 10,
              fontWeight: 600,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {saved ? (
              <>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 12 }}
                >
                  check
                </span>
                Saved
              </>
            ) : (
              <>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 12 }}
                >
                  bookmark
                </span>
                Save as Default
              </>
            )}
          </button>
        </div>
      </div>

      {/* Settings grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 16,
        }}
      >
        {/* Channel */}
        <div>
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
            value={settings.channel_id}
            onChange={(e) =>
              onSettingsChange({ ...settings, channel_id: e.target.value })
            }
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
              borderRadius: 8,
              color: "#e5e2e1",
              fontSize: 12,
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

        {/* Production Version */}
        <div>
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
            Production Version
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            {(["V1", "V2", "V3"] as const).map((version) => (
              <button
                key={version}
                onClick={() =>
                  onSettingsChange({ ...settings, production_version: version })
                }
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  background:
                    settings.production_version === version
                      ? "var(--v2-accent)"
                      : "rgba(255,255,255,0.03)",
                  border:
                    settings.production_version === version
                      ? "none"
                      : "1px solid rgba(var(--v2-accent-rgb), 0.2)",
                  borderRadius: 8,
                  color:
                    settings.production_version === version
                      ? "#000"
                      : "#e5e2e1",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {version}
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div>
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
            value={settings.language}
            onChange={(e) =>
              onSettingsChange({ ...settings, language: e.target.value })
            }
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
              borderRadius: 8,
              color: "#e5e2e1",
              fontSize: 12,
              outline: "none",
            }}
          >
            <option value="en">English</option>
            <option value="de">German</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
          </select>
        </div>

        {/* Toggles */}
        <div style={{ gridColumn: "1 / -1" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
            }}
          >
            <ToggleButton
              label="Subtitles"
              checked={settings.subtitles}
              onChange={(checked) =>
                onSettingsChange({ ...settings, subtitles: checked })
              }
            />
            <ToggleButton
              label="Auto-start"
              checked={settings.auto_start}
              onChange={(checked) =>
                onSettingsChange({ ...settings, auto_start: checked })
              }
            />
            <ToggleButton
              label="Skip Image QC"
              checked={settings.skip_image_qc}
              onChange={(checked) =>
                onSettingsChange({ ...settings, skip_image_qc: checked })
              }
            />
            <ToggleButton
              label="Skip Final QC"
              checked={settings.skip_final_qc}
              onChange={(checked) =>
                onSettingsChange({ ...settings, skip_final_qc: checked })
              }
            />
          </div>
        </div>

        {/* Music Configuration */}
        <div style={{ gridColumn: "1 / -1" }}>
          <ToggleButton
            label="Background Music"
            checked={settings.music_enabled || false}
            onChange={(checked) =>
              onSettingsChange({ ...settings, music_enabled: checked })
            }
          />

          {settings.music_enabled && (
            <MusicSelector
              selectedTrackId={settings.music_track_id}
              onSelect={(trackId) =>
                onSettingsChange({ ...settings, music_track_id: trackId })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ToggleButton({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        padding: "10px 12px",
        background: checked ? "var(--v2-accent)" : "rgba(255,255,255,0.03)",
        border: checked ? "none" : "1px solid rgba(var(--v2-accent-rgb), 0.2)",
        borderRadius: 8,
        color: checked ? "#000" : "#e5e2e1",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.15s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        textAlign: "center",
      }}
    >
      {checked && (
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          check
        </span>
      )}
      {label}
    </button>
  );
}
