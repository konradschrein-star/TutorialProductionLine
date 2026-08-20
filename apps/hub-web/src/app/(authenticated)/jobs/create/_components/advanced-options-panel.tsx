// apps/hub-web/src/app/(authenticated)/jobs/create/_components/advanced-options-panel.tsx
"use client";

import { useState } from "react";
import { labelStyle, selectStyle, inputStyle } from "./form-field-styles";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
];

export interface AdvancedOptions {
  language: string;
  production_version: "V1" | "V2" | "V3";
  aspect_ratio: "16:9" | "9:16" | "1:1" | "4:3";
  target_duration_seconds?: number;
  skip_image_qc: boolean;
  skip_final_qc: boolean;
}

export const DEFAULT_ADVANCED: AdvancedOptions = {
  language: "en",
  production_version: "V2",
  aspect_ratio: "16:9",
  target_duration_seconds: undefined,
  skip_image_qc: false,
  skip_final_qc: false,
};

interface AdvancedOptionsPanelProps {
  value: AdvancedOptions;
  onChange: (v: AdvancedOptions) => void;
}

export function AdvancedOptionsPanel({
  value,
  onChange,
}: AdvancedOptionsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  function set<K extends keyof AdvancedOptions>(
    key: K,
    val: AdvancedOptions[K],
  ) {
    onChange({ ...value, [key]: val });
  }

  const isModified =
    value.language !== "en" ||
    value.production_version !== "V2" ||
    value.aspect_ratio !== "16:9" ||
    value.skip_image_qc ||
    value.skip_final_qc ||
    !!value.target_duration_seconds;

  return (
    <div
      style={{
        borderTop: "1px solid rgba(var(--v2-accent-rgb), 0.1)",
        paddingTop: 16,
        marginTop: 8,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          color: "rgba(205,195,215,0.7)",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          {expanded ? "expand_less" : "expand_more"}
        </span>
        Advanced Options
        {isModified && (
          <span
            style={{
              fontSize: 9,
              padding: "2px 6px",
              background: "rgba(var(--v2-accent-rgb), 0.15)",
              borderRadius: 4,
              color: "var(--v2-accent)",
              marginLeft: 4,
            }}
          >
            modified
          </span>
        )}
      </button>

      {expanded && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginTop: 16,
          }}
        >
          <div>
            <label style={labelStyle}>Language</label>
            <select
              value={value.language}
              onChange={(e) => set("language", e.target.value)}
              style={selectStyle}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Pipeline Version</label>
            <select
              value={value.production_version}
              onChange={(e) =>
                set(
                  "production_version",
                  e.target.value as AdvancedOptions["production_version"],
                )
              }
              style={selectStyle}
            >
              <option value="V2">V2 — Standard (default)</option>
              <option value="V3">V3 — Remotion</option>
              <option value="V1">V1 — Legacy</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Aspect Ratio</label>
            <select
              value={value.aspect_ratio}
              onChange={(e) =>
                set(
                  "aspect_ratio",
                  e.target.value as AdvancedOptions["aspect_ratio"],
                )
              }
              style={selectStyle}
            >
              <option value="16:9">16:9 — YouTube (default)</option>
              <option value="9:16">9:16 — Shorts / TikTok</option>
              <option value="1:1">1:1 — Square</option>
              <option value="4:3">4:3</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Target Duration (seconds)</label>
            <input
              type="number"
              min={10}
              max={21600}
              value={value.target_duration_seconds ?? ""}
              onChange={(e) =>
                set(
                  "target_duration_seconds",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                )
              }
              placeholder="e.g. 300 (leave blank = auto)"
              style={inputStyle}
            />
          </div>

          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 24 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={value.skip_image_qc}
                onChange={(e) => set("skip_image_qc", e.target.checked)}
              />
              <span style={{ fontSize: 12, color: "#cdc3d7" }}>
                Skip Image QC
              </span>
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={value.skip_final_qc}
                onChange={(e) => set("skip_final_qc", e.target.checked)}
              />
              <span style={{ fontSize: 12, color: "#cdc3d7" }}>
                Skip Final QC
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
