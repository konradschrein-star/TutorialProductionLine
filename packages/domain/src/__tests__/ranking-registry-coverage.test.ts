import { describe, it, expect } from "vitest";
import {
  isRendererCompatible,
  validateRendererCompatibility,
  getCompatibleRenderers,
  RENDER_WORKFLOWS,
  RENDERER_METADATA,
  FORMAT_RENDERER_COMPATIBILITY,
} from "../renderer-compatibility.js";

/**
 * RANKING was absent from BOTH the renderer-compatibility matrix and the QMS
 * validation profiles. Both were latent landmines rather than live failures —
 * `render-processor.ts` hard-overrides RANKING to `ranking-composition` and the
 * seeded template sets no `render_config.workflow`, so neither lookup ever ran.
 * The first template or operator that set a workflow would have detonated
 * `isRendererCompatible`, which throws for unlisted formats by design.
 */
describe("RANKING renderer compatibility", () => {
  it("has an entry, so isRendererCompatible no longer throws", () => {
    expect(() =>
      isRendererCompatible("RANKING", "ranking-composition"),
    ).not.toThrow();
    expect(isRendererCompatible("RANKING", "ranking-composition")).toBe(true);
  });

  it("validates the workflow render-processor actually dispatches to", () => {
    expect(() =>
      validateRendererCompatibility("RANKING", "ranking-composition"),
    ).not.toThrow();
    expect(getCompatibleRenderers("RANKING")).toEqual(["ranking-composition"]);
  });

  it("rejects the scene-based renderers with a reason", () => {
    expect(() =>
      validateRendererCompatibility("RANKING", "v2-composition"),
    ).toThrow(/incompatible/i);
  });

  it("every workflow named in the matrix has renderer metadata", () => {
    const known = new Set<string>(Object.values(RENDER_WORKFLOWS));
    for (const [format, entry] of Object.entries(
      FORMAT_RENDERER_COMPATIBILITY,
    )) {
      for (const w of entry!.compatible) {
        expect(known.has(w), `${format} -> ${w}`).toBe(true);
        expect(RENDERER_METADATA[w]).toBeDefined();
      }
    }
  });
});
