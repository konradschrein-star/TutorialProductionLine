import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultRemotionConfig } from "@repo/db";
import type { CaptionPlan } from "../../types.js";

// ---------------------------------------------------------------------------
// Light render smoke test. Remotion hooks require a Remotion render context we
// don't have in a plain node vitest env, so we mock the `remotion` module with
// trivial stand-ins: useCurrentFrame reads a controllable global, AbsoluteFill
// is a <div>, and spring/interpolate settle to their final value (so entrance
// animations resolve to "fully visible"). This proves the component tree mounts
// and renders the active chunk's text — the deterministic visual math is
// covered exhaustively in caption-styles.test.ts.
// ---------------------------------------------------------------------------

vi.mock("remotion", async () => {
  const ReactMod = await import("react");
  const R = ReactMod.default;
  return {
    useCurrentFrame: () =>
      ((globalThis as Record<string, unknown>).__frame as number) ?? 0,
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
    // Settle to the final output value so entrance anims render fully visible.
    interpolate: (_input: number, _inRange: number[], outRange: number[]) =>
      outRange[outRange.length - 1],
  };
});

// Import AFTER the mock is registered.
const { Captions } = await import("../Captions.js");
const { CaptionOverlay } = await import("../CaptionOverlay.js");

function setFrame(frame: number) {
  (globalThis as Record<string, unknown>).__frame = frame;
}

const plan: CaptionPlan = [
  {
    words: [
      { word: "Hello", raw: "Hello", start: 0, end: 0.5, role: "normal" },
      { word: "world", raw: "world", start: 0.5, end: 1, role: "normal" },
    ],
    lines: [
      [
        { word: "Hello", raw: "Hello", start: 0, end: 0.5, role: "normal" },
        { word: "world", raw: "world", start: 0.5, end: 1, role: "normal" },
      ],
    ],
    start: 0,
    end: 1,
  },
  {
    words: [
      {
        word: "Second",
        raw: "Second",
        start: 1,
        end: 2,
        role: "keyword",
        keywordColor: "#FFD400",
      },
    ],
    lines: [
      [
        {
          word: "Second",
          raw: "Second",
          start: 1,
          end: 2,
          role: "keyword",
          keywordColor: "#FFD400",
        },
      ],
    ],
    start: 1,
    end: 2,
  },
];

describe("<Captions> render smoke", () => {
  beforeEach(() => setFrame(0));

  it("renders the active chunk's words at a time inside chunk 0", () => {
    setFrame(9); // 9/30 = 0.3s -> chunk 0
    const html = renderToStaticMarkup(
      <Captions plan={plan} config={defaultRemotionConfig} />,
    );
    expect(html).toContain("Hello");
    expect(html).toContain("world");
    expect(html).not.toContain("Second");
  });

  it("renders the second chunk at a later time", () => {
    setFrame(45); // 1.5s -> chunk 1
    const html = renderToStaticMarkup(
      <Captions plan={plan} config={defaultRemotionConfig} />,
    );
    expect(html).toContain("Second");
    expect(html).not.toContain("Hello");
  });

  it("applies the keyword color to a keyword word", () => {
    setFrame(45);
    const html = renderToStaticMarkup(
      <Captions plan={plan} config={defaultRemotionConfig} />,
    );
    // computeWordStyle → inline color style on the keyword span.
    expect(html.toLowerCase()).toContain("color:#ffd400");
  });

  it("renders nothing before the first chunk", () => {
    // Use a plan whose first chunk starts later so a frame at t=0 is a gap.
    const gapPlan: CaptionPlan = [
      { ...plan[0], start: 1, end: 2, lines: plan[0].lines },
    ];
    setFrame(0);
    const html = renderToStaticMarkup(
      <Captions plan={gapPlan} config={defaultRemotionConfig} />,
    );
    expect(html).toBe("");
  });

  it("CaptionOverlay wraps Captions over a transparent fill", () => {
    setFrame(9);
    const html = renderToStaticMarkup(
      <CaptionOverlay plan={plan} config={defaultRemotionConfig} />,
    );
    expect(html).toContain("transparent");
    expect(html).toContain("Hello");
  });
});

// ---------------------------------------------------------------------------
// Speaker heading gating (Task 9b): a chunk with a speakerId only shows the
// "Label:" heading when speakers.enabled AND speakers.showHeading AND the
// speakerId resolves in the registry. Any one of those being false/missing
// must render no heading, never throw.
// ---------------------------------------------------------------------------

describe("<Captions> speaker heading gating", () => {
  beforeEach(() => setFrame(9)); // inside chunk 0's [0, 0.5) window from `plan`

  const speakerPlan: CaptionPlan = [
    {
      ...plan[0],
      speakerId: "spk-a",
    },
  ];

  const registryConfig = (
    overrides: Partial<NonNullable<typeof defaultRemotionConfig.speakers>> = {},
  ) => ({
    ...defaultRemotionConfig,
    speakers: {
      enabled: true,
      showHeading: true,
      registry: [{ id: "spk-a", label: "Cop", color: "#FF0000" }],
      ...overrides,
    },
  });

  it("shows the heading for a registered speaker when enabled + showHeading", () => {
    const html = renderToStaticMarkup(
      <Captions plan={speakerPlan} config={registryConfig()} />,
    );
    expect(html).toContain("Cop:");
  });

  it("hides the heading when speakers.enabled is false", () => {
    const html = renderToStaticMarkup(
      <Captions
        plan={speakerPlan}
        config={registryConfig({ enabled: false })}
      />,
    );
    expect(html).not.toContain("Cop:");
  });

  it("hides the heading when showHeading is false", () => {
    const html = renderToStaticMarkup(
      <Captions
        plan={speakerPlan}
        config={registryConfig({ showHeading: false })}
      />,
    );
    expect(html).not.toContain("Cop:");
  });

  it("hides the heading (does not throw) for a speakerId not in the registry", () => {
    const unknownSpeakerPlan: CaptionPlan = [
      { ...plan[0], speakerId: "spk-unknown" },
    ];
    expect(() =>
      renderToStaticMarkup(
        <Captions plan={unknownSpeakerPlan} config={registryConfig()} />,
      ),
    ).not.toThrow();
    const html = renderToStaticMarkup(
      <Captions plan={unknownSpeakerPlan} config={registryConfig()} />,
    );
    expect(html).not.toContain("Cop:");
  });

  it("renders no heading when speakers is null (default)", () => {
    const html = renderToStaticMarkup(
      <Captions plan={speakerPlan} config={defaultRemotionConfig} />,
    );
    expect(html).not.toContain("Cop:");
  });
});
