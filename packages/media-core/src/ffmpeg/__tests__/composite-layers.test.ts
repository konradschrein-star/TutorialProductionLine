import { describe, it, expect } from "vitest";
import {
  buildCompositeLayersArgs,
  CompositeLayersError,
  type CompositeLayer,
  type CompositeLayersParams,
} from "../composite-layers.js";

const BASE: Omit<CompositeLayersParams, "layers"> = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationFrames: 150, // 5s
  outputPath: "/out/scene-s07.mp4",
};

/** The canonical business-hub stack: mat ground → chart plate → presenter → watermark. */
function fullStack(): CompositeLayer[] {
  return [
    { kind: "image", path: "/assets/mat-dark.png", x: 0, y: 0 },
    { kind: "video", path: "/cache/mg-dscr.mp4", x: 260, y: 180, rotate: -2.5 },
    { kind: "alpha-video", path: "/tmp/presenter.webm", x: 1180, y: 96 },
    { kind: "image", path: "/assets/watermark.png", x: "W-w-48", y: "H-h-48", opacity: 0.7 },
  ];
}

function argPairs(args: string[], flag: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) found.push(args[i + 1] ?? "");
  }
  return found;
}

describe("buildCompositeLayersArgs — inputs", () => {
  it("emits one -i group per layer so the layer index is the ffmpeg input index", () => {
    const plan = buildCompositeLayersArgs({ ...BASE, layers: fullStack() });
    expect(argPairs(plan.args, "-i")).toEqual([
      "/assets/mat-dark.png",
      "/cache/mg-dscr.mp4",
      "/tmp/presenter.webm",
      "/assets/watermark.png",
    ]);
  });

  it("loops and time-bounds still images, and leaves clips to play out", () => {
    const plan = buildCompositeLayersArgs({ ...BASE, layers: fullStack() });
    const joined = plan.args.join(" ");
    expect(joined).toContain("-loop 1 -framerate 30 -t 5 -i /assets/mat-dark.png");
    expect(joined).toContain("-i /cache/mg-dscr.mp4");
    // Clips get no -loop/-t of their own.
    expect(joined).not.toContain("-loop 1 -framerate 30 -t 5 -i /cache/mg-dscr.mp4");
  });

  it("generates a colour ground through lavfi at exactly the output size", () => {
    const plan = buildCompositeLayersArgs({
      ...BASE,
      layers: [{ kind: "color", color: "#0b0f14", x: 0, y: 0 }],
    });
    expect(plan.args.join(" ")).toContain(
      "-f lavfi -t 5 -i color=c=#0b0f14:s=1920x1080:r=30",
    );
    // A lavfi plate is already exact — it is only sar-normalised, never rescaled.
    expect(plan.filterComplex).toContain("[0:v]setsar=1");
    expect(plan.filterComplex).not.toContain("force_original_aspect_ratio");
  });
});

