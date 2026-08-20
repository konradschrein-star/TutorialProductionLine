/**
 * Typed FFmpeg `filter_complex` builder.
 *
 * Every other caller in this repo hand-builds `filter_complex` by pushing
 * strings into an array and joining them with `;`. That works right up until
 * one of four classic bugs lands:
 *
 *   1. the same output label is produced twice (`[v]` written by two nodes),
 *   2. the same label is consumed twice without a `split` (FFmpeg errors with
 *      "Filter ... has an unconnected output" or silently mis-wires),
 *   3. a produced label is never consumed and never mapped (dangling output —
 *      FFmpeg fails the whole graph),
 *   4. a two-input filter (`overlay`, `concat`) references an input stream that
 *      was never declared, e.g. `[1:v]` when only one `-i` was passed.
 *
 * This builder makes all four impossible: it allocates every intermediate label
 * itself, tracks production and consumption, and **throws** at build time with a
 * diagnostic naming the offending label. It is PURE — it produces a string and
 * runs nothing — so it is fully unit-testable.
 *
 * Fail-closed: nothing here guesses. An unknown label, a kind mismatch
 * (audio label into `overlay`), or a non-finite number throws rather than
 * emitting a filtergraph that FFmpeg will reject 40 minutes into a render.
 *
 * @example
 * ```ts
 * const g = new FilterGraph();
 * const base = g.scaleCropToFill(g.source(0, "video"), { width: 1920, height: 1080 });
 * const mark = g.scaleBy(g.source(1, "video"), 0.5);
 * const out  = g.overlay(base, mark, { x: "W-w-40", y: "H-h-40", format: "auto" });
 * g.output(out, "vout");
 * g.build(); // "[0:v]scale=...[fg0];[1:v]scale=...[fg1];[fg0][fg1]overlay=...[fg2];[fg2]null[vout]"
 * ```
 */

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Thrown for every filtergraph construction defect: unknown label, reused
 * label, dangling output, kind mismatch, or an out-of-range parameter.
 */
export class FilterGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterGraphError";
  }
}

// ─── Labels ──────────────────────────────────────────────────────────────────

/** Which stream a label carries. Guards `overlay`/`fade` (video) vs `anull` (audio). */
export type StreamKind = "video" | "audio";

/**
 * A handle to one stream inside the graph. Never construct one by hand — obtain
 * it from `FilterGraph.source()` or from a node method. Hand-made labels are
 * rejected by `assertKnown()` because they were never declared.
 */
export interface Label {
  /** The bare label text, without brackets. `"0:v"` for a source, `"fg3"` for an intermediate. */
  readonly id: string;
  readonly kind: StreamKind;
}

/** Render a label as a filtergraph reference: `{ id: "fg0" }` → `"[fg0]"`. */
export function labelRef(label: Label): string {
  return `[${label.id}]`;
}

// ─── Value formatting / escaping ─────────────────────────────────────────────

/**
 * Format a number for a filter argument. Integers stay integral; fractions are
 * clamped to 6 decimal places so `0.1 + 0.2` does not leak into the graph.
 *
 * @throws {FilterGraphError} if the value is NaN or Infinity.
 */
export function fmtNumber(n: number, what: string): string {
  if (!Number.isFinite(n)) {
    throw new FilterGraphError(
      `[filtergraph] ${what} must be a finite number, received ${String(n)}. ` +
        `Refusing to emit a filtergraph with a NaN/Infinity argument.`,
    );
  }
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(6)));
}

