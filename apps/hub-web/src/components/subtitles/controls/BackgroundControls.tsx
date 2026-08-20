"use client";
import React from "react";
import { Slider, ColorInput, Toggle } from "../primitives";
import type { RemotionControlProps } from "./types";

export function BackgroundControls({
  config,
  onChange,
  disabled,
}: RemotionControlProps) {
  const bg = config.background;
  const set = (patch: Partial<typeof bg>) =>
    onChange({ background: { ...bg, ...patch } });

  return (
    <>
      <Toggle
        label="Caption background pill"
        checked={bg.enabled}
        disabled={disabled}
        onChange={(v) => set({ enabled: v })}
      />
      {bg.enabled && (
        <>
          <ColorInput
            label="Color"
            value={bg.color}
            disabled={disabled}
            onChange={(v) => set({ color: v ?? bg.color })}
          />
          <Slider
            label="Corner Radius"
            value={bg.radius}
            min={0}
            max={60}
            disabled={disabled}
            onChange={(v) => set({ radius: v })}
          />
          <Slider
            label="Padding X"
            value={bg.paddingX}
            min={0}
            max={60}
            disabled={disabled}
            onChange={(v) => set({ paddingX: v })}
          />
          <Slider
            label="Padding Y"
            value={bg.paddingY}
            min={0}
            max={60}
            disabled={disabled}
            onChange={(v) => set({ paddingY: v })}
          />
        </>
      )}

      <ColorInput
        label="Video Background Fill"
        value={config.videoBackgroundColor}
        allowNull
        disabled={disabled}
        onChange={(v) => onChange({ videoBackgroundColor: v })}
      />
    </>
  );
}
