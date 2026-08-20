import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultRemotionConfig } from "@repo/db";
import type { RemotionSubtitleConfig } from "@repo/db";
import { SpeakerHeading } from "../SpeakerHeading.js";

// SpeakerHeading is a plain component (no Remotion hooks), so it can be
// rendered directly with react-dom/server — no `remotion` mock needed.

const withSpeakers = (
  overrides: Partial<NonNullable<RemotionSubtitleConfig["speakers"]>> = {},
): RemotionSubtitleConfig => ({
  ...defaultRemotionConfig,
  speakers: {
    enabled: true,
    showHeading: true,
    registry: [
      { id: "spk-a", label: "Cop", color: "#FF0000" },
      { id: "spk-b", label: "Robber", color: "#00FF00" },
    ],
    ...overrides,
  },
});

describe("<SpeakerHeading>", () => {
  it("renders the label + colon in the speaker's registry color for a registered speaker", () => {
    const config = withSpeakers();
    const html = renderToStaticMarkup(
      <SpeakerHeading speakerId="spk-a" config={config} />,
    );
    expect(html).toContain("Cop:");
    expect(html.toLowerCase()).toContain("color:#ff0000");
  });

  it("renders nothing for a speakerId not present in the registry", () => {
    const config = withSpeakers();
    const html = renderToStaticMarkup(
      <SpeakerHeading speakerId="spk-unknown" config={config} />,
    );
    expect(html).toBe("");
  });

  it("renders nothing when config.speakers is null (empty registry lookup)", () => {
    const config: RemotionSubtitleConfig = {
      ...defaultRemotionConfig,
      speakers: null,
    };
    const html = renderToStaticMarkup(
      <SpeakerHeading speakerId="spk-a" config={config} />,
    );
    expect(html).toBe("");
  });
});
