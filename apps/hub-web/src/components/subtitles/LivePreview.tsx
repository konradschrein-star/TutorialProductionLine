"use client";
// Live subtitle preview: runs the REAL Remotion <CaptionOverlay> via
// @remotion/player (see CaptionPlayer), driven by the same buildCaptionPlan
// brain the render uses.
//
// Three things drive the plan:
//   1. a canned sample phrase, or
//   2. TYPED TEXT run through the word-timing simulator (simulate-timings.ts),
//      so an operator can check a preset against their own copy;
// and the aspect ratio, because a preset has to hold up at 9:16 AND 16:9.

import React, { useMemo, useState } from "react";
import { buildCaptionPlan } from "@repo/media-core/subtitles/remotion";
import type { RemotionSubtitleConfig } from "@repo/db";
import {
  aspectToDimensions,
  loopDurationInFrames,
  shiftPlanToStart,
  type PreviewAspect,
} from "./preview-dimensions";
import {
  SAMPLE_PHRASES,
  SAMPLE_PHRASE_MAP,
  type SamplePhraseKey,
} from "./sample-phrases";
import { Segmented } from "./primitives";
import { CaptionPlayer, PreviewError } from "./CaptionPlayer";
import {
  simulateWordTimings,
  simulatedDuration,
  DEFAULT_WPM,
} from "./simulate-timings";

const FPS = 30;

type PreviewBg = "gray" | "white" | "black";
const BG_COLOR: Record<PreviewBg, string> = {
  gray: "#3a3a3a",
  white: "#f2f2f2",
  black: "#050505",
};

type SourceKey = SamplePhraseKey | "custom";

const LABEL_STYLE: React.CSSProperties = { fontSize: 12, color: "#cdc3d7" };