describe("buildCompositeLayersArgs — filtergraph", () => {
  it("cover-fits the ground and overlays every layer back to front", () => {
    const plan = buildCompositeLayersArgs({ ...BASE, layers: fullStack() });
    const nodes = plan.filterComplex.split(";");

    expect(nodes[0]).toBe(
      "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1[fg0]",
    );
    // Three overlays, in stack order, each preserving alpha and not ending the base.
    const overlays = nodes.filter((n) => n.includes("overlay="));
    expect(overlays).toHaveLength(3);
    for (const o of overlays) {
      expect(o).toContain("format=auto");
      expect(o).toContain("eof_action=pass");
      expect(o).toContain("shortest=0");
    }
    expect(overlays[0]).toContain("overlay=x=260:y=180");
    expect(overlays[1]).toContain("overlay=x=1180:y=96");
    expect(overlays[2]).toContain("overlay=x=W-w-48:y=H-h-48");
    expect(plan.filterComplex).toMatch(/format=yuv420p\[fg\d+\];\[fg\d+\]null\[vout\]$/);
  });

  it("forces rgba before rotating so the exposed corners stay transparent", () => {
    const plan = buildCompositeLayersArgs({ ...BASE, layers: fullStack() });
    const rad = String(Number(((-2.5 * Math.PI) / 180).toFixed(6)));
    expect(plan.filterComplex).toContain("[1:v]format=rgba");
    expect(plan.filterComplex).toContain(`rotate=${rad}:c=none:ow=rotw(${rad}):oh=roth(${rad})`);
  });

  it("applies opacity with colorchannelmixer=aa over a forced rgba", () => {
    const plan = buildCompositeLayersArgs({ ...BASE, layers: fullStack() });
    expect(plan.filterComplex).toContain("[3:v]format=rgba");
    expect(plan.filterComplex).toContain("colorchannelmixer=aa=0.7");
  });

  it("scales, blurs and time-gates a layer", () => {
    const plan = buildCompositeLayersArgs({
      ...BASE,
      layers: [
        { kind: "image", path: "/g.png", x: 0, y: 0 },
        {
          kind: "image",
          path: "/card.png",
          x: 100,
          y: 200,
          scale: 0.75,
          blur: 6,
          enableFrom: 1.5,
          enableTo: 4,
        },
      ],
    });
    expect(plan.filterComplex).toContain("[1:v]scale=iw*0.75:ih*0.75");
    expect(plan.filterComplex).toContain("gblur=sigma=6");
    expect(plan.filterComplex).toContain("enable='between(t,1.5,4)'");
  });

  it("emits one-sided enable expressions", () => {
    const from = buildCompositeLayersArgs({
      ...BASE,
      layers: [
        { kind: "color", color: "black", x: 0, y: 0 },
        { kind: "image", path: "/a.png", x: 0, y: 0, enableFrom: 2 },
      ],
    });
    expect(from.filterComplex).toContain("enable='gte(t,2)'");

    const to = buildCompositeLayersArgs({
      ...BASE,
      layers: [
        { kind: "color", color: "black", x: 0, y: 0 },
        { kind: "image", path: "/a.png", x: 0, y: 0, enableTo: 3 },
      ],
    });
    expect(to.filterComplex).toContain("enable='lte(t,3)'");
  });

  it("blurs the ground for the broll-defocus layout", () => {
    const plan = buildCompositeLayersArgs({
      ...BASE,
      layers: [{ kind: "video", path: "/broll.mp4", x: 0, y: 0, blur: 22 }],
    });
    expect(plan.filterComplex).toContain(
      "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1[fg0];[fg0]gblur=sigma=22[fg1]",
    );
  });

  it("applies the grade once, over the whole stack", () => {
    const plan = buildCompositeLayersArgs({
      ...BASE,
      layers: fullStack(),
      grade: {
        eq: { contrast: 1.05, saturation: 0.9 },
        channelMixer: { rr: 0.96, bb: 1.05 },
      },
    });
    const nodes = plan.filterComplex.split(";");
    const eqIdx = nodes.findIndex((n) => n.includes("eq="));
    const lastOverlayIdx = nodes.map((n) => n.includes("overlay=")).lastIndexOf(true);
    expect(eqIdx).toBeGreaterThan(lastOverlayIdx);
    expect(nodes[eqIdx]).toContain("eq=contrast=1.05:saturation=0.9");
    expect(plan.filterComplex).toContain("colorchannelmixer=rr=0.96:bb=1.05");
  });
});

describe("buildCompositeLayersArgs — output mapping", () => {
  it("maps the graph output and preserves the base audio when the ground is a clip", () => {
    const plan = buildCompositeLayersArgs({
      ...BASE,
      layers: [
        { kind: "video", path: "/base.mp4", x: 0, y: 0 },
        { kind: "alpha-video", path: "/presenter.webm", x: 40, y: 40 },
      ],
    });
    expect(plan.audioFromLayerIndex).toBe(0);
    const joined = plan.args.join(" ");
    expect(joined).toContain("-map [vout]");
    expect(joined).toContain("-map 0:a? -c:a copy");
    expect(joined).not.toContain("-an");
  });

  it("produces a silent output when no layer can carry audio", () => {
    const plan = buildCompositeLayersArgs({ ...BASE, layers: fullStack() });
    expect(plan.audioFromLayerIndex).toBeNull();
    expect(plan.args).toContain("-an");
    expect(plan.args.join(" ")).not.toContain("-map 0:a?");
  });

  it("honours an explicit audio layer index", () => {
    const plan = buildCompositeLayersArgs({
      ...BASE,
      layers: [
        { kind: "image", path: "/mat.png", x: 0, y: 0 },
        { kind: "video", path: "/interview.mp4", x: 0, y: 0 },
      ],
      audioFromLayerIndex: 1,
    });
    expect(plan.args.join(" ")).toContain("-map 1:a?");
  });

  it("pins the length in frames and in seconds, and ends with the output path", () => {
    const plan = buildCompositeLayersArgs({ ...BASE, layers: fullStack() });
    const joined = plan.args.join(" ");
    expect(joined).toContain("-frames:v 150");
    expect(joined).toContain("-t 5");
    expect(joined).toContain("-r 30");
    expect(joined).toContain("-c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium");
    expect(plan.args[plan.args.length - 1]).toBe("/out/scene-s07.mp4");
    expect(plan.args[plan.args.length - 2]).toBe("-y");
  });

  it("honours encoder overrides", () => {
    const plan = buildCompositeLayersArgs({
      ...BASE,
      layers: fullStack(),
      videoCodec: "h264_nvenc",
      crf: 22,
      preset: "p4",
    });
    expect(plan.args.join(" ")).toContain("-c:v h264_nvenc");
    expect(plan.args.join(" ")).toContain("-crf 22 -preset p4");
  });
});