const NEEDS_QUOTE_RE = /[,:;'[\]\\ ]/;

/**
 * Escape a filter option *value* for `filter_complex`.
 *
 * FFmpeg's tokenizer treats `, : ; [ ] \` and whitespace as structural. A value
 * containing any of them is wrapped in single quotes; a literal `'` inside is
 * emitted as `'\''` (close, escape, reopen) which is FFmpeg's documented form.
 * Values with no special characters are passed through unquoted so the emitted
 * graph stays readable and diffable.
 */
export function escapeFilterValue(value: string): string {
  if (!NEEDS_QUOTE_RE.test(value)) return value;
  return `'${value.split("'").join("'\\''")}'`;
}

/** Join `key=value` pairs, skipping `undefined`, escaping every value. */
function joinArgs(
  pairs: ReadonlyArray<readonly [string, string | undefined]>,
): string {
  const parts: string[] = [];
  for (const [key, value] of pairs) {
    if (value === undefined) continue;
    parts.push(`${key}=${escapeFilterValue(value)}`);
  }
  return parts.join(":");
}

/** Format an `x`/`y`/expression argument that may be a number or an FFmpeg expression. */
function fmtExpr(value: number | string, what: string): string {
  return typeof value === "number" ? fmtNumber(value, what) : value;
}

// ─── Node ────────────────────────────────────────────────────────────────────

/**
 * One filterchain in the graph: `[in...]filter,filter[out...]`.
 * `chain` holds one or more comma-joined filters that share the same in/out
 * labels (e.g. `scale` + `crop` + `setsar` as a single node).
 */
export interface FilterNode {
  readonly inputs: readonly Label[];
  readonly chain: readonly string[];
  readonly outputs: readonly Label[];
}

// ─── Option types ────────────────────────────────────────────────────────────

/** Keys of FFmpeg's `colorchannelmixer` matrix. `aa` is the alpha-into-alpha term (opacity). */
export type ChannelMixerKey =
  | "rr"
  | "rg"
  | "rb"
  | "ra"
  | "gr"
  | "gg"
  | "gb"
  | "ga"
  | "br"
  | "bg"
  | "bb"
  | "ba"
  | "ar"
  | "ag"
  | "ab"
  | "aa";

export type ChannelMixerMatrix = Partial<Record<ChannelMixerKey, number>>;

export interface ScaleOptions {
  width: number | string;
  height: number | string;
  /** `increase` = cover (crop after), `decrease` = contain (pad after). */
  forceOriginalAspectRatio?: "increase" | "decrease" | "disable";
  /** libswscale flags, e.g. `"lanczos"`. */
  flags?: string;
}

export interface OverlayNodeOptions {
  x?: number | string;
  y?: number | string;
  /**
   * Timeline expression, e.g. `"between(t,3,7.5)"`. Commas are quoted for you.
   * Note this only *hides* the overlay — the overlaid stream still plays from
   * its own t=0.
   */
  enable?: string;
  /** `auto` preserves the overlay's alpha — required for alpha (yuva420p) layers. */
  format?:
    | "auto"
    | "rgb"
    | "yuv420"
    | "yuv420p10"
    | "yuv422"
    | "yuv444"
    | "gbrp";
  /** `pass` lets the main stream continue unchanged once the overlay ends. */
  eofAction?: "repeat" | "endall" | "pass";
  /** `true` ends the output when the shorter input ends. Default false. */
  shortest?: boolean;
}

export interface RotateOptions {
  /** Rotation in degrees, clockwise. Converted to radians for FFmpeg. */
  angleDeg: number;
  /** Fill colour for the exposed corners. `"none"` (transparent) by default — the input must carry alpha. */
  fillColor?: string;
  /** Grow the output frame so no corner is clipped. Default true. */
  expandToFit?: boolean;
}

export interface EqOptions {
  contrast?: number;
  brightness?: number;
  saturation?: number;
  gamma?: number;
  gammaR?: number;
  gammaG?: number;
  gammaB?: number;
}

export interface BoxblurOptions {
  lumaRadius: number | string;
  lumaPower?: number;
  chromaRadius?: number | string;
  chromaPower?: number;
}

export interface GblurOptions {
  sigma: number;
  steps?: number;
}

export interface FadeOptions {
  type: "in" | "out";
  startFrame: number;
  durationFrames: number;
  /** Fade the alpha channel instead of blending to `color`. */
  alpha?: boolean;
  /** Colour faded to/from when `alpha` is false. Default `"black"`. */
  color?: string;
}

/** One segment fed to `concat`. Video-only, audio-only, or both — but every segment must match. */
export interface ConcatSegment {
  video?: Label;
  audio?: Label;
}

export interface ConcatResult {
  video?: Label;
  audio?: Label;
}

// ─── Graph ───────────────────────────────────────────────────────────────────

const OUTPUT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Builds an FFmpeg `filter_complex` string node by node.
 *
 * Every method returns freshly-allocated `Label`s. Passing a label to a second
 * node without `split()` throws, as does building a graph with a produced label
 * that is neither consumed nor marked as an output.
 */
export class FilterGraph {
  private readonly nodes: FilterNode[] = [];
  /** Every label that exists, by id → declared kind. */
  private readonly declared = new Map<string, StreamKind>();
  /** Labels already used as an input somewhere → the node index that ate them. */
  private readonly consumed = new Map<string, number>();
  /** Labels marked as graph outputs (mapped by the caller with `-map`). */
  private readonly terminal = new Map<string, Label>();
  private counter = 0;
  private readonly prefix: string;

  constructor(options?: { labelPrefix?: string }) {
    this.prefix = options?.labelPrefix ?? "fg";
  }

  // ── Sources ────────────────────────────────────────────────────────────────

  /**
   * Declare an input stream from FFmpeg's `-i` list: `source(0, "video")` → `[0:v]`.
   *
   * @throws {FilterGraphError} if the index is not a non-negative integer, or if
   * the same stream is declared twice (an FFmpeg input can only be consumed
   * once — use `split()` to fan it out).
   */
  source(inputIndex: number, kind: StreamKind): Label {
    if (!Number.isInteger(inputIndex) || inputIndex < 0) {
      throw new FilterGraphError(
        `[filtergraph] source() input index must be a non-negative integer, received ${String(inputIndex)}.`,
      );
    }
    const id = `${inputIndex}:${kind === "video" ? "v" : "a"}`;
    if (this.declared.has(id)) {
      throw new FilterGraphError(
        `[filtergraph] input stream [${id}] was declared twice. An FFmpeg stream can only ` +
          `feed one filter — call split()/asplit() on the first label instead of re-declaring it.`,
      );
    }
    this.declared.set(id, kind);
    return { id, kind };
  }

  // ── Filters ────────────────────────────────────────────────────────────────

  /** `scale=W:H[:force_original_aspect_ratio=…][:flags=…]`. */
  scale(input: Label, options: ScaleOptions): Label {
    this.assertVideo(input, "scale");
    const parts: string[] = [
      fmtExpr(options.width, "scale width"),
      fmtExpr(options.height, "scale height"),
    ];
    const tail = joinArgs([
      ["force_original_aspect_ratio", options.forceOriginalAspectRatio],
      ["flags", options.flags],
    ]);
    const chain = `scale=${parts.join(":")}${tail ? `:${tail}` : ""}`;
    return this.addNode([input], [chain], ["video"])[0]!;
  }

  /**
   * Cover-fit: scale up until the frame is fully covered, centre-crop to exactly
   * `width`×`height`, then normalise the pixel aspect ratio. This is the
   * ground-plate / base-layer operation — no letterbox bars, ever.
   */
  scaleCropToFill(
    input: Label,
    options: { width: number; height: number },
  ): Label {
    this.assertVideo(input, "scaleCropToFill");
    const w = fmtNumber(options.width, "scaleCropToFill width");
    const h = fmtNumber(options.height, "scaleCropToFill height");
    return this.addNode(
      [input],
      [
        `scale=${w}:${h}:force_original_aspect_ratio=increase`,
        `crop=${w}:${h}`,
        `setsar=1`,
      ],
      ["video"],
    )[0]!;
  }

  /**
   * Uniform scale by a factor of the source dimensions: `scale=iw*f:ih*f`.
   * Requires no probe, so it cannot fail on a missing dimension.
   *
   * @throws {FilterGraphError} if the factor is not > 0.
   */
  scaleBy(input: Label, factor: number): Label {
    this.assertVideo(input, "scaleBy");
    const f = fmtNumber(factor, "scaleBy factor");
    if (factor <= 0) {
      throw new FilterGraphError(
        `[filtergraph] scaleBy factor must be > 0, received ${f}.`,
      );
    }
    return this.addNode([input], [`scale=iw*${f}:ih*${f}`], ["video"])[0]!;
  }

  /** `setsar=<ratio>` — normalise the pixel aspect ratio. */
  setsar(input: Label, ratio = 1): Label {
    this.assertVideo(input, "setsar");
    return this.addNode(
      [input],
      [`setsar=${fmtNumber(ratio, "setsar ratio")}`],
      ["video"],
    )[0]!;
  }

  /**
   * `overlay` — composite `over` on top of `base`.
   *
   * @throws {FilterGraphError} if either label is audio, unknown, or already consumed.
   */
  overlay(base: Label, over: Label, options: OverlayNodeOptions = {}): Label {
    this.assertVideo(base, "overlay base");
    this.assertVideo(over, "overlay overlay-input");
    const args = joinArgs([
      ["x", fmtExpr(options.x ?? 0, "overlay x")],
      ["y", fmtExpr(options.y ?? 0, "overlay y")],
      ["format", options.format],
      ["eof_action", options.eofAction],
      [
        "shortest",
        options.shortest === undefined
          ? undefined
          : options.shortest
            ? "1"
            : "0",
      ],
      ["enable", options.enable],
    ]);
    return this.addNode([base, over], [`overlay=${args}`], ["video"])[0]!;
  }

  /**
   * `rotate` by degrees. Defaults to a transparent fill and an expanded output
   * frame so the corners are not clipped — the "nothing is axis-aligned" rule
   * only reads correctly if the rotated plate keeps its alpha.
   *
   * The input must already carry alpha when `fillColor` is `"none"`; use
   * `format(input, "rgba")` first.
   */
  rotate(input: Label, options: RotateOptions): Label {
    this.assertVideo(input, "rotate");
    const rad = (options.angleDeg * Math.PI) / 180;
    const a = fmtNumber(rad, "rotate angle");
    const expand = options.expandToFit ?? true;
    const args = joinArgs([
      ["c", options.fillColor ?? "none"],
      ["ow", expand ? `rotw(${a})` : undefined],
      ["oh", expand ? `roth(${a})` : undefined],
    ]);
    return this.addNode([input], [`rotate=${a}:${args}`], ["video"])[0]!;
  }

  /**
   * `colorchannelmixer` — channel matrix grading, and the only correct way to
   * apply layer opacity (`{ aa: 0.4 }`). The input must carry alpha for `aa`.
   *
   * @throws {FilterGraphError} if the matrix is empty.
   */
  colorchannelmixer(input: Label, matrix: ChannelMixerMatrix): Label {
    this.assertVideo(input, "colorchannelmixer");
    const entries = Object.entries(matrix).filter(
      (e): e is [ChannelMixerKey, number] => e[1] !== undefined,
    );
    if (entries.length === 0) {
      throw new FilterGraphError(
        `[filtergraph] colorchannelmixer was given an empty matrix. Pass at least one ` +
          `coefficient (e.g. { aa: 0.5 }) or do not add the node at all.`,
      );
    }
    const args = entries
      .map(([k, v]) => `${k}=${fmtNumber(v, `colorchannelmixer ${k}`)}`)
      .join(":");
    return this.addNode([input], [`colorchannelmixer=${args}`], ["video"])[0]!;
  }

  /**
   * `eq` — contrast / brightness / saturation / gamma grading.
   *
   * @throws {FilterGraphError} if no adjustment was supplied.
   */
  eq(input: Label, options: EqOptions): Label {
    this.assertVideo(input, "eq");
    const args = joinArgs([
      ["contrast", num(options.contrast, "eq contrast")],
      ["brightness", num(options.brightness, "eq brightness")],
      ["saturation", num(options.saturation, "eq saturation")],
      ["gamma", num(options.gamma, "eq gamma")],
      ["gamma_r", num(options.gammaR, "eq gamma_r")],
      ["gamma_g", num(options.gammaG, "eq gamma_g")],
      ["gamma_b", num(options.gammaB, "eq gamma_b")],
    ]);
    if (args === "") {
      throw new FilterGraphError(
        `[filtergraph] eq() was given no adjustments. Supply at least one of ` +
          `contrast/brightness/saturation/gamma, or do not add the node.`,
      );
    }
    return this.addNode([input], [`eq=${args}`], ["video"])[0]!;
  }

  /** `boxblur` — cheap box blur, used for defocused b-roll grounds. */
  boxblur(input: Label, options: BoxblurOptions): Label {
    this.assertVideo(input, "boxblur");
    const args = joinArgs([
      ["luma_radius", fmtExpr(options.lumaRadius, "boxblur luma_radius")],
      ["luma_power", num(options.lumaPower, "boxblur luma_power")],
      [
        "chroma_radius",
        options.chromaRadius === undefined
          ? undefined
          : fmtExpr(options.chromaRadius, "boxblur chroma_radius"),
      ],
      ["chroma_power", num(options.chromaPower, "boxblur chroma_power")],
    ]);
    return this.addNode([input], [`boxblur=${args}`], ["video"])[0]!;
  }

  /**
   * `gblur` — gaussian blur.
   *
   * @throws {FilterGraphError} if sigma is negative.
   */
  gblur(input: Label, options: GblurOptions): Label {
    this.assertVideo(input, "gblur");
    if (options.sigma < 0) {
      throw new FilterGraphError(
        `[filtergraph] gblur sigma must be >= 0, received ${fmtNumber(options.sigma, "gblur sigma")}.`,
      );
    }
    const args = joinArgs([
      ["sigma", fmtNumber(options.sigma, "gblur sigma")],
      ["steps", num(options.steps, "gblur steps")],
    ]);
    return this.addNode([input], [`gblur=${args}`], ["video"])[0]!;
  }

  /**
   * `fade` in frame units (`s=` / `n=`), so a fade lines up exactly with a
   * scene boundary computed in frames.
   *
   * @throws {FilterGraphError} on an audio label, a negative start, or a
   * duration < 1 frame.
   */
  fade(input: Label, options: FadeOptions): Label {
    this.assertVideo(input, "fade");
    if (!Number.isInteger(options.startFrame) || options.startFrame < 0) {
      throw new FilterGraphError(
        `[filtergraph] fade startFrame must be a non-negative integer, received ${String(options.startFrame)}.`,
      );
    }
    if (
      !Number.isInteger(options.durationFrames) ||
      options.durationFrames < 1
    ) {
      throw new FilterGraphError(
        `[filtergraph] fade durationFrames must be an integer >= 1, received ${String(options.durationFrames)}.`,
      );
    }
    const args = joinArgs([
      ["t", options.type],
      ["s", String(options.startFrame)],
      ["n", String(options.durationFrames)],
      [
        "alpha",
        options.alpha === undefined ? undefined : options.alpha ? "1" : "0",
      ],
      ["color", options.color],
    ]);
    return this.addNode([input], [`fade=${args}`], ["video"])[0]!;
  }

  /**
   * `concat` — join segments end to end. Segments are declared as
   * `{ video, audio }` pairs and the interleaved input order FFmpeg requires
   * (`[v0][a0][v1][a1]…`) is generated for you; getting that order wrong by
   * hand is the other classic concat bug.
   *
   * @throws {FilterGraphError} if fewer than two segments are given, if the
   * segments disagree about which streams they carry, or if a segment carries
   * neither stream.
   */
  concat(segments: readonly ConcatSegment[]): ConcatResult {
    if (segments.length < 2) {
      throw new FilterGraphError(
        `[filtergraph] concat needs at least 2 segments, received ${segments.length}. ` +
          `A single-segment concat is always a planner bug.`,
      );
    }
    const first = segments[0]!;
    const hasVideo = first.video !== undefined;
    const hasAudio = first.audio !== undefined;
    if (!hasVideo && !hasAudio) {
      throw new FilterGraphError(
        `[filtergraph] concat segment 0 carries neither a video nor an audio label.`,
      );
    }
    const inputs: Label[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      if (
        (seg.video !== undefined) !== hasVideo ||
        (seg.audio !== undefined) !== hasAudio
      ) {
        throw new FilterGraphError(
          `[filtergraph] concat segment ${i} has a different stream shape than segment 0 ` +
            `(segment 0: video=${hasVideo} audio=${hasAudio}; ` +
            `segment ${i}: video=${seg.video !== undefined} audio=${seg.audio !== undefined}). ` +
            `Every concat segment must carry the same streams.`,
        );
      }
      if (seg.video) {
        this.assertVideo(seg.video, `concat segment ${i} video`);
        inputs.push(seg.video);
      }
      if (seg.audio) {
        this.assertAudio(seg.audio, `concat segment ${i} audio`);
        inputs.push(seg.audio);
      }
    }
    const v = hasVideo ? 1 : 0;
    const a = hasAudio ? 1 : 0;
    const outKinds: StreamKind[] = [];
    if (hasVideo) outKinds.push("video");
    if (hasAudio) outKinds.push("audio");
    const outs = this.addNode(
      inputs,
      [`concat=n=${segments.length}:v=${v}:a=${a}`],
      outKinds,
    );
    const result: ConcatResult = {};
    let cursor = 0;
    if (hasVideo) result.video = outs[cursor++]!;
    if (hasAudio) result.audio = outs[cursor++]!;
    return result;
  }

  /**
   * `split` / `asplit` — the only legal way to consume a stream twice.
   *
   * @throws {FilterGraphError} if `count` is not an integer >= 2.
   */
  split(input: Label, count: number): Label[] {
    if (!Number.isInteger(count) || count < 2) {
      throw new FilterGraphError(
        `[filtergraph] split count must be an integer >= 2, received ${String(count)}.`,
      );
    }
    const filter = input.kind === "video" ? "split" : "asplit";
    const kinds: StreamKind[] = new Array<StreamKind>(count).fill(input.kind);
    return this.addNode([input], [`${filter}=${count}`], kinds);
  }

  /** `format=<pix_fmt>[|<pix_fmt>…]` — force a pixel format (e.g. `rgba` before a rotate). */
  format(input: Label, pixelFormats: string | readonly string[]): Label {
    this.assertVideo(input, "format");
    const list =
      typeof pixelFormats === "string" ? [pixelFormats] : [...pixelFormats];
    if (list.length === 0) {
      throw new FilterGraphError(
        `[filtergraph] format() requires at least one pixel format.`,
      );
    }
    return this.addNode([input], [`format=${list.join("|")}`], ["video"])[0]!;
  }

  /** `null` / `anull` — a no-op node, used to rename a label (FFmpeg cannot alias). */
  nullPass(input: Label): Label {
    const filter = input.kind === "video" ? "null" : "anull";
    return this.addNode([input], [filter], [input.kind])[0]!;
  }

  /**
   * Escape hatch for a filter this builder does not model. Inputs and outputs
   * are still tracked and guarded; the `chain` text is emitted verbatim, so the
   * caller owns escaping it (see `escapeFilterValue`).
   *
   * @throws {FilterGraphError} if the chain is empty or no outputs are requested.
   */
  custom(
    inputs: readonly Label[],
    chain: string | readonly string[],
    outputKinds: readonly StreamKind[],
  ): Label[] {
    const chainList = typeof chain === "string" ? [chain] : [...chain];
    if (chainList.length === 0 || chainList.some((c) => c.trim() === "")) {
      throw new FilterGraphError(
        `[filtergraph] custom() requires a non-empty filter chain.`,
      );
    }
    if (outputKinds.length === 0) {
      throw new FilterGraphError(
        `[filtergraph] custom() requires at least one output. A sink filter cannot be ` +
          `expressed in a filter_complex graph this builder validates.`,
      );
    }
    return this.addNode([...inputs], chainList, [...outputKinds]);
  }

  // ── Outputs ────────────────────────────────────────────────────────────────

  /**
   * Rename `label` to a stable, mappable name (`-map "[vout]"`) via a `null`
   * node and mark it as a graph output.
   *
   * @throws {FilterGraphError} if the name is not `[A-Za-z][A-Za-z0-9_]*` or is
   * already taken — a reused output label is the #1 hand-built-filtergraph bug.
   */
  output(label: Label, name: string): Label {
    if (!OUTPUT_NAME_RE.test(name)) {
      throw new FilterGraphError(
        `[filtergraph] output name "${name}" is invalid. Use letters, digits and ` +
          `underscores, starting with a letter (FFmpeg label syntax).`,
      );
    }
    if (this.declared.has(name)) {
      throw new FilterGraphError(
        `[filtergraph] output label [${name}] is already declared. Each label may be ` +
          `produced exactly once — pick a different name.`,
      );
    }
    const filter = label.kind === "video" ? "null" : "anull";
    const named: Label = { id: name, kind: label.kind };
    this.addNodeWithExplicitOutputs([label], [filter], [named]);
    this.terminal.set(name, named);
    return named;
  }

  /**
   * Mark an already-allocated label as a graph output without inserting a
   * renaming node. Use when you are happy to `-map` the generated id.
   *
   * @throws {FilterGraphError} if the label is unknown or already consumed by a filter.
   */
  markTerminal(label: Label): Label {
    this.assertKnown(label, "markTerminal");
    const eater = this.consumed.get(label.id);
    if (eater !== undefined) {
      throw new FilterGraphError(
        `[filtergraph] cannot mark [${label.id}] as an output: it is already consumed by ` +
          `node #${eater}. Use split() to both consume and export a stream.`,
      );
    }
    this.terminal.set(label.id, label);
    return label;
  }

  /** Labels marked as graph outputs, in declaration order. */
  terminals(): Label[] {
    return [...this.terminal.values()];
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  /**
   * Serialise the graph to a `filter_complex` string.
   *
   * @throws {FilterGraphError} if the graph is empty, has no outputs, or leaves
   * any declared/produced label neither consumed nor exported (a dangling
   * output — FFmpeg rejects the entire graph for this).
   */
  build(): string {
    if (this.nodes.length === 0) {
      throw new FilterGraphError(
        `[filtergraph] cannot build an empty graph — no filter nodes were added.`,
      );
    }
    if (this.terminal.size === 0) {
      throw new FilterGraphError(
        `[filtergraph] cannot build a graph with no outputs. Call output(label, name) ` +
          `on the final stream so it can be reached with -map.`,
      );
    }
    const dangling: string[] = [];
    for (const id of this.declared.keys()) {
      if (this.consumed.has(id)) continue;
      if (this.terminal.has(id)) continue;
      dangling.push(id);
    }
    if (dangling.length > 0) {
      throw new FilterGraphError(
        `[filtergraph] dangling label(s) [${dangling.join("], [")}]: produced or declared but ` +
          `never consumed by a filter and never marked as an output. FFmpeg rejects the whole ` +
          `graph for this. Either feed the label into a filter or call output()/markTerminal().`,
      );
    }
    return this.nodes
      .map(
        (n) =>
          `${n.inputs.map(labelRef).join("")}${n.chain.join(",")}${n.outputs.map(labelRef).join("")}`,
      )
      .join(";");
  }

  /** The nodes added so far — exposed for diagnostics and tests, not for mutation. */
  inspect(): readonly FilterNode[] {
    return this.nodes;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private addNode(
    inputs: readonly Label[],
    chain: readonly string[],
    outputKinds: readonly StreamKind[],
  ): Label[] {
    // Validate BEFORE allocating so a rejected node does not burn label ids and
    // leaves the graph byte-identical to what it was.
    this.assertInputsUsable(inputs, chain[0] ?? "<empty>");
    const outputs = outputKinds.map((kind) => this.allocate(kind));
    this.addNodeWithExplicitOutputs(inputs, chain, outputs);
    return outputs;
  }

  private addNodeWithExplicitOutputs(
    inputs: readonly Label[],
    chain: readonly string[],
    outputs: readonly Label[],
  ): void {
    const nodeIndex = this.nodes.length;
    const filterName = chain[0] ?? "<empty>";

    this.assertInputsUsable(inputs, filterName);

    const seenOutputs = new Set<string>();
    for (const output of outputs) {
      if (this.declared.has(output.id) || seenOutputs.has(output.id)) {
        throw new FilterGraphError(
          `[filtergraph] output label [${output.id}] is produced twice (node #${nodeIndex} ` +
            `"${filterName}"). Each label may be written by exactly one filter output.`,
        );
      }
      seenOutputs.add(output.id);
    }

    for (const input of inputs) this.consumed.set(input.id, nodeIndex);
    for (const output of outputs) this.declared.set(output.id, output.kind);

    this.nodes.push({
      inputs: [...inputs],
      chain: [...chain],
      outputs: [...outputs],
    });
  }

  /** Every input must be declared, unconsumed, and distinct within the node. */
  private assertInputsUsable(
    inputs: readonly Label[],
    filterName: string,
  ): void {
    const nodeIndex = this.nodes.length;
    const seenInThisNode = new Set<string>();
    for (const input of inputs) {
      this.assertKnown(input, filterName);
      const eater = this.consumed.get(input.id);
      if (eater !== undefined) {
        throw new FilterGraphError(
          `[filtergraph] label [${input.id}] is consumed twice (node #${eater} and node ` +
            `#${nodeIndex} "${filterName}"). An FFmpeg stream feeds exactly one filter — ` +
            `use split()/asplit() to fan it out.`,
        );
      }
      if (seenInThisNode.has(input.id)) {
        throw new FilterGraphError(
          `[filtergraph] label [${input.id}] is used twice as an input to the same node ` +
            `#${nodeIndex} "${filterName}". Use split() to duplicate the stream first.`,
        );
      }
      seenInThisNode.add(input.id);
    }
  }

  private allocate(kind: StreamKind): Label {
    let id = `${this.prefix}${this.counter++}`;
    while (this.declared.has(id)) {
      id = `${this.prefix}${this.counter++}`;
    }
    return { id, kind };
  }

  private assertKnown(label: Label, where: string): void {
    const kind = this.declared.get(label.id);
    if (kind === undefined) {
      throw new FilterGraphError(
        `[filtergraph] "${where}" references label [${label.id}], which was never declared ` +
          `in this graph. Declare an FFmpeg input with source(index, kind) — a missing ` +
          `second overlay input is the classic form of this bug.`,
      );
    }
    if (kind !== label.kind) {
      throw new FilterGraphError(
        `[filtergraph] "${where}" references label [${label.id}] as ${label.kind}, but it was ` +
          `declared as ${kind}.`,
      );
    }
  }

  private assertVideo(label: Label, where: string): void {
    if (label.kind !== "video") {
      throw new FilterGraphError(
        `[filtergraph] "${where}" requires a video label, but [${label.id}] is audio.`,
      );
    }
  }

  private assertAudio(label: Label, where: string): void {
    if (label.kind !== "audio") {
      throw new FilterGraphError(
        `[filtergraph] "${where}" requires an audio label, but [${label.id}] is video.`,
      );
    }
  }
}

function num(value: number | undefined, what: string): string | undefined {
  return value === undefined ? undefined : fmtNumber(value, what);
}
