"use client";
import React from "react";
import {
  Slider,
  ColorInput,
  Segmented,
  Select,
  FontFamilySelect,
} from "../primitives";
import type { RemotionControlProps } from "./types";

const WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

export function FontControls({
  config,
  onChange,
  disabled,
  fonts = [],
}: RemotionControlProps) {
  return (
    <>
      <FontFamilySelect
        fonts={fonts}
        valueFontId={config.fontId}
        valueFontFamily={config.fontFamily}
        disabled={disabled}
        onChange={onChange}
      />

      <Segmented
        label="Weight"
        options={WEIGHTS.map((w) => ({ value: String(w), label: String(w) }))}
        value={String(config.fontWeight)}
        disabled={disabled}
        onChange={(v) => onChange({ fontWeight: Number(v) })}
      />

      <Segmented
        label="Text Case"
        options={[
          { value: "asIs", label: "Aa", title: "As typed" },
          { value: "upper", label: "AA", title: "UPPERCASE" },
          { value: "lower", label: "aa", title: "lowercase" },
        ]}
        value={config.textCase}
        disabled={disabled}
        onChange={(v) => onChange({ textCase: v })}
      />

      <Slider
        label="Size"
        value={config.fontSize}
        min={24}
        max={160}
        disabled={disabled}
        onChange={(v) => onChange({ fontSize: v })}
      />

      <ColorInput
        label="Text Color"
        value={config.fontColor}
        disabled={disabled}
        onChange={(v) => onChange({ fontColor: v ?? config.fontColor })}
      />
      <ColorInput
        label="Stroke Color"
        value={config.stroke.color}
        disabled={disabled}
        onChange={(v) =>
          onChange({
            stroke: { ...config.stroke, color: v ?? config.stroke.color },
          })
        }
      />
      <Slider
        label="Stroke Weight"
        value={config.stroke.width}
        min={0}
        max={24}
        disabled={disabled}
        onChange={(v) => onChange({ stroke: { ...config.stroke, width: v } })}
      />

      <div
        style={{
          fontSize: 11,
          color: "#cdc3d7",
          fontWeight: 600,
          marginTop: 4,
        }}
      >
        Shadow
      </div>
      <ColorInput
        label="Shadow Color"
        value={config.shadow.color}
        disabled={disabled}
        onChange={(v) =>
          onChange({
            shadow: { ...config.shadow, color: v ?? config.shadow.color },
          })
        }
      />
      <Slider
        label="Strength"
        value={config.shadow.strength}
        min={0}
        max={1}
        step={0.05}
        disabled={disabled}
        onChange={(v) =>
          onChange({ shadow: { ...config.shadow, strength: v } })
        }
      />
      <Slider
        label="Blur"
        value={config.shadow.blur}
        min={0}
        max={40}
        disabled={disabled}
        onChange={(v) => onChange({ shadow: { ...config.shadow, blur: v } })}
      />
      <Slider
        label="Size (spread)"
        value={config.shadow.size}
        min={0}
        max={40}
        disabled={disabled}
        onChange={(v) => onChange({ shadow: { ...config.shadow, size: v } })}
      />
      <Slider
        label="Offset X"
        value={config.shadow.offsetX}
        min={-20}
        max={20}
        disabled={disabled}
        onChange={(v) => onChange({ shadow: { ...config.shadow, offsetX: v } })}
      />
      <Slider
        label="Offset Y"
        value={config.shadow.offsetY}
        min={-20}
        max={20}
        disabled={disabled}
        onChange={(v) => onChange({ shadow: { ...config.shadow, offsetY: v } })}
      />
      <Select
        label="Falloff Curve"
        options={[
          { value: "linear", label: "Linear" },
          { value: "easeOut", label: "Ease Out" },
          { value: "easeIn", label: "Ease In" },
          { value: "gaussian", label: "Gaussian" },
        ]}
        value={config.shadow.curve}
        disabled={disabled}
        onChange={(v) => onChange({ shadow: { ...config.shadow, curve: v } })}
      />
    </>
  );
}
