"use client";
import React from "react";
import { Slider, Segmented, Select, Toggle } from "../primitives";
import type { RemotionControlProps } from "./types";

export function CaptionControls({
  config,
  onChange,
  disabled,
}: RemotionControlProps) {
  const customY = config.positionPreset === "custom";

  return (
    <>
      <Slider
        label="Display Words"
        value={config.wordsPerChunk}
        min={1}
        max={8}
        disabled={disabled}
        onChange={(v) => onChange({ wordsPerChunk: v })}
      />

      <Select
        label="Position Preset"
        options={[
          { value: "bottom", label: "Bottom" },
          { value: "center", label: "Center" },
          { value: "top", label: "Top" },
          { value: "lowerThird", label: "Lower Third" },
          { value: "custom", label: "Custom" },
        ]}
        value={config.positionPreset}
        disabled={disabled}
        onChange={(v) => onChange({ positionPreset: v })}
      />
      <Slider
        label="Position Y"
        value={config.positionY}
        min={0}
        max={100}
        suffix="%"
        disabled={disabled || !customY}
        onChange={(v) => onChange({ positionY: v })}
      />
      <Slider
        label="Position X"
        value={config.positionX}
        min={0}
        max={100}
        suffix="%"
        disabled={disabled}
        onChange={(v) => onChange({ positionX: v })}
      />

      <Segmented
        label="Alignment"
        options={[
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ]}
        value={config.alignment}
        disabled={disabled}
        onChange={(v) => onChange({ alignment: v })}
      />

      <Slider
        label="Safe area (max width)"
        value={config.maxWidthPercent}
        min={20}
        max={100}
        suffix="%"
        disabled={disabled}
        onChange={(v) => onChange({ maxWidthPercent: v })}
      />

      <Slider
        label="Safe margin (from frame edge)"
        value={config.safeMarginPercent}
        min={0}
        max={40}
        suffix="%"
        disabled={disabled}
        onChange={(v) => onChange({ safeMarginPercent: v })}
      />

      <Segmented
        label="Size mode"
        options={[
          {
            value: "canvasRelative",
            label: "Relative",
            title:
              "Sizes are authored against a 1080-tall frame and scaled to the real canvas — one preset reads the same at 16:9 and 9:16. Recommended.",
          },
          {
            value: "absolute",
            label: "Absolute",
            title:
              "Sizes are raw canvas pixels — the same preset looks ~44% smaller on a 9:16 frame than on 16:9.",
          },
        ]}
        value={config.sizeMode}
        disabled={disabled}
        onChange={(v) => onChange({ sizeMode: v })}
      />

      <Segmented
        label="Punctuation"
        options={[
          { value: "all", label: "All", title: "Keep all punctuation" },
          {
            value: "soft",
            label: "Soft",
            title: "Keep ! ? \" ' , — strip . ,",
          },
          { value: "none", label: "None", title: "Strip all punctuation" },
        ]}
        value={config.punctuationMode}
        disabled={disabled}
        onChange={(v) => onChange({ punctuationMode: v })}
      />

      <Toggle
        label="Break into lines"
        checked={config.breakLines}
        disabled={disabled}
        onChange={(v) => onChange({ breakLines: v })}
      />
      {config.breakLines && (
        <Slider
          label="Max Lines"
          value={config.maxLines}
          min={1}
          max={4}
          disabled={disabled}
          onChange={(v) => onChange({ maxLines: v })}
        />
      )}
      <Toggle
        label="Gap-free (extend each chunk to the next)"
        checked={config.gapFree}
        disabled={disabled}
        onChange={(v) => onChange({ gapFree: v })}
      />
      <Toggle
        label="Smart split (break on long silences)"
        checked={config.smartSplit}
        disabled={disabled}
        onChange={(v) => onChange({ smartSplit: v })}
      />

      <div
        style={{
          fontSize: 11,
          color: "#cdc3d7",
          fontWeight: 600,
          marginTop: 4,
        }}
      >
        One-word mode
      </div>
      <Toggle
        label="Pair short words together"
        checked={config.oneWordMode.pairShortWords}
        disabled={disabled}
        onChange={(v) =>
          onChange({
            oneWordMode: { ...config.oneWordMode, pairShortWords: v },
          })
        }
      />
      <Slider
        label="Short-word max length"
        value={config.oneWordMode.shortWordMaxLen}
        min={1}
        max={8}
        disabled={disabled || !config.oneWordMode.pairShortWords}
        onChange={(v) =>
          onChange({
            oneWordMode: { ...config.oneWordMode, shortWordMaxLen: v },
          })
        }
      />
    </>
  );
}
