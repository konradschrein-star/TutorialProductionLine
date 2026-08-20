"use client";
import React from "react";
import { Slider, ColorInput, Toggle } from "../primitives";
import type { RemotionControlProps } from "./types";

const WORD_CLASSES = ["noun", "verb", "adjective", "adverb", "number"] as const;
type WordClass = (typeof WORD_CLASSES)[number];
const COLOR_SLOTS = ["Main", "Second", "Third"] as const;

export function KeywordControls({
  config,
  onChange,
  disabled,
}: RemotionControlProps) {
  const kw = config.keyword;
  const set = (patch: Partial<typeof kw>) =>
    onChange({ keyword: { ...kw, ...patch } });

  const toggleClass = (c: WordClass) => {
    const has = kw.wordClasses.includes(c);
    set({
      wordClasses: has
        ? kw.wordClasses.filter((x) => x !== c)
        : [...kw.wordClasses, c],
    });
  };

  const setColor = (i: number, v: string) => {
    const colors = [...kw.colors];
    while (colors.length <= i) colors.push("#FFFFFF");
    colors[i] = v;
    set({ colors });
  };

  return (
    <>
      <Toggle
        label="Highlight keywords"
        checked={kw.enabled}
        disabled={disabled}
        onChange={(v) => set({ enabled: v })}
      />
      {kw.enabled && (
        <>
          <div style={{ fontSize: 11, color: "#cdc3d7" }}>Word classes</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {WORD_CLASSES.map((c) => (
              <label
                key={c}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  cursor: disabled ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={kw.wordClasses.includes(c)}
                  disabled={disabled}
                  onChange={() => toggleClass(c)}
                />
                <span style={{ fontSize: 11, color: "#cdc3d7" }}>{c}</span>
              </label>
            ))}
          </div>

          <Slider
            label="Aggressiveness"
            value={kw.aggressiveness}
            min={0}
            max={100}
            disabled={disabled}
            onChange={(v) => set({ aggressiveness: v })}
          />

          {COLOR_SLOTS.map((slot, i) => (
            <ColorInput
              key={slot}
              label={`${slot} Color`}
              value={kw.colors[i] ?? "#FFFFFF"}
              disabled={disabled}
              onChange={(v) => setColor(i, v ?? "#FFFFFF")}
            />
          ))}

          <Toggle
            label="Bold keywords"
            checked={kw.bold}
            disabled={disabled}
            onChange={(v) => set({ bold: v })}
          />
          <Toggle
            label="Italic keywords"
            checked={kw.italic}
            disabled={disabled}
            onChange={(v) => set({ italic: v })}
          />
          <ColorInput
            label="Keyword Background"
            value={kw.background}
            allowNull
            disabled={disabled}
            onChange={(v) => set({ background: v })}
          />
        </>
      )}
    </>
  );
}
