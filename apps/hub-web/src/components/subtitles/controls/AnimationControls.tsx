"use client";
import React from "react";
import { Slider, Select, Toggle, ColorInput } from "../primitives";
import type { RemotionControlProps } from "./types";

export function AnimationControls({
  config,
  onChange,
  disabled,
}: RemotionControlProps) {
  const a = config.animation;
  const set = (patch: Partial<typeof a>) =>
    onChange({ animation: { ...a, ...patch } });

  return (
    <>
      <Toggle
        label="Enable animations"
        checked={a.enabled}
        disabled={disabled}
        onChange={(v) => set({ enabled: v })}
      />
      <Select
        label="Caption Animation"
        options={[
          { value: "none", label: "None" },
          { value: "fade", label: "Fade" },
          { value: "slideUp", label: "Slide Up" },
          { value: "slideDown", label: "Slide Down" },
          { value: "pop", label: "Pop" },
          { value: "bounce", label: "Bounce" },
        ]}
        value={a.caption}
        disabled={disabled || !a.enabled}
        onChange={(v) => set({ caption: v })}
      />
      <Select
        label="Word Animation"
        options={[
          { value: "none", label: "None" },
          { value: "fadeInFast", label: "Fade In Fast" },
          { value: "pop", label: "Pop" },
          { value: "scale", label: "Scale" },
          { value: "colorReveal", label: "Color Reveal" },
        ]}
        value={a.word}
        disabled={disabled || !a.enabled}
        onChange={(v) => set({ word: v })}
      />
      <Toggle
        label="Per-word variance (staggered timing/scale)"
        checked={a.variants}
        disabled={disabled || !a.enabled}
        onChange={(v) => set({ variants: v })}
      />
      <Slider
        label="Duration (frames)"
        value={a.durationFrames}
        min={1}
        max={30}
        disabled={disabled || !a.enabled}
        onChange={(v) => set({ durationFrames: v })}
      />
      <Slider
        label="Active Word Scale"
        value={a.activeWordScale}
        min={1}
        max={1.6}
        step={0.05}
        disabled={disabled || !a.enabled}
        onChange={(v) => set({ activeWordScale: v })}
      />
      <ColorInput
        label="Active Word Color"
        value={a.activeWordColor}
        allowNull
        disabled={disabled || !a.enabled}
        onChange={(v) => set({ activeWordColor: v })}
      />
    </>
  );
}
