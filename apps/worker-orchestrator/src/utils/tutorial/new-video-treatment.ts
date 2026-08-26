/**
 * new-video-treatment.ts
 *
 * Builds an ffmpeg argv that "uniquifies" a translated tutorial video so each
 * language variant looks like a distinct new upload and does NOT trip YouTube's
 * duplicate-detection when the same underlying screen recording is reused across
 * language channels.
 *
 * Apply this ONLY to TRANSLATED child jobs (source_job_id != null). The English
 * original must be left as-is so it remains the canonical clean master.
 *
 * The treatment (all via ffmpeg built-ins — no external images/assets):
 *   1. Animated, color-coded background. The base hue is derived deterministically
 *      from a seed string, so it is stable per job but differs across
 *      videos/languages. Implemented with the built-in `gradients` source with a
 *      slow `speed` so it drifts subtly.
 *   2. The tutorial video is framed: scaled to ~92% of the canvas, given rounded
 *      corners (alpha mask via geq+alphamerge) and a tasteful border, and centred.
 *   3. +2% horizontal stretch on the tutorial video before framing.
 *   4. Slight saturation bump (eq=saturation).
 *   5. A few-px pixel shift of the framed card so frame/pixel hashing differs.
 *   6. A new CTA text overlay (drawtext) at ~70% of the runtime for ~5s, using a
 *      caller-supplied, language-appropriate string.
 *
 * Audio is copied through unchanged (the narration was already muxed onto the
 * recording by the splice step). Video is re-encoded h264 (libx264, yuv420p,
 * CRF ~20, +faststart, preset veryfast to keep the 685-run batch cheap).
 */

const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";

/** A bold system font that ships on Ubuntu (validated present on the VPS). */
const DEFAULT_FONTFILE = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

export interface NewVideoTreatmentOptions {
  /** Deterministic seed for the color/pixel-shift derivation (e.g. jobId or topic). */
  seed: string;
  /** Language-appropriate CTA text drawn at ~70% of the runtime. */
  ctaText: string;
  /** Video duration in seconds (probe the input; controls bg length + CTA timing). */
  durationSec: number;
  /** Output canvas width. Default 1920. */
  canvasW?: number;
  /** Output canvas height. Default 1080. */
  canvasH?: number;
  /** Override the drawtext font file. Defaults to Ubuntu DejaVuSans-Bold. */
  fontFile?: string;
  /** CRF for libx264. Default 20. */
  crf?: number;
  /** libx264 preset. Default "veryfast" (matches the splice-step tuning). */
  preset?: string;
}

/** Force to an even integer (h264/yuv420p requires even dimensions). */
function even(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

/**
 * Deterministic 32-bit hash of a string (FNV-1a). Stable across runs/machines —
 * used so a given seed always maps to the same hue and pixel offset.
 */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** HSL (h in [0,360), s,l in [0,1]) → "0xRRGGBB" for ffmpeg color syntax. */
function hslToFfHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round((v + m) * 255)))
      .toString(16)
      .padStart(2, "0");
  return `0x${to(r)}${to(g)}${to(b)}`;
}

/**
 * geq luma expression for a filled rounded rectangle of size w×h, corner
 * radius r: 255 inside the rounded shape, 0 outside. Wrapped by the caller in
 * single quotes so the commas inside pow() are protected from the filtergraph
 * parser.
 */
function roundedRectLum(w: number, h: number, r: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const ix = cx - r; // inner box half-extent X (beyond which corners round)
  const iy = cy - r;
  // If the pixel is beyond the straight edges on BOTH axes it is in a corner
  // region — round it with a circle test; otherwise it is inside.
  return (
    `if(` +
    `gt(abs(X-${cx}),${ix})*gt(abs(Y-${cy}),${iy}),` +
    `if(lte(pow(abs(X-${cx})-${ix},2)+pow(abs(Y-${cy})-${iy},2),${r * r}),255,0),` +
    `255)`
  );
}

/**
 * Escape a user-supplied string for use inside a single-quoted drawtext `text=`
 * value in an ffmpeg filtergraph. We wrap the value in single quotes at the call
 * site, so here we only need to neutralise backslashes and single quotes (the
 * latter via the '\'' close/escape/reopen idiom) and the drawtext-special
 * percent and colon.
 */
function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''")
    .replace(/%/g, "\\%")
    .replace(/:/g, "\\:");
}

/**
 * Build the full ffmpeg argv for the uniquification treatment.
 *
 * @returns argv array (excluding the `ffmpeg` binary path is NOT excluded — the
 *   first element IS the binary, so this can be handed straight to
 *   child_process.spawn(argv[0], argv.slice(1)) or execFile).
 */
