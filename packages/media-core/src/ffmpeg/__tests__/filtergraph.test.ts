import { describe, it, expect } from "vitest";
import {
  FilterGraph,
  FilterGraphError,
  escapeFilterValue,
  fmtNumber,
  labelRef,
  type Label,
} from "../filtergraph.js";

describe("escapeFilterValue", () => {
  it("leaves plain values unquoted so the graph stays readable", () => {
    expect(escapeFilterValue("auto")).toBe("auto");
    expect(escapeFilterValue("1920")).toBe("1920");
    expect(escapeFilterValue("W-w-40")).toBe("W-w-40");
    expect(escapeFilterValue("rotw(0.0873)")).toBe("rotw(0.0873)");
  });

  it("quotes values containing filtergraph-structural characters", () => {
    expect(escapeFilterValue("between(t,3,7.5)")).toBe("'between(t,3,7.5)'");
    expect(escapeFilterValue("C:/media/plate.png")).toBe("'C:/media/plate.png'");
    expect(escapeFilterValue("a;b")).toBe("'a;b'");
    expect(escapeFilterValue("[x]")).toBe("'[x]'");
  });

  it("emits a literal apostrophe as close-escape-reopen", () => {
    expect(escapeFilterValue("it's here")).toBe("'it'\\''s here'");
  });
});

describe("fmtNumber", () => {
  it("keeps integers integral and clamps float noise", () => {
    expect(fmtNumber(1920, "w")).toBe("1920");
    expect(fmtNumber(0.1 + 0.2, "x")).toBe("0.3");
    expect(fmtNumber(-3.5, "x")).toBe("-3.5");
  });

  it("throws on NaN and Infinity rather than emitting them", () => {
    expect(() => fmtNumber(Number.NaN, "scale")).toThrow(FilterGraphError);
    expect(() => fmtNumber(Number.POSITIVE_INFINITY, "scale")).toThrow(/finite number/);
  });
});

