/**
 * like-subscribe-outro.ts
 *
 * Builds an ffmpeg argv that appends a short animated "Like & Subscribe" end
 * card onto a finished tutorial. Applied to EVERY finished video (owner,
 * 2026-08-23: "add a custom like and subscribe motion graphic animation at the
 * end of the video for uniqueness").
 *
 * The outro is generated entirely from ffmpeg built-ins — no external image or
 * video assets:
 *   • A dark, seeded two-stop gradient background (hue derived from the job so
 *     each video's end card differs slightly — the "uniqueness" the owner asked
 *     for, and the same anti-duplicate logic the new-video treatment uses).
 *   • Three staggered, animated text elements: a headline that fades + slides
 *     up, a red SUBSCRIBE button that pops in, and a "Like • Share • Subscribe"
 *     line — each with its own alpha ramp so it reads as a motion graphic, plus
 *     an overall fade in/out.
 *   • Silent audio for the outro segment (anullsrc) so the concat has a
 *     continuous audio track.
 *
 * The main video and the generated outro are joined with the concat FILTER
 * (single pass, everything normalised to the same fps/SAR/pixfmt/sample-rate),
 * which is glitch-free regardless of the master's exact encode params — worth
 * the re-encode over the fragile concat-demuxer stream-copy path.
 *
 * Text is localised by the video's language so each channel's outro is in its
 * own language.
 */

const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";

/** A bold system font that ships on Ubuntu (validated present on the VPS). */
const DEFAULT_FONTFILE = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

export interface LikeSubscribeOutroOptions {
  /** Output width — MUST equal the main video's width (probe it). */
  width: number;
  /** Output height — MUST equal the main video's height (probe it). */
  height: number;
  /** Deterministic seed for the background hue (e.g. jobId). */
  seed: string;
  /** Video language code (de/fr/it/nl/sv/es/en). Falls back to English. */
  lang?: string | null;
  /** Outro length in seconds. Default 5. */
  durationSec?: number;
  /** Override the drawtext font file. Defaults to Ubuntu DejaVuSans-Bold. */
  fontFile?: string;
  /** CRF for libx264. Default 20. */
  crf?: number;
  /** libx264 preset. Default "veryfast" (matches the splice-step tuning). */
  preset?: string;
}

/** Deterministic 32-bit hash (FNV-1a). Stable across runs/machines. */
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
 * Escape a string for use inside a single-quoted drawtext `text=` value. We wrap
 * the value in single quotes at the call site, so neutralise backslashes, single
 * quotes (via the '\'' idiom) and the drawtext-special percent and colon.
 */
function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''")
    .replace(/%/g, "\\%")
    .replace(/:/g, "\\:");
}

const HEADLINE_BY_LANG: Record<string, string> = {
  en: "Enjoyed this tutorial?",
  de: "Hat dir das Tutorial gefallen?",
  fr: "Ce tutoriel t'a plu ?",
  it: "Ti è piaciuto il tutorial?",
  nl: "Vond je deze tutorial nuttig?",
  sv: "Gillade du guiden?",
  es: "¿Te gustó el tutorial?",
};

const SUBSCRIBE_WORD_BY_LANG: Record<string, string> = {
  en: "SUBSCRIBE",
  de: "ABONNIEREN",
  fr: "S'ABONNER",
  it: "ISCRIVITI",
  nl: "ABONNEREN",
  sv: "PRENUMERERA",
  es: "SUSCRÍBETE",
};

const LIKELINE_BY_LANG: Record<string, string> = {
  en: "Like  •  Share  •  Subscribe",
  de: "Liken  •  Teilen  •  Abonnieren",
  fr: "Aime  •  Partage  •  Abonne-toi",
  it: "Like  •  Condividi  •  Iscriviti",
  nl: "Like  •  Deel  •  Abonneer",
  sv: "Gilla  •  Dela  •  Prenumerera",
  es: "Like  •  Comparte  •  Suscríbete",
};

function pick(map: Record<string, string>, lang: string | null | undefined): string {
  const code = (lang ?? "en").toLowerCase().slice(0, 2);
  return map[code] ?? map["en"]!;
}

/**
 * Build the full ffmpeg argv to append the animated Like & Subscribe outro.
 *
 * @returns argv array (element 0 IS the ffmpeg binary) suitable for
 *   child_process.spawn(argv[0], argv.slice(1)).
 */
