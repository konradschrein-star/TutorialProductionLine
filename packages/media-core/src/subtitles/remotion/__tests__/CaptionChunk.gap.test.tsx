import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultRemotionConfig } from "@repo/db";
import type { CaptionPlan } from "../../types.js";

// ---------------------------------------------------------------------------
// Regression test for the "Thisisa quickcaption" bug.
//
// Originally the line container used a flex `gap` of `0 0.28em`, and `em`
// resolved against the container's UNSET (16px) font-size instead of the
// caption's real size — so a 62px caption got a ~4px gap and the words jammed
// together. That was first fixed by computing the gap in px.
//
// It is now fixed more fundamentally: words are separated by REAL space
// characters in normal inline flow, and the line container carries the
// caption's own font metrics. The inter-word space is therefore the font's own
// space glyph at the caption's size — which is exactly what libass renders in
// the ASS engine, so the two engines space words identically instead of one of
// them using an invented constant.
//
// The invariant under test: the line box must carry the caption font-size, and
// there must be no em-relative gap anywhere.
// ---------------------------------------------------------------------------

vi.mock("remotion", async () => {
  const ReactMod = await import("react");
  const R = ReactMod.default;
  return {
    useCurrentFrame: () => 9,
    useVideoConfig: () => ({
      fps: 30,
      width: 1080,
      height: 1920,
      durationInFrames: 300,
    }),
    AbsoluteFill: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: React.CSSProperties;
    }) => R.createElement("div", { style }, children),
    spring: () => 1,
    interpolate: (_input: number, _inRange: number[], outRange: number[]) =>
      outRange[outRange.length - 1],
  };
});

const { Captions } = await import("../Captions.js");

const w = (word: string, start: number, end: number) => ({
  word,
  raw: word,
  start,
  end,
  role: "normal" as const,
});

const plan: CaptionPlan = [
  {
    words: [w("Hello", 0, 0.5), w("world", 0.5, 1)],
    lines: [[w("Hello", 0, 0.5), w("world", 0.5, 1)]],
    start: 0,
    end: 1,
  },
];

// Scale for a 1920-tall canvas at the default (canvasRelative) size mode.
const SCALE = 1920 / 1080;

function render(fontSize: number): string {
  return renderToStaticMarkup(
    <Captions plan={plan} config={{ ...defaultRemotionConfig, fontSize }} />,
  );
}

describe("<CaptionChunk> word spacing", () => {
  it("separates words with a real space, not an invented gap", () => {
    const html = render(64);
    expect(html).toContain("Hello");
    expect(html).toContain("world");
    // No flex gap of any kind, and above all no em-relative one.
    expect(html).not.toContain("0.28em");
    expect(html).not.toContain("gap:");
  });

  it("gives the line box the caption font-size so the space glyph scales", () => {
    // This is what stops the space collapsing to the 16px document default.
    expect(render(64)).toContain(`font-size:${64 * SCALE}px`);
    expect(render(32)).toContain(`font-size:${32 * SCALE}px`);
    expect(render(96)).toContain(`font-size:${96 * SCALE}px`);
  });

  it("scales the line box with the canvas, not just the preset", () => {
    // 64 design px on a 1920-tall canvas is 113.7 real px, never a bare 64.
    expect(render(64)).not.toContain("font-size:64px");
  });
});
