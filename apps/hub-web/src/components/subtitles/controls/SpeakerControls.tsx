"use client";
import React from "react";
import {
  Toggle,
  ColorInput,
  Field,
  INPUT_BG,
  INPUT_BORDER,
} from "../primitives";
import type { RemotionControlProps } from "./types";

type SpeakerEntry = { id: string; label: string; color: string };

/** Rotation used when seeding/adding a new speaker row. */
const DEFAULT_SPEAKER_COLORS = ["#FFD400", "#00E0FF", "#FF3D71", "#7CFFB2"];

function makeSpeakerId(): string {
  return typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `speaker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeDefaultRegistry(): SpeakerEntry[] {
  return [
    {
      id: makeSpeakerId(),
      label: "Speaker A",
      color: DEFAULT_SPEAKER_COLORS[0]!,
    },
    {
      id: makeSpeakerId(),
      label: "Speaker B",
      color: DEFAULT_SPEAKER_COLORS[1]!,
    },
  ];
}

/**
 * Multi-speaker registry editor: add/remove speakers, each with an editable
 * label + color, plus the enable/showHeading toggles. Writes into
 * `config.speakers.registry` immutably via the shared onChange patch pattern.
 *
 * Enabling seeds two default speakers (rather than an empty registry) so the
 * LivePreview's "Dialogue" sample has something to map its speakerIndex onto
 * immediately — see sample-phrases.ts / LivePreview.tsx.
 */
export function SpeakerControls({
  config,
  onChange,
  disabled,
}: RemotionControlProps) {
  const sp = config.speakers;
  const enabled = sp != null && sp.enabled;
  const registry = sp?.registry ?? [];

  const setRegistry = (next: SpeakerEntry[]) => {
    if (!sp) return;
    onChange({ speakers: { ...sp, registry: next } });
  };

  const addSpeaker = () => {
    const color =
      DEFAULT_SPEAKER_COLORS[registry.length % DEFAULT_SPEAKER_COLORS.length]!;
    setRegistry([
      ...registry,
      { id: makeSpeakerId(), label: `Speaker ${registry.length + 1}`, color },
    ]);
  };

  const updateSpeaker = (id: string, patch: Partial<SpeakerEntry>) => {
    setRegistry(registry.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeSpeaker = (id: string) => {
    setRegistry(registry.filter((s) => s.id !== id));
  };

  return (
    <>
      <Toggle
        label="Multi-speaker mode"
        checked={enabled}
        disabled={disabled}
        onChange={(on) =>
          onChange({
            speakers: on
              ? {
                  enabled: true,
                  showHeading: sp?.showHeading ?? true,
                  registry:
                    sp?.registry && sp.registry.length > 0
                      ? sp.registry
                      : makeDefaultRegistry(),
                }
              : sp
                ? { ...sp, enabled: false }
                : null,
          })
        }
      />
      {enabled && sp && (
        <>
          <Toggle
            label="Show speaker heading"
            checked={sp.showHeading}
            disabled={disabled}
            onChange={(v) => onChange({ speakers: { ...sp, showHeading: v } })}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#cdc3d7" }}>
              Speakers ({registry.length})
            </span>

            {registry.map((speaker) => (
              <div
                key={speaker.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: 10,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(var(--v2-accent-rgb),0.12)",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Field label="Label">
                    <input
                      type="text"
                      value={speaker.label}
                      disabled={disabled}
                      placeholder="Speaker name"
                      onChange={(e) =>
                        updateSpeaker(speaker.id, { label: e.target.value })
                      }
                      style={{
                        width: "100%",
                        background: INPUT_BG,
                        border: INPUT_BORDER,
                        borderRadius: 6,
                        color: "#e5e2e1",
                        fontSize: 12,
                        padding: "6px 8px",
                      }}
                    />
                  </Field>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeSpeaker(speaker.id)}
                    title="Remove speaker"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      marginTop: 16,
                      flexShrink: 0,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
                      borderRadius: 6,
                      color: "#cdc3d7",
                      cursor: disabled ? "default" : "pointer",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16 }}
                    >
                      close
                    </span>
                  </button>
                </div>
                <ColorInput
                  label="Color"
                  value={speaker.color}
                  disabled={disabled}
                  onChange={(v) =>
                    updateSpeaker(speaker.id, { color: v ?? speaker.color })
                  }
                />
              </div>
            ))}

            <button
              type="button"
              disabled={disabled}
              onClick={addSpeaker}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "7px 10px",
                background: "rgba(var(--v2-accent-rgb),0.1)",
                border: "1px solid rgba(var(--v2-accent-rgb),0.25)",
                borderRadius: 6,
                color: "var(--v2-accent)",
                fontSize: 12,
                fontWeight: 600,
                cursor: disabled ? "default" : "pointer",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                add
              </span>
              Add speaker
            </button>
          </div>
        </>
      )}
    </>
  );
}