describe("buildCompositeLayersArgs — fail-closed guards", () => {
  const ground: CompositeLayer = { kind: "image", path: "/g.png", x: 0, y: 0 };

  it("refuses an empty stack", () => {
    expect(() => buildCompositeLayersArgs({ ...BASE, layers: [] })).toThrow(
      /layer stack is empty/,
    );
  });

  it("refuses an odd output dimension rather than failing at encode time", () => {
    expect(() =>
      buildCompositeLayersArgs({ ...BASE, width: 1921, layers: [ground] }),
    ).toThrow(/odd dimension/);
  });

  it("refuses non-positive fps, duration and empty output path", () => {
    expect(() => buildCompositeLayersArgs({ ...BASE, fps: 0, layers: [ground] })).toThrow(
      /fps must be a positive/,
    );
    expect(() =>
      buildCompositeLayersArgs({ ...BASE, durationFrames: 0, layers: [ground] }),
    ).toThrow(/durationFrames must be an integer >= 1/);
    expect(() =>
      buildCompositeLayersArgs({ ...BASE, outputPath: "  ", layers: [ground] }),
    ).toThrow(/outputPath is empty/);
  });

  it("refuses an unresolved asset path instead of substituting a placeholder", () => {
    expect(() =>
      buildCompositeLayersArgs({
        ...BASE,
        layers: [ground, { kind: "image", path: "", x: 0, y: 0 }],
      }),
    ).toThrow(/empty path/);
  });

  it("refuses invalid scale, opacity, blur and rotation", () => {
    expect(() =>
      buildCompositeLayersArgs({
        ...BASE,
        layers: [ground, { kind: "image", path: "/a.png", x: 0, y: 0, scale: 0 }],
      }),
    ).toThrow(/scale must be a finite number > 0/);
    expect(() =>
      buildCompositeLayersArgs({
        ...BASE,
        layers: [ground, { kind: "image", path: "/a.png", x: 0, y: 0, opacity: 0 }],
      }),
    ).toThrow(/opacity must be in \(0, 1\]/);
    expect(() =>
      buildCompositeLayersArgs({
        ...BASE,
        layers: [ground, { kind: "image", path: "/a.png", x: 0, y: 0, blur: -1 }],
      }),
    ).toThrow(/blur must be a finite number >= 0/);
    expect(() =>
      buildCompositeLayersArgs({
        ...BASE,
        layers: [ground, { kind: "image", path: "/a.png", x: 0, y: 0, rotate: Number.NaN }],
      }),
    ).toThrow(/rotate must be a finite number/);
  });

  it("refuses a layer whose visibility window is empty or past the end of the scene", () => {
    expect(() =>
      buildCompositeLayersArgs({
        ...BASE,
        layers: [
          ground,
          { kind: "image", path: "/a.png", x: 0, y: 0, enableFrom: 3, enableTo: 2 },
        ],
      }),
    ).toThrow(/enableTo \(2s\) <= enableFrom \(3s\)/);
    expect(() =>
      buildCompositeLayersArgs({
        ...BASE,
        layers: [ground, { kind: "image", path: "/a.png", x: 0, y: 0, enableFrom: 9 }],
      }),
    ).toThrow(/at or past the scene duration/);
  });

  it("refuses transform or timing on the ground layer", () => {
    expect(() =>
      buildCompositeLayersArgs({
        ...BASE,
        layers: [{ kind: "image", path: "/g.png", x: 0, y: 0, scale: 1.2, opacity: 0.5 }],
      }),
    ).toThrow(/may not set scale, opacity/);
  });

  it("refuses an audio index that is out of range or cannot carry audio", () => {
    expect(() =>
      buildCompositeLayersArgs({ ...BASE, layers: [ground], audioFromLayerIndex: 3 }),
    ).toThrow(/out of range/);
    expect(() =>
      buildCompositeLayersArgs({ ...BASE, layers: [ground], audioFromLayerIndex: 0 }),
    ).toThrow(/can never carry an audio track/);
  });

  it("refuses an out-of-range crf and a negative grade blur", () => {
    expect(() =>
      buildCompositeLayersArgs({ ...BASE, layers: [ground], crf: 99 }),
    ).toThrow(/crf must be an integer/);
    expect(() =>
      buildCompositeLayersArgs({ ...BASE, layers: [ground], grade: { blur: -2 } }),
    ).toThrow(/grade.blur must be a finite number >= 0/);
  });

  it("throws CompositeLayersError, not a bare Error", () => {
    expect(() => buildCompositeLayersArgs({ ...BASE, layers: [] })).toThrow(
      CompositeLayersError,
    );
  });
});