export function LivePreview({
  config,
  aspect: initialAspect = "9:16",
}: {
  config: RemotionSubtitleConfig;
  aspect?: PreviewAspect;
}) {
  const [source, setSource] = useState<SourceKey>("short");
  const [bg, setBg] = useState<PreviewBg>("gray");
  // Persist the chosen aspect — the operator switches it constantly and expects
  // it to survive a reload.
  const [aspect, setAspect] = useState<PreviewAspect>(() => {
    if (typeof window === "undefined") return initialAspect;
    const saved = window.localStorage.getItem("cf.subtitles.previewAspect");
    return saved === "9:16" || saved === "16:9" || saved === "1:1"
      ? (saved as PreviewAspect)
      : initialAspect;
  });
  const setAspectPersist = (a: PreviewAspect) => {
    setAspect(a);
    if (typeof window !== "undefined")
      window.localStorage.setItem("cf.subtitles.previewAspect", a);
  };
  const [customText, setCustomText] = useState(
    "Type any line here and watch exactly how this preset will animate it.",
  );
  const [wpm, setWpm] = useState(DEFAULT_WPM);

  const { width, height } = aspectToDimensions(aspect);

  // Re-derive the caption plan whenever the config, source or rate changes.
  // Samples that carry a `speakerIndex` (the "Dialogue" sample) get mapped onto
  // the CURRENT config's speaker registry here — registry ids are
  // user-generated, so the sample can't hardcode a real speakerId. Words whose
  // index has no matching registry entry fall through with no speakerId, which
  // the renderer already treats as "no heading".
  const { plan, error } = useMemo(() => {
    try {
      if (source === "custom") {
        const words = simulateWordTimings(customText, {
          wordsPerMinute: wpm,
        });
        if (words.length === 0) {
          return {
            plan: null,
            error: "Type some text to simulate." as string | null,
          };
        }
        return {
          plan: shiftPlanToStart(
            buildCaptionPlan(words, config, { width, height }),
          ),
          error: null,
        };
      }
      const registry = config.speakers?.registry ?? [];
      const words = SAMPLE_PHRASE_MAP[source].words.map((w) => {
        if (w.speakerIndex == null) return w;
        const speaker = registry[w.speakerIndex];
        return speaker ? { ...w, speakerId: speaker.id } : w;
      });
      return {
        plan: shiftPlanToStart(
          buildCaptionPlan(words, config, { width, height }),
        ),
        error: null,
      };
    } catch (e) {
      return {
        plan: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [config, source, customText, wpm]);

  const durationInFrames =
    plan && plan.length ? loopDurationInFrames(plan, FPS) : FPS;

  const simSeconds =
    source === "custom"
      ? simulatedDuration(
          simulateWordTimings(customText, { wordsPerMinute: wpm }),
        )
      : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Controls row 1 — what to preview */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 260, flex: 1 }}>
          <Segmented
            options={[
              ...SAMPLE_PHRASES.map((p) => ({
                value: p.key as SourceKey,
                label: p.label,
              })),
              { value: "custom" as SourceKey, label: "Your text" },
            ]}
            value={source}
            onChange={setSource}
          />
        </div>
        <div style={{ minWidth: 170 }}>
          <Segmented
            options={[
              { value: "9:16" as PreviewAspect, label: "9:16" },
              { value: "16:9" as PreviewAspect, label: "16:9" },
              { value: "1:1" as PreviewAspect, label: "1:1" },
            ]}
            value={aspect}
            onChange={setAspectPersist}
          />
        </div>
        <div style={{ minWidth: 170 }}>
          <Segmented
            options={[
              { value: "gray" as PreviewBg, label: "Gray" },
              { value: "white" as PreviewBg, label: "White" },
              { value: "black" as PreviewBg, label: "Black" },
            ]}
            value={bg}
            onChange={setBg}
          />
        </div>
      </div>

      {/* The player */}
      <div
        style={{
          background: BG_COLOR[bg],
          borderRadius: 10,
          overflow: "hidden",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: 200,
          maxHeight: "70vh",
        }}
      >
        {error ? (
          <PreviewError message={error} />
        ) : (
          plan && (
            <CaptionPlayer
              plan={plan}
              config={config}
              width={width}
              height={height}
              fps={FPS}
              durationInFrames={durationInFrames}
              controls
              style={{
                width: "100%",
                // Fill the preview column at 16:9 (capped by the container's
                // 70vh height) instead of a fixed 640px postage stamp on a wide
                // monitor; portrait/square stay bounded so they don't tower.
                maxWidth:
                  aspect === "16:9" ? "100%" : aspect === "1:1" ? 520 : 420,
                maxHeight: "70vh",
              }}
            />
          )
        )}
      </div>

      {/* Text simulator */}
      <div
        style={{
          border: "1px solid rgba(var(--v2-accent-rgb),0.15)",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 10,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 16, color: "var(--v2-accent)" }}
          >
            edit_note
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#e5e2e1" }}>
            Simulate spoken text
          </span>
          <span style={{ fontSize: 11, color: "#8a8594" }}>
            timings are estimated from word length + punctuation, not a real
            transcript
          </span>
        </div>

        <textarea
          value={customText}
          onChange={(e) => {
            setCustomText(e.target.value);
            setSource("custom");
          }}
          rows={3}
          placeholder="Type the line you want to see animated…"
          style={{
            width: "100%",
            resize: "vertical",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(var(--v2-accent-rgb),0.2)",
            borderRadius: 6,
            color: "#e5e2e1",
            padding: "8px 10px",
            fontSize: 13,
            lineHeight: 1.5,
            outline: "none",
            boxSizing: "border-box",
            fontFamily: "inherit",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flex: 1,
              minWidth: 220,
            }}
          >
            <span style={{ ...LABEL_STYLE, whiteSpace: "nowrap" }}>
              Speaking rate
            </span>
            <input
              type="range"
              min={80}
              max={260}
              step={5}
              value={wpm}
              onChange={(e) => setWpm(Number(e.target.value))}
              style={{ flex: 1, accentColor: "var(--v2-accent)" }}
            />
            <span
              style={{
                fontSize: 12,
                color: "var(--v2-accent)",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {wpm} wpm
            </span>
          </label>
          {source === "custom" && simSeconds > 0 && (
            <span style={{ fontSize: 11, color: "#8a8594" }}>
              ≈ {simSeconds.toFixed(1)}s ·{" "}
              {plan
                ? `${plan.length} caption${plan.length === 1 ? "" : "s"}`
                : ""}
            </span>
          )}
          {source !== "custom" && (
            <button
              type="button"
              onClick={() => setSource("custom")}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid rgba(var(--v2-accent-rgb),0.3)",
                background: "transparent",
                color: "var(--v2-accent)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Preview this text
            </button>
          )}
        </div>
      </div>

      <p style={{ fontSize: 11, color: "#cdc3d7", margin: 0 }}>
        Live Remotion preview — the exact caption component used at render time,
        at the selected output aspect ratio.
      </p>
    </div>
  );
}