describe("FilterGraph — serialisation", () => {
  it("builds the canonical scale/crop/overlay stack with allocated labels", () => {
    const g = new FilterGraph();
    const base = g.scaleCropToFill(g.source(0, "video"), { width: 1920, height: 1080 });
    const mark = g.scaleBy(g.source(1, "video"), 0.5);
    const out = g.overlay(base, mark, { x: "W-w-40", y: "H-h-40", format: "auto" });
    g.output(out, "vout");

    expect(g.build()).toBe(
      "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1[fg0];" +
        "[1:v]scale=iw*0.5:ih*0.5[fg1];" +
        "[fg0][fg1]overlay=x=W-w-40:y=H-h-40:format=auto[fg2];" +
        "[fg2]null[vout]",
    );
  });

  it("quotes an overlay enable expression so its commas survive the parser", () => {
    const g = new FilterGraph();
    const a = g.source(0, "video");
    const b = g.source(1, "video");
    g.output(g.overlay(a, b, { enable: "between(t,3,7.5)", eofAction: "pass" }), "vout");
    expect(g.build()).toContain(
      "overlay=x=0:y=0:eof_action=pass:enable='between(t,3,7.5)'",
    );
  });

  it("emits rotate in radians with an expanded output frame", () => {
    const g = new FilterGraph();
    const r = g.rotate(g.source(0, "video"), { angleDeg: 3 });
    g.output(r, "vout");
    const rad = fmtNumber((3 * Math.PI) / 180, "a");
    expect(g.build()).toContain(`rotate=${rad}:c=none:ow=rotw(${rad}):oh=roth(${rad})`);
  });

  it("emits grading, blur and fade nodes", () => {
    const g = new FilterGraph();
    let cur = g.source(0, "video");
    cur = g.eq(cur, { contrast: 1.04, saturation: 0.92 });
    cur = g.colorchannelmixer(cur, { rr: 0.95, bb: 1.06 });
    cur = g.gblur(cur, { sigma: 12 });
    cur = g.boxblur(cur, { lumaRadius: 4, lumaPower: 2 });
    cur = g.fade(cur, { type: "in", startFrame: 0, durationFrames: 12, alpha: true });
    g.output(cur, "vout");
    const s = g.build();
    expect(s).toContain("eq=contrast=1.04:saturation=0.92");
    expect(s).toContain("colorchannelmixer=rr=0.95:bb=1.06");
    expect(s).toContain("gblur=sigma=12");
    expect(s).toContain("boxblur=luma_radius=4:luma_power=2");
    expect(s).toContain("fade=t=in:s=0:n=12:alpha=1");
  });

  it("interleaves concat inputs as [v0][a0][v1][a1] and returns both outputs", () => {
    const g = new FilterGraph();
    const v0 = g.source(0, "video");
    const a0 = g.source(0, "audio");
    const v1 = g.source(1, "video");
    const a1 = g.source(1, "audio");
    const joined = g.concat([
      { video: v0, audio: a0 },
      { video: v1, audio: a1 },
    ]);
    g.output(joined.video!, "vout");
    g.output(joined.audio!, "aout");
    const s = g.build();
    expect(s).toContain("[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[fg0][fg1]");
    expect(s).toContain("[fg0]null[vout]");
    expect(s).toContain("[fg1]anull[aout]");
  });

  it("splits a stream so it can legally be consumed twice", () => {
    const g = new FilterGraph();
    const [a, b] = g.split(g.source(0, "video"), 2);
    const blurred = g.gblur(a!, { sigma: 20 });
    g.output(g.overlay(blurred, b!, { x: 100, y: 50 }), "vout");
    expect(g.build()).toContain("[0:v]split=2[fg0][fg1]");
  });

  it("uses anull when renaming an audio label", () => {
    const g = new FilterGraph();
    const a = g.source(0, "audio");
    const [x, y] = g.split(a, 2);
    g.output(x!, "a1");
    g.output(y!, "a2");
    const s = g.build();
    expect(s).toContain("[0:a]asplit=2[fg0][fg1]");
    expect(s).toContain("[fg0]anull[a1]");
  });

  it("supports a custom escape-hatch node with tracked labels", () => {
    const g = new FilterGraph();
    const [out] = g.custom([g.source(0, "video")], ["setpts=2*PTS"], ["video"]);
    g.output(out!, "vout");
    expect(g.build()).toBe("[0:v]setpts=2*PTS[fg0];[fg0]null[vout]");
  });

  it("markTerminal exports a label without an extra null node", () => {
    const g = new FilterGraph();
    const scaled = g.scaleCropToFill(g.source(0, "video"), { width: 1280, height: 720 });
    g.markTerminal(scaled);
    expect(g.build()).toBe(
      "[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1[fg0]",
    );
    expect(g.terminals().map((l) => labelRef(l))).toEqual(["[fg0]"]);
  });
});

