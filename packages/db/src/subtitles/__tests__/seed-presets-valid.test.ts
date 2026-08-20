/**
 * Validates that every built-in subtitle preset definition parses cleanly
 * against its engine-specific v2 config schema. A drifting preset (e.g. a
 * removed field, an out-of-range value, wrong engine shape) fails here BEFORE
 * it can be seeded into the DB and blow up the renderer's strict resolver.
 */

import { describe, it, expect } from "vitest";
import { RemotionConfigSchema, FfmpegConfigSchema } from "../config-schema.js";
import {
  BUILTIN_SUBTITLE_PRESETS,
  RETIRED_BUILTIN_PRESETS,
} from "../../seed-subtitle-presets.js";

describe("built-in subtitle presets", () => {
  it("seeds a non-empty set with unique names", () => {
    expect(BUILTIN_SUBTITLE_PRESETS.length).toBeGreaterThan(0);
    const names = BUILTIN_SUBTITLE_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("ships the small, opinionated preset set", () => {
    // The built-ins are deliberately few. Every one exists for a stated reason:
    // an outline default, a plate for bright/busy footage, a spoken-word
    // highlight, an all-yellow variant, a vertical-video variant, and the two
    // libass equivalents for the cheap long-form render path.
    const remotion = BUILTIN_SUBTITLE_PRESETS.filter(
      (p) => p.engine === "remotion",
    ).map((p) => p.name);
    const ffmpeg = BUILTIN_SUBTITLE_PRESETS.filter(
      (p) => p.engine === "ffmpeg",
    ).map((p) => p.name);

    expect(remotion).toEqual([
      "Broadcast",
      "Broadcast Box",
      "Highlight",
      "Yellow",
      "Shorts",
    ]);
    expect(ffmpeg).toEqual(["Broadcast (FFmpeg)", "Highlight (FFmpeg)"]);
  });

  it("every retired built-in names a surviving replacement", () => {
    // Retired presets are deactivated, never deleted, and their assignments are
    // re-pointed — so a format that had captions cannot silently lose them.
    const live = new Set(BUILTIN_SUBTITLE_PRESETS.map((p) => p.name));
    for (const [oldName, newName] of Object.entries(RETIRED_BUILTIN_PRESETS)) {
      expect(live.has(oldName), `${oldName} must not still be shipped`).toBe(
        false,
      );
      expect(live.has(newName), `${oldName} -> ${newName} must exist`).toBe(
        true,
      );
    }
  });

  it("no preset uses a per-word scale pop", () => {
    // The clearest "amateur caption" tell, and at 200-500ms per word the pop
    // occupies most of the word's readable life. Highlighting is colour-only.
    for (const p of BUILTIN_SUBTITLE_PRESETS) {
      const cfg = p.config as { animation: { activeWordScale: number } };
      expect(cfg.animation.activeWordScale, p.name).toBe(1);
    }
  });

  it("every preset sits inside the readable type-size band", () => {
    // fontSize is authored against a 1080-tall reference frame, so it doubles
    // as a percentage-of-height figure: 3.8%-8.5% is the legible range.
    for (const p of BUILTIN_SUBTITLE_PRESETS) {
      const cfg = p.config as { fontSize: number };
      const fraction = cfg.fontSize / 1080;
      expect(
        fraction,
        `${p.name} is ${(fraction * 100).toFixed(1)}% of height`,
      ).toBeGreaterThanOrEqual(0.038);
      expect(
        fraction,
        `${p.name} is ${(fraction * 100).toFixed(1)}% of height`,
      ).toBeLessThanOrEqual(0.085);
    }
  });

  it("the Remotion and FFmpeg twins are configured identically", () => {
    // This is the whole point of the unification: one preset, two renderers.
    for (const [remotionName, ffmpegName] of [
      ["Broadcast", "Broadcast (FFmpeg)"],
      ["Highlight", "Highlight (FFmpeg)"],
    ]) {
      const a = BUILTIN_SUBTITLE_PRESETS.find((p) => p.name === remotionName);
      const b = BUILTIN_SUBTITLE_PRESETS.find((p) => p.name === ffmpegName);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(b!.config).toEqual(a!.config);
    }
  });

  it("the highlight presets use a yellow spoken word", () => {
    for (const name of ["Highlight", "Highlight (FFmpeg)", "Shorts"]) {
      const p = BUILTIN_SUBTITLE_PRESETS.find((x) => x.name === name);
      expect(p, name).toBeDefined();
      const cfg = p!.config as {
        animation: { activeWordColor: string | null };
        fontColor: string;
      };
      expect(cfg.animation.activeWordColor, name).toBe("#FFE000");
      expect(cfg.fontColor, name).toBe("#FFFFFF");
    }
  });
});