export function buildNewVideoTreatmentArgs(
  inputPath: string,
  outputPath: string,
  opts: NewVideoTreatmentOptions,
): string[] {
  const W = opts.canvasW ?? 1920;
  const H = opts.canvasH ?? 1080;
  const dur = Math.max(0.5, opts.durationSec);
  const fontFile = opts.fontFile ?? DEFAULT_FONTFILE;
  const crf = opts.crf ?? 20;
  const preset = opts.preset ?? "veryfast";

  const hash = hashSeed(opts.seed);

  // Base hue 0..359 from the seed. Two harmonious stops (analogous, +28°) at a
  // low, professional lightness. Border is a lighter, more saturated accent of
  // the same hue so it complements the background.
  const hue = hash % 360;
  const bgC0 = hslToFfHex(hue, 0.55, 0.20);
  const bgC1 = hslToFfHex((hue + 28) % 360, 0.5, 0.11);
  const borderColor = hslToFfHex((hue + 8) % 360, 0.6, 0.6);

  // Framed card geometry. Inner video ~92% of canvas; border a few px around it.
  const border = Math.max(4, Math.round(Math.min(W, H) * 0.006)); // ~6px @1080
  const fw = even(W * 0.92 - 2 * border);
  const fh = even(H * 0.92 - 2 * border);
  const cw = even(fw + 2 * border);
  const ch = even(fh + 2 * border);
  const radius = Math.round(Math.min(fw, fh) * 0.03); // subtle rounding
  const radiusOuter = radius + border;

  // Deterministic pixel shift in the range roughly [-5, +5] px on each axis.
  const shiftX = ((hash >>> 3) % 11) - 5;
  const shiftY = ((hash >>> 11) % 11) - 5;

  const cardX = Math.round((W - cw) / 2) + shiftX;
  const cardY = Math.round((H - ch) / 2) + shiftY;
  const vidX = cardX + border;
  const vidY = cardY + border;

  // CTA timing: appear at 70% of runtime for 5s (clamped inside the video).
  const ctaStart = +(dur * 0.7).toFixed(3);
  const ctaEnd = +Math.min(dur - 0.1, ctaStart + 5).toFixed(3);
  const ctaFontSize = Math.round(H * 0.045); // ~48px @1080
  const ctaPad = Math.round(H * 0.02);

  const saturation = 1.15;
  const stretch = 1.02;

  // ── filter_complex ────────────────────────────────────────────────────────
  // 1. Animated background (drifting linear gradient), sized to the canvas.
  const bg =
    `gradients=s=${W}x${H}:c0=${bgC0}:c1=${bgC1}` +
    `:x0=0:y0=0:x1=${W}:y1=${H}:type=linear:speed=0.0012:d=${dur}:r=30[bg]`;

  // 2. Tutorial video: normalise to the card size, apply the +2% horizontal
  //    stretch (then crop back to fixed size so the mask lines up), saturation
  //    bump, square pixels, then rounded-corner alpha via a static mask.
  const vidChain =
    `[0:v]scale=${fw}:${fh}:force_original_aspect_ratio=increase,` +
    `crop=${fw}:${fh},` +
    `scale=w=iw*${stretch}:h=ih,crop=${fw}:${fh},` +
    `eq=saturation=${saturation}:contrast=1.02,setsar=1,format=rgba[vraw]`;

  // Inner rounded mask (single frame, generated once, then looped to a stream).
  const maskV =
    `color=c=black:s=${fw}x${fh}:d=1,format=gray,` +
    `geq=lum='${roundedRectLum(fw, fh, radius)}',` +
    `loop=loop=-1:size=1,fps=30[mv]`;
  const applyMaskV = `[vraw][mv]alphamerge[vid]`;

  // Border card: a solid rounded plate in the accent color, video sits on top.
  const cardBase =
    `color=c=${borderColor}:s=${cw}x${ch}:d=1,format=rgba[cbase]`;
  const maskC =
    `color=c=black:s=${cw}x${ch}:d=1,format=gray,` +
    `geq=lum='${roundedRectLum(cw, ch, radiusOuter)}',` +
    `loop=loop=-1:size=1,fps=30[mc]`;
  const applyMaskC = `[cbase][mc]alphamerge,loop=loop=-1:size=1,fps=30[card]`;

  // 3. Composite: bg <- card <- video, with the deterministic pixel shift baked
  //    into the card/video positions. Then draw the CTA.
  const composite =
    `[bg][card]overlay=x=${cardX}:y=${cardY}:shortest=1[bgc];` +
    `[bgc][vid]overlay=x=${vidX}:y=${vidY}[comp];` +
    // Dark box + white text is legible for ANY derived hue (a light accent box
    // would hide white text). A thin accent-colored glyph border ties it back to
    // the frame color, and a soft shadow keeps it readable over busy captures.
    `[comp]drawtext=fontfile=${fontFile}:text='${escapeDrawtext(opts.ctaText)}':` +
    `fontcolor=white:fontsize=${ctaFontSize}:` +
    `borderw=2:bordercolor=${borderColor}:shadowcolor=black@0.6:shadowx=2:shadowy=2:` +
    `box=1:boxcolor=black@0.55:boxborderw=${ctaPad}:` +
    `x=(w-text_w)/2:y=h-text_h-${Math.round(H * 0.07)}:` +
    `enable='between(t,${ctaStart},${ctaEnd})'[out]`;

  const filterComplex = [
    bg,
    vidChain,
    maskV,
    applyMaskV,
    cardBase,
    maskC,
    applyMaskC,
    composite,
  ].join(";");

  return [
    FFMPEG_BIN,
    "-hide_banner",
    "-i",
    inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[out]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    String(crf),
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    "-t",
    String(dur),
    "-y",
    outputPath,
  ];
}

/**
 * Per-language default CTA strings. Keyed by the short language code stored in
 * tutorial_jobs.language (de/fr/it/nl/sv, plus es/ja/ko already handled by the
 * translate pipeline). Falls back to English.
 */
export const DEFAULT_CTA_BY_LANG: Record<string, string> = {
  de: "Abonniere für mehr Tutorials!",
  fr: "Abonne-toi pour plus de tutoriels !",
  it: "Iscriviti per altri tutorial!",
  nl: "Abonneer voor meer tutorials!",
  sv: "Prenumerera för fler guider!",
  es: "¡Suscríbete para más tutoriales!",
  en: "Subscribe for more tutorials!",
};

/** Resolve a CTA for a language code, falling back to English. */
export function ctaForLanguage(lang: string | null | undefined): string {
  const code = (lang ?? "en").toLowerCase().slice(0, 2);
  return DEFAULT_CTA_BY_LANG[code] ?? DEFAULT_CTA_BY_LANG["en"]!;
}