describe("FilterGraph — guards", () => {
  it("throws when a label is consumed twice without split()", () => {
    const g = new FilterGraph();
    const src = g.source(0, "video");
    g.gblur(src, { sigma: 2 });
    expect(() => g.scaleBy(src, 0.5)).toThrow(/consumed twice/);
  });

  it("throws when the same label is both inputs of one node", () => {
    const g = new FilterGraph();
    const src = g.source(0, "video");
    expect(() => g.overlay(src, src)).toThrow(/twice as an input to the same node/);
  });

  it("throws when an overlay's second input was never declared", () => {
    const g = new FilterGraph();
    const base = g.source(0, "video");
    // The classic bug: [1:v] referenced although only one -i was passed.
    const undeclared: Label = { id: "1:v", kind: "video" };
    expect(() => g.overlay(base, undeclared)).toThrow(/never declared/);
  });

  it("throws when an output label name is reused", () => {
    const g = new FilterGraph();
    const [a, b] = g.split(g.source(0, "video"), 2);
    g.output(a!, "vout");
    expect(() => g.output(b!, "vout")).toThrow(/already declared/);
  });

  it("throws on a dangling produced label at build time", () => {
    const g = new FilterGraph();
    const [a, b] = g.split(g.source(0, "video"), 2);
    g.output(a!, "vout");
    void b; // b is produced but never consumed and never exported
    expect(() => g.build()).toThrow(/dangling label\(s\) \[fg1\]/);
  });

  it("throws on a declared input stream that is never used", () => {
    const g = new FilterGraph();
    g.output(g.source(0, "video"), "vout");
    g.source(1, "video");
    expect(() => g.build()).toThrow(/dangling label\(s\) \[1:v\]/);
  });

  it("throws when the same FFmpeg stream is declared twice", () => {
    const g = new FilterGraph();
    g.source(0, "video");
    expect(() => g.source(0, "video")).toThrow(/declared twice/);
  });

  it("throws when an audio label is fed to a video-only filter", () => {
    const g = new FilterGraph();
    const a = g.source(0, "audio");
    expect(() => g.gblur(a, { sigma: 1 })).toThrow(/requires a video label/);
    expect(() => g.fade(a, { type: "in", startFrame: 0, durationFrames: 2 })).toThrow(
      /requires a video label/,
    );
  });

  it("throws when a label's kind is spoofed", () => {
    const g = new FilterGraph();
    const v = g.source(0, "video");
    const spoofed: Label = { id: v.id, kind: "audio" };
    expect(() => g.nullPass(spoofed)).toThrow(/declared as video/);
  });

  it("throws when building an empty graph or a graph with no outputs", () => {
    expect(() => new FilterGraph().build()).toThrow(/empty graph/);
    const g = new FilterGraph();
    g.gblur(g.source(0, "video"), { sigma: 1 });
    expect(() => g.build()).toThrow(/no outputs/);
  });

  it("rejects invalid output label names", () => {
    const g = new FilterGraph();
    const v = g.source(0, "video");
    expect(() => g.output(v, "0:v")).toThrow(/is invalid/);
  });

  it("rejects out-of-range numeric parameters", () => {
    const g = new FilterGraph();
    expect(() => g.scaleBy(g.source(0, "video"), 0)).toThrow(/must be > 0/);
    const g2 = new FilterGraph();
    expect(() => g2.gblur(g2.source(0, "video"), { sigma: -1 })).toThrow(/must be >= 0/);
    const g3 = new FilterGraph();
    expect(() => g3.split(g3.source(0, "video"), 1)).toThrow(/integer >= 2/);
    const g4 = new FilterGraph();
    expect(() => g4.colorchannelmixer(g4.source(0, "video"), {})).toThrow(/empty matrix/);
    const g5 = new FilterGraph();
    expect(() => g5.eq(g5.source(0, "video"), {})).toThrow(/no adjustments/);
    const g6 = new FilterGraph();
    expect(() =>
      g6.fade(g6.source(0, "video"), { type: "out", startFrame: 0, durationFrames: 0 }),
    ).toThrow(/integer >= 1/);
    const g7 = new FilterGraph();
    expect(() => g7.source(-1, "video")).toThrow(/non-negative integer/);
  });

  it("rejects a concat with fewer than two segments or mismatched stream shapes", () => {
    const g = new FilterGraph();
    expect(() => g.concat([{ video: g.source(0, "video") }])).toThrow(/at least 2 segments/);

    const g2 = new FilterGraph();
    const v0 = g2.source(0, "video");
    const a0 = g2.source(0, "audio");
    const v1 = g2.source(1, "video");
    expect(() => g2.concat([{ video: v0, audio: a0 }, { video: v1 }])).toThrow(
      /different stream shape/,
    );
  });

  it("refuses to mark a consumed label as terminal", () => {
    const g = new FilterGraph();
    const v = g.source(0, "video");
    const blurred = g.gblur(v, { sigma: 3 });
    g.output(blurred, "vout");
    expect(() => g.markTerminal(v)).toThrow(/already consumed/);
  });

  it("leaves the graph untouched when a node throws", () => {
    const g = new FilterGraph();
    const base = g.scaleCropToFill(g.source(0, "video"), { width: 640, height: 360 });
    expect(() => g.overlay(base, { id: "9:v", kind: "video" })).toThrow(FilterGraphError);
    // base must still be consumable — the failed node recorded nothing.
    g.output(g.gblur(base, { sigma: 1 }), "vout");
    expect(g.build()).toContain("[fg0]gblur=sigma=1[fg1];[fg1]null[vout]");
  });
});