export function buildLikeSubscribeOutroArgs(
  inputPath: string,
  outputPath: string,
  opts: LikeSubscribeOutroOptions,
): string[] {
  const W = opts.width;
  const H = opts.height;
  const dur = Math.max(2, opts.durationSec ?? 5);
  const fontFile = opts.fontFile ?? DEFAULT_FONTFILE;
  const crf = opts.crf ?? 20;
  const preset = opts.preset ?? "veryfast";

  const hash = hashSeed(opts.seed);
  const hue = hash % 360;
  const bg0 = hslToFfHex(hue, 0.5, 0.13);
  const bg1 = hslToFfHex((hue + 30) % 360, 0.55, 0.05);

  const headline = escapeDrawtext(pick(HEADLINE_BY_LANG, opts.lang));
  const subscribe = escapeDrawtext(pick(SUBSCRIBE_WORD_BY_LANG, opts.lang));
  const likeline = escapeDrawtext(pick(LIKELINE_BY_LANG, opts.lang));

  // Geometry scales with height so it looks right at any resolution.
  const headSize = Math.round(H * 0.052);
  const btnSize = Math.round(H * 0.06);
  const likeSize = Math.round(H * 0.034);
  const headY = Math.round(H * 0.28);
  const btnY = Math.round(H * 0.46);
  const likeY = Math.round(H * 0.66);
  const btnPad = Math.round(H * 0.028);
  const slide = Math.round(H * 0.045);
  const fadeOutSt = (dur - 0.4).toFixed(2);

  // Staggered per-element alpha ramps (clip keeps them in [0,1]); the headline
  // also slides up into place. Times: headline 0.2s, button 0.7s, line 1.0s.
  const headAlpha = `alpha='clip((t-0.2)/0.4,0,1)'`;
  // The y value contains commas (inside clip()) so it MUST be single-quoted, or
  // the filtergraph parser reads them as option separators.
  const headYExpr = `y='${headY}+${slide}*clip(1-(t-0.2)/0.5,0,1)'`;
  const btnAlpha = `alpha='clip((t-0.7)/0.35,0,1)'`;
  const likeAlpha = `alpha='clip((t-1.0)/0.35,0,1)'`;

  const drawHead =
    `drawtext=fontfile=${fontFile}:text='${headline}':fontcolor=white:` +
    `fontsize=${headSize}:shadowcolor=black@0.6:shadowx=2:shadowy=2:` +
    `x=(w-text_w)/2:${headYExpr}:${headAlpha}`;

  // The SUBSCRIBE button: white text on a YouTube-red filled box. drawtext's
  // alpha fades text AND its box together, so the whole button pops in as one.
  const drawBtn =
    `drawtext=fontfile=${fontFile}:text='${subscribe}':fontcolor=white:` +
    `fontsize=${btnSize}:box=1:boxcolor=0xE60000:boxborderw=${btnPad}:` +
    `x=(w-text_w)/2:y=${btnY}:${btnAlpha}`;

  const drawLike =
    `drawtext=fontfile=${fontFile}:text='${likeline}':fontcolor=0xDDDDDD:` +
    `fontsize=${likeSize}:shadowcolor=black@0.6:shadowx=1:shadowy=1:` +
    `x=(w-text_w)/2:y=${likeY}:${likeAlpha}`;

  const outroChain =
    `[1:v]${drawHead},${drawBtn},${drawLike},` +
    `fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOutSt}:d=0.4,` +
    `fps=30,setsar=1,format=yuv420p[outro]`;

  // Main video: normalise to the SAME canvas + fps/SAR/pixfmt as the outro so
  // the concat filter joins them cleanly. W/H are the main's own dimensions, so
  // scale+pad are effectively a no-op guard, not a resize.
  const mainChain =
    `[0:v]fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[main]`;

  const mainAudio = `[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a0]`;
  const outroAudio = `[2:a]aformat=sample_fmts=fltp:channel_layouts=stereo[a1]`;
  const concat = `[main][a0][outro][a1]concat=n=2:v=1:a=1[v][a]`;

  const filterComplex = [
    outroChain,
    mainChain,
    mainAudio,
    outroAudio,
    concat,
  ].join(";");

  return [
    FFMPEG_BIN,
    "-hide_banner",
    "-i",
    inputPath,
    "-f",
    "lavfi",
    "-t",
    String(dur),
    "-i",
    `gradients=s=${W}x${H}:c0=${bg0}:c1=${bg1}:x0=0:y0=0:x1=${W}:y1=${H}:type=linear:speed=0.0015:d=${dur}:r=30`,
    "-f",
    "lavfi",
    "-t",
    String(dur),
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-filter_complex",
    filterComplex,
    "-map",
    "[v]",
    "-map",
    "[a]",
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
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ];
}