describe("buildCompositeLayersArgs — per-layer grade", () => {
  it("grades ONLY the ground, leaving the type and the figure over it alone", () => {
    // The whole reason LayerTransform.grade exists: a near-white stock plate has
    // to be pulled into the format's palette, and the caption drawn on top of it
    // must not come along for the ride. Grading the finished stack (params.grade)
    // would desaturate and darken the typography too.
    const { filterComplex } = buildCompositeLayersArgs({
      ...BASE,
      layers: [
        {
          kind: "image",
          path: "/lib/stock.jpg",
          x: 0,
          y: 0,
          grade: {
            eq: { saturation: 0.45, brightness: -0.22 },
            channelMixer: { rr: 0.88, bb: 1.12 },
          },
        },
        { kind: "image", path: "/assets/copy.png", x: 0, y: 0 },
      ],
    });
    expect(filterComplex).toContain("eq=brightness=-0.22:saturation=0.45");
    expect(filterComplex).toContain("colorchannelmixer=rr=0.88:bb=1.12");
    // Exactly one eq and one colorchannelmixer in the whole graph — the copy
    // plate contributes neither, so nothing touches the typography.
    expect(filterComplex.match(/eq=/g)).toHaveLength(1);
    expect(filterComplex.match(/colorchannelmixer=/g)).toHaveLength(1);
    // ...and both hang off the GROUND's chain (input 0), not the copy plate's.
    const gradeChain = filterComplex
      .split(";")
      .find((chain) => chain.includes("eq="))!;
    expect(gradeChain).toMatch(/^\[fg\d+\]/);
    expect(gradeChain).not.toContain("[1:v]");
  });

  it("grades before it defocuses, so the correction lands on intact detail", () => {
    const { filterComplex } = buildCompositeLayersArgs({
      ...BASE,
      layers: [
        {
          kind: "image",
          path: "/lib/stock.jpg",
          x: 0,
          y: 0,
          blur: 5,
          grade: { eq: { saturation: 0.45 } },
        },
      ],
    });
    expect(filterComplex.indexOf("eq=")).toBeLessThan(
      filterComplex.indexOf("gblur="),
    );
  });

  it("applies a grade on an overlay layer too", () => {
    const { filterComplex } = buildCompositeLayersArgs({
      ...BASE,
      layers: [
        { kind: "color", color: "#0b0f14", x: 0, y: 0 },
        {
          kind: "image",
          path: "/lib/clipping.png",
          x: 200,
          y: 200,
          grade: { eq: { contrast: 1.2 } },
        },
      ],
    });
    expect(filterComplex).toContain("eq=contrast=1.2");
  });

  it("rejects a negative grade blur rather than silently dropping the filter", () => {
    expect(() =>
      buildCompositeLayersArgs({
        ...BASE,
        layers: [
          { kind: "image", path: "/lib/stock.jpg", x: 0, y: 0, grade: { blur: -1 } },
        ],
      }),
    ).toThrow(CompositeLayersError);
  });
});
