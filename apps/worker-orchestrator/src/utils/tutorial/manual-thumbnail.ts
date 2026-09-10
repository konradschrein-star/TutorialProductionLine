import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, join, resolve } from "node:path";
import * as fontkit from "fontkit";
import type { Font } from "fontkit";
import sharp, { type OverlayOptions } from "sharp";
import type { DrizzleClient, TutorialJob } from "@repo/db";
import { defringePersonaRgba } from "@repo/media-core/images";
import { probeMediaDuration } from "@repo/media-core";
import {
  createThumbnailRecord,
  desc,
  eq,
  getChannelThumbnailProfile,
  getTutorialChannelProfile,
  getTutorialSettings,
  listThumbnailsForSubject,
  selectThumbnail,
  thumbnailLibraryAssets,
  updateThumbnailRecord,
} from "@repo/db";
import type { TutorialProceduralLayout, TutorialProceduralBackground, TutorialProceduralTemplate } from "@repo/contracts";
import { deriveLogoSubject } from "@repo/domain";
import { proceduralHeadlineBlocks } from "../thumbnail/headline.js";
import { inspectProceduralComposition, type LogoRasterMetrics, type ProceduralLocaleQualityReport, type ProceduralQaLayer, type ProceduralQaLocale } from "../thumbnail/procedural-quality.js";
import { resolveCharacterReference } from "../thumbnail/character.js";
import { resolveTutorialThumbnailContext } from "./thumbnail-context.js";
import { planProceduralLayout, proceduralTemplateMatches, safeProceduralTemplate } from "./procedural-layout-planner.js";

const MEDIA_DIR =
  process.env["THUMBNAIL_MEDIA_DIR"] ??
  join(
    process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media",
    "thumbnails",
  );
const PUBLIC_DIR =
  process.env["HUB_PUBLIC_DIR"] ?? resolve(process.cwd(), "../hub-web/public");
const ROTATION_BACKGROUNDS = [
  "background/bg_1_1128207.jpg",
  "background/bg_5_4386356.jpg",
  "background/bg_9_5717314.jpg",
  "background/bg_6_322338.jpg",
];
const BACKGROUND_BY_NAME: Record<string, string> = {
  "Office 1 · Window Desk": "background/bg_1_1128207.jpg",
  "Office 2 · White Desk": "background/bg_5_4386356.jpg",
  "Office 3 · Conference Room": "background/bg_9_5717314.jpg",
  "Office 4 · Desktop": "background/bg_6_322338.jpg",
  // Compatibility for rows saved by the previous mislabeled UI.
  "Modern Minimal Tech": "background/bg_9_5717314.jpg",
  "Neon Glow Studio": "background/bg_6_322338.jpg",
  "Dark Corporate Slate": "background/bg_5_4386356.jpg",
  "Abstract Gradient Blue": "background/bg_1_1128207.jpg",
};
type ProceduralLayoutId = TutorialProceduralLayout;
type ProceduralBackgroundId = TutorialProceduralBackground;
const BACKGROUND_BY_ID: Record<ProceduralBackgroundId, { path?: string; color?: string; tone: "light" | "dark" }> = {
  "soft-light": { color: "#f3f5f7", tone: "light" },
  "soft-dark": { color: "#111318", tone: "dark" },
  "office-neutral": { path: "background/office-neutral-20260909.png", tone: "light" },
  "office-window": { path: "background/bg_1_1128207.jpg", tone: "light" },
  "office-white-desk": { path: "background/bg_5_4386356.jpg", tone: "light" },
  "office-conference": { path: "background/bg_9_5717314.jpg", tone: "light" },
  "office-desktop": { path: "background/bg_6_322338.jpg", tone: "light" },
  "solid-white": { color: "#ffffff", tone: "light" },
  "solid-black": { color: "#07090d", tone: "dark" },
};
const FONT_PATH = "fonts/Anton-Regular.ttf";
const execFileAsync = promisify(execFile);

function hash(text: string): number {
  return [...text].reduce(
    (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
    7,
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

type LayoutSide = "left" | "right";

function automaticHeadlineLines(
  font: Font,
  input: readonly string[],
  maxWidth: number,
  maxHeight: number,
  requestedLineCount?:number,
): string[] {
  const words = input.flatMap(line => line.trim().split(/\s+/)).filter(Boolean).slice(0, 4);
  if (words.length <= 1) return words;
  const horizontalPadding = 56;
  const gap = 7;
  const candidates: string[][] = [];
  const partition = (start: number, remaining: number, lines: string[]) => {
    if (remaining === 1) {
      candidates.push([...lines, words.slice(start).join(" ")]);
      return;
    }
    for (let end = start + 1; end <= words.length - remaining + 1; end += 1) {
      partition(end, remaining - 1, [...lines, words.slice(start, end).join(" ")]);
    }
  };
  const minimum=requestedLineCount?Math.min(words.length,Math.max(1,requestedLineCount)):1;
  const maximum=requestedLineCount?minimum:words.length;
  for (let count = minimum; count <= maximum; count += 1) partition(0, count, []);
  const score = (lines: string[]) => {
    const lineHeight = (maxHeight - gap * (lines.length - 1)) / lines.length;
    const verticalPadding = lines.length >= 4 ? 16 : lines.length === 3 ? 20 : 32;
    const sizes = lines.map(line => {
      const bounds = font.layout(line.toUpperCase()).bbox;
      const widthUnits = Math.max(1, bounds.maxX - bounds.minX);
      const heightUnits = Math.max(1, bounds.maxY - bounds.minY);
      return Math.min(
        184,
        ((maxWidth - horizontalPadding) / widthUnits) * font.unitsPerEm,
        ((lineHeight - verticalPadding) / heightUnits) * font.unitsPerEm,
      );
    });
    const minimum = Math.min(...sizes);
    const average = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
    const imbalance = Math.max(...sizes) - minimum;
    return minimum * 2 + average - imbalance * .08 - lines.length * 8;
  };
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? [words.join(" ")];
}

interface HeadlineArtworkMeasurement {text:string;fontSizePx:number;glyphWidthPx:number;glyphHeightPx:number;glyphRect:{x:number;y:number;width:number;height:number};pillRect:{x:number;y:number;width:number;height:number}}
function headlineArtwork(
  font: Font,
  lines: readonly string[],
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  fills: readonly string[],
  strokeWidth = 0,
  requestedLineCount?:number,
): {svg:string;measurements:HeadlineArtworkMeasurement[]} {
  // Reflow by measured glyph width. German, French and other translations do
  // not inherit an English character-count split that makes their type tiny.
  const clean = automaticHeadlineLines(font, lines, maxWidth, maxHeight,requestedLineCount);
  const gap = 7;
  const horizontalPadding = 28;
  // Dense three/four-row locales retain enough painted cap height for the
  // mobile type floor instead of spending almost half each row on padding.
  const verticalPadding = clean.length >= 4 ? 8 : clean.length === 3 ? 10 : 16;
  const availableLineHeight = (maxHeight - gap * (clean.length - 1)) / Math.max(1, clean.length);
  const measurements:HeadlineArtworkMeasurement[]=[];
  const svg=clean.map((line, lineIndex) => {
      const run = font.layout(line.toUpperCase());
      const visibleUnitsWide = Math.max(1, run.bbox.maxX - run.bbox.minX);
      const visibleUnitsHigh = Math.max(1, run.bbox.maxY - run.bbox.minY);
      const safeWidth = maxWidth - horizontalPadding * 2;
      const safeHeight = availableLineHeight - verticalPadding * 2;
      const heightFit = Math.min(184,(safeHeight / visibleUnitsHigh) * font.unitsPerEm);
      let fontSize=Math.max(42,heightFit);
      let verticalScale=fontSize/font.unitsPerEm;
      let horizontalScale=Math.min(verticalScale,safeWidth/visibleUnitsWide);
      // Long translated words keep a legible cap height and may condense up to
      // 28%. If even that cannot fit, reduce uniformly and let QA reject truly
      // unreadable copy rather than clipping it.
      if(horizontalScale/verticalScale<.72){verticalScale=safeWidth/(visibleUnitsWide*.72);horizontalScale=verticalScale*.72;fontSize=verticalScale*font.unitsPerEm}
      const renderedWidth = visibleUnitsWide * horizontalScale;
      const renderedHeight = visibleUnitsHigh * verticalScale;
      const boxWidth = Math.min(maxWidth, Math.ceil(renderedWidth + horizontalPadding * 2));
      const boxHeight = Math.min(availableLineHeight, Math.ceil(renderedHeight + verticalPadding * 2));
      const top = y + lineIndex * (availableLineHeight + gap) + Math.max(0, (availableLineHeight - boxHeight) / 2);
      let cursor = 0;
      const paths = run.glyphs.map((glyph, glyphIndex) => {
        const position = run.positions[glyphIndex]!;
        const translated = cursor + position.xOffset;
        cursor += position.xAdvance;
        return `<path d="${glyph.path.toSVG()}" transform="translate(${translated} ${position.yOffset})"/>`;
      });
      // Center the painted glyph bounds, not Anton's unusually tall invisible
      // ascent/descent box. This keeps capitals optically centered in the pill.
      const baseline = top + verticalPadding + run.bbox.maxY * verticalScale;
      const glyphX = x + horizontalPadding - run.bbox.minX * horizontalScale;
      const fill = fills[lineIndex % fills.length] ?? "#ffffff";
      measurements.push({text:line,fontSizePx:fontSize,glyphWidthPx:renderedWidth,glyphHeightPx:renderedHeight,glyphRect:{x:glyphX,y:top+verticalPadding,width:renderedWidth,height:renderedHeight},pillRect:{x,y:top,width:boxWidth,height:boxHeight}});
      return `<g><rect x="${x}" y="${top}" width="${boxWidth}" height="${boxHeight}" rx="15" fill="#090a0c" opacity=".98"/><g transform="translate(${glyphX} ${baseline}) scale(${horizontalScale} ${-verticalScale})" fill="${escapeXml(fill)}"${strokeWidth > 0 ? ` stroke="#050505" stroke-width="${strokeWidth / verticalScale}" paint-order="stroke fill" stroke-linejoin="round"` : ""}>${paths.join("")}</g></g>`;
    })
    .join("");
  return {svg,measurements};
}

async function cropBestInterfaceComponent(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const image = sharp(inputPath).resize(960, 540, { fit: "cover" });
  // A 600×338 region is a 25% closer crop than the previous 720×405 frame.
  // The grid search keeps the most information-dense action region rather
  // than scaling the entire recorded browser window into a tiny card.
  const width = 600;
  const height = 338;
  const positions = [
    ...[0, 90, 180, 270, 360].flatMap(left =>
      [0, 67, 135, 202].map(top => ({ left, top })),
    ),
  ];
  const scored = await Promise.all(positions.map(async position => {
    const stats = await image.clone().extract({ ...position, width, height }).greyscale().stats();
    const mean = stats.channels[0]?.mean ?? 128;
    const exposurePenalty = Math.abs(mean - 132) / 95;
    return { position, score: stats.entropy * 1.8 + Math.log1p(stats.sharpness) - exposurePenalty };
  }));
  scored.sort((a, b) => b.score - a.score);
  await image.clone().extract({ ...(scored[0]?.position ?? positions[4]!), width, height }).png().toFile(outputPath);
}

/** Pick a crisp, information-dense frame from the recorded tutorial. The
 * source video remains untouched and failures deliberately fall back to the
 * procedural UI card instead of blocking production. */
export async function extractBestInterfaceFrame(
  videoPath: string,
  outputPath: string,
): Promise<string | null> {
  if (!(await access(videoPath).then(() => true).catch(() => false))) return null;
  const duration = await probeMediaDuration(videoPath).catch(() => 0);
  if (!Number.isFinite(duration) || duration <= 1) return null;
  const candidates = [0.18, 0.38, 0.58, 0.78];
  const paths: string[] = [];
  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidatePath = `${outputPath}.candidate-${index}.png`;
      paths.push(candidatePath);
      await execFileAsync(process.env["FFMPEG_PATH"] ?? "ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-ss", String(Math.max(0.5, duration * candidates[index]!)),
        "-i", videoPath, "-frames:v", "1",
        "-vf", "scale=960:540:force_original_aspect_ratio=increase,crop=960:540",
        candidatePath,
      ], { timeout: 30_000 });
    }
    const scored = await Promise.all(paths.map(async path => {
      const stats = await sharp(path).greyscale().stats();
      const mean = stats.channels[0]?.mean ?? 128;
      const exposurePenalty = Math.abs(mean - 132) / 90;
      return { path, score: stats.entropy * 1.8 + Math.log1p(stats.sharpness) - exposurePenalty };
    }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) return null;
    await cropBestInterfaceComponent(best.path, outputPath);
    return outputPath;
  } catch {
    return null;
  } finally {
    await Promise.all(paths.map(path => rm(path, { force: true }).catch(() => undefined)));
  }
}

async function cleanAndSizeHost(
  host: string,
  crop: "tight" | "extra-tight" = "tight",
  flip = false,
  zoom = 1,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const raw = await sharp(host)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cleaned = defringePersonaRgba(
    raw.data,
    raw.info.width,
    raw.info.height,
  );
  let pipeline = sharp(cleaned, { raw: raw.info })
    .trim({ background: "#00000000", threshold: 6 });
  if (flip) pipeline = pipeline.flop();
  const safeZoom = Math.max(.8, Math.min(1.15, zoom));
  const targetWidth = Math.round((crop === "extra-tight" ? 810 : 740) * safeZoom);
  const targetHeight = Math.round(720 * safeZoom);
  let resizedPipeline = pipeline.resize(
      targetWidth,
      targetHeight,
      {
      fit: "cover",
      position: "north",
      withoutEnlargement: false,
      },
    );
  if (targetHeight > 720) {
    resizedPipeline = resizedPipeline.extract({ left: 0, top: 0, width: targetWidth, height: 720 });
  }
  const resized = await resizedPipeline
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: resized.data,
    width: resized.info.width,
    height: resized.info.height,
  };
}

export interface ManualTutorialArtworkInput {
  outputPath: string;
  backgroundPath?: string;
  backgroundColor?: string;
  hostPath: string;
  logoPath?: string | null;
  uiScreenshotPath?: string | null;
  lines: readonly string[];
  accent: string;
  hostSide: LayoutSide;
  layoutId?: ProceduralLayoutId;
  theme?: "light-first" | "mixed" | "dark-first";
  hostCrop?: "tight" | "extra-tight";
  hostZoom?: number;
  showArrow?: boolean;
  logoTreatment?: "badge" | "integrated" | "off";
  logoAura?: boolean;
  logoAuraX?: number;
  logoAuraY?: number;
  logoAuraRadius?: number;
  logoAuraOpacity?: number;
  template?: TutorialProceduralTemplate | null;
  language?:string;
  hostPointsAtTarget?:boolean;
  publicDir?: string;
}

export interface ManualTutorialArtworkResult {quality:ProceduralLocaleQualityReport|null}

async function sampledLogoColors(
  logoPath: string | null | undefined,
  fallback: string,
): Promise<[string, string]> {
  if (!logoPath) return [fallback, "#7c3aed"];
  const { data, info } = await sharp(logoPath)
    .ensureAlpha()
    .resize(48, 48, { fit: "contain" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let index = 0; index < data.length; index += info.channels) {
    const r = data[index] ?? 0;
    const g = data[index + 1] ?? 0;
    const b = data[index + 2] ?? 0;
    const alpha = data[index + 3] ?? 255;
    if (alpha < 96 || Math.max(r, g, b) < 45 || Math.min(r, g, b) > 232 || Math.max(r, g, b) - Math.min(r, g, b) < 36) continue;
    const key = `${r >> 4}:${g >> 4}:${b >> 4}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const colors = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .map(item => ({
      r: Math.round(item.r / item.count),
      g: Math.round(item.g / item.count),
      b: Math.round(item.b / item.count),
    }));
  const first = colors[0];
  const second = colors.find(color => first && Math.hypot(color.r - first.r, color.g - first.g, color.b - first.b) > 92);
  const hex = (color: { r: number; g: number; b: number } | undefined, value: string) => color
    ? `#${[color.r, color.g, color.b].map(channel => channel.toString(16).padStart(2, "0")).join("")}`
    : value;
  return [hex(first, fallback), hex(second, "#7c3aed")];
}

/** Remove opaque black letterboxing that is already baked into a downloaded
 * logo. Transparent trimming alone cannot remove those source pixels. Only
 * near-solid, near-black edge runs qualify, so dark artwork inside a transparent
 * or differently coloured canvas is preserved. */
async function cropOpaqueBlackLogoBars(input:Buffer):Promise<Buffer>{
 const {data,info}=await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const isBlackOpaque=(offset:number)=>{
  const alpha=data[offset+3]??255;
  return alpha>=245&&(data[offset]??0)<=24&&(data[offset+1]??0)<=24&&(data[offset+2]??0)<=24;
 };
 const rowIsBar=(y:number)=>{
  let matching=0;
  for(let x=0;x<info.width;x+=1)if(isBlackOpaque((y*info.width+x)*info.channels))matching+=1;
  return matching/info.width>=.96;
 };
 const columnIsBar=(x:number)=>{
  let matching=0;
  for(let y=0;y<info.height;y+=1)if(isBlackOpaque((y*info.width+x)*info.channels))matching+=1;
  return matching/info.height>=.96;
 };
 let top=0,bottom=0,left=0,right=0;
 while(top<info.height&&rowIsBar(top))top+=1;
 while(bottom<info.height-top&&rowIsBar(info.height-1-bottom))bottom+=1;
 while(left<info.width&&columnIsBar(left))left+=1;
 while(right<info.width-left&&columnIsBar(info.width-1-right))right+=1;
 const width=info.width-left-right,height=info.height-top-bottom;
 // A uniformly black logo or an implausibly tiny remainder is artwork, not a
 // trustworthy letterbox. Fail closed and keep the original in that case.
 if(width<Math.max(8,info.width*.25)||height<Math.max(8,info.height*.25)||(top===0&&bottom===0&&left===0&&right===0))return input;
 return sharp(input).extract({left,top,width,height}).png().toBuffer();
}

/** Normalize arbitrary rectangular brand marks without manufacturing opaque
 * padding and without preserving source letterbox bars. The final contain
 * operation always uses a transparent canvas. */
export async function prepareLogoArtwork(logoPath:string,size=112):Promise<Buffer>{
 const transparentTrimmed=await sharp(logoPath).ensureAlpha().trim({background:'#00000000',threshold:2}).png().toBuffer();
 const cropped=await cropOpaqueBlackLogoBars(transparentTrimmed);
 return sharp(cropped).resize(size,size,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
}

async function logoRasterMetrics(buffer:Buffer):Promise<LogoRasterMetrics>{
 const {data,info}=await sharp(buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let minX=info.width,minY=info.height,maxX=-1,maxY=-1,opaque=0;
 for(let y=0;y<info.height;y+=1)for(let x=0;x<info.width;x+=1){const alpha=data[(y*info.width+x)*info.channels+3]??255;if(alpha>=240)opaque+=1;if(alpha>=24){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}}
 const edge:Array<[number,number,number,number]>=[];
 for(let x=0;x<info.width;x+=1){for(const y of [0,info.height-1]){const i=(y*info.width+x)*info.channels;edge.push([data[i]??0,data[i+1]??0,data[i+2]??0,data[i+3]??255])}}
 for(let y=1;y<info.height-1;y+=1){for(const x of [0,info.width-1]){const i=(y*info.width+x)*info.channels;edge.push([data[i]??0,data[i+1]??0,data[i+2]??0,data[i+3]??255])}}
 const key=([r,g,b,a]:[number,number,number,number])=>`${r>>4}:${g>>4}:${b>>4}:${a>>4}`;
 const counts=new Map<string,number>();for(const sample of edge)counts.set(key(sample),(counts.get(key(sample))??0)+1);
 const dominant=Math.max(0,...counts.values());
 return {width:info.width,height:info.height,opaquePixelRatio:opaque/(info.width*info.height),uniformEdgeRatio:edge.length?dominant/edge.length:0,contentBounds:maxX>=minX?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:{x:0,y:0,width:info.width,height:info.height}};
}

/** Render a mobile-legible tutorial thumbnail without any database access.
 * The composition deliberately mirrors proven tutorial thumbnails: one tight
 * human crop, one dominant software/UI object, 2–4 words, and an arrow whose
 * tip terminates on that object. */
export async function renderManualTutorialArtwork({
  outputPath,
  backgroundPath,
  backgroundColor,
  hostPath,
  logoPath,
  uiScreenshotPath,
  lines,
  accent,
  hostSide,
  layoutId = hostSide === "left" ? "guide-host-left" : "guide-host-right",
  theme = "light-first",
  hostCrop = "tight",
  hostZoom = 1,
  showArrow = true,
  logoTreatment = "badge",
  logoAura = false,
  logoAuraX = 1040,
  logoAuraY = 370,
  logoAuraRadius = 350,
  logoAuraOpacity = .28,
  template = null,
  language='en',
  hostPointsAtTarget=false,
  publicDir = PUBLIC_DIR,
}: ManualTutorialArtworkInput): Promise<ManualTutorialArtworkResult> {
  const dark = layoutId === "solid-dark-circle" || theme === "dark-first" || (theme === "mixed" && layoutId.startsWith("icon-focus"));
  const focusX = template?.uiX ?? (hostSide === "right" ? 34 : 546);
  const focusWidth = template?.uiWidth ?? 700;
  const logoSize = template?.logoSize ?? 152;
  const logoX = template?.logoX ?? (hostSide === "right" ? focusX : focusX + focusWidth - logoSize);
  const textX = template?.headlineX ?? (logoTreatment === "badge"
    ? (hostSide === "right" ? focusX + logoSize + 18 : focusX)
    : focusX);
  const textWidth = template?.headlineWidth ?? (logoTreatment === "badge" ? focusWidth - logoSize - 18 : focusWidth);
  const [hostImage, fontBytes] = await Promise.all([
    cleanAndSizeHost(hostPath, hostCrop, hostSide === "right", hostZoom),
    readFile(join(publicDir, FONT_PATH)),
  ]);
  const font = fontkit.create(fontBytes) as Font;
  const headline= headlineArtwork(font, lines, textX, template?.headlineY ?? 28, textWidth, template?.headlineHeight ?? 224, ["#ffffff", "#ffe319"],0,template?.headlineLines==='auto'||!template?.headlineLines?undefined:Number(template.headlineLines));
  const headlineSvg = Buffer.from(
    `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="text-shadow" x="-20%" y="-30%" width="150%" height="170%">
          <feDropShadow dx="0" dy="6" stdDeviation="4" flood-color="#000000" flood-opacity=".34"/>
        </filter>
      </defs>
      <g filter="url(#text-shadow)">${headline.svg}</g>
    </svg>`,
  );
  const hostEdgeOffset = template?.hostEdgeOffset ?? 82;
  const hostX = hostSide === "left" ? -hostEdgeOffset : 1280 - hostImage.width + hostEdgeOffset;
  const hostY = 0;
  const composites: OverlayOptions[] = [];
  const wash = Buffer.from(`<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="v" cx="45%" cy="40%" r="80%"><stop offset="0" stop-color="${dark ? "#242832" : "#ffffff"}"/><stop offset="1" stop-color="${dark ? "#090a0d" : "#dfe4e8"}"/></radialGradient></defs><rect width="1280" height="720" fill="url(#v)" opacity="${backgroundPath ? ".9" : "1"}"/></svg>`);
  composites.push({ input: wash, left: 0, top: 0 });
  const useAura = template?.auraEnabled ?? logoAura;
  if (useAura) {
    const [auraStart, auraEnd] = await sampledLogoColors(logoPath, accent);
    const aura = Buffer.from(`<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="logo-aura" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${escapeXml(auraStart)}"/><stop offset="1" stop-color="${escapeXml(auraEnd)}"/></linearGradient></defs><circle cx="${template?.auraX ?? logoAuraX}" cy="${template?.auraY ?? logoAuraY}" r="${template?.auraRadius ?? logoAuraRadius}" fill="url(#logo-aura)" opacity="${template?.auraOpacity ?? logoAuraOpacity}"/></svg>`);
    composites.push({ input: aura, left: 0, top: 0 });
  }

  const cardTop = template?.uiY ?? 286;
  const cardHeight = template?.uiHeight ?? 414;
  const cardFrame = Buffer.from(`<svg width="${focusWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000000" flood-opacity=".34"/>${dark ? '<feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#ffffff" flood-opacity=".15"/>' : ""}</filter></defs><rect x="6" y="6" width="${focusWidth - 12}" height="${cardHeight - 12}" rx="24" fill="${dark ? "#171a20" : "#ffffff"}" stroke="${dark ? "rgba(255,255,255,.28)" : "#17191d"}" stroke-width="6" filter="url(#s)"/></svg>`);
  composites.push({ input: cardFrame, left: focusX, top: cardTop });
  if (uiScreenshotPath) {
    const screenshot = await sharp(uiScreenshotPath).resize(focusWidth - 28, cardHeight - 28, { fit: "cover" }).png().toBuffer();
    composites.push({ input: screenshot, left: focusX + 14, top: cardTop + 14 });
  } else {
    const fallback = Buffer.from(`<svg width="${focusWidth - 28}" height="${cardHeight - 28}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="18" fill="${dark ? "#20242c" : "#f7f8fa"}"/><circle cx="50%" cy="50%" r="${Math.min(focusWidth, cardHeight) * .3}" fill="${dark ? "#12151a" : "#ffffff"}" stroke="${escapeXml(accent)}" stroke-width="10"/></svg>`);
    composites.push({ input: fallback, left: focusX + 14, top: cardTop + 14 });
  }

  composites.push({ input: headlineSvg, left: 0, top: 0 });
  const logoBuffer = logoPath
    ? await prepareLogoArtwork(logoPath)
    : Buffer.from(`<svg width="112" height="112" xmlns="http://www.w3.org/2000/svg"><rect width="112" height="112" rx="22" fill="#d92323"/><text x="56" y="49" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="800" fill="white">ADD</text><text x="56" y="75" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="800" fill="white">LOGO</text></svg>`);
  if (logoTreatment === "badge") {
    const badge = Buffer.from(`<svg width="152" height="152" xmlns="http://www.w3.org/2000/svg"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dy="5" stdDeviation="5" flood-color="#000000" flood-opacity=".18"/></filter></defs><rect x="7" y="7" width="138" height="138" rx="28" fill="white" filter="url(#s)"/></svg>`);
    const badgeScale = logoSize / 152;
    const scaledBadge = await sharp(badge).resize(logoSize, logoSize).png().toBuffer();
    const scaledLogo = await sharp(logoBuffer).resize(Math.round(112 * badgeScale), Math.round(112 * badgeScale), { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const logoInset = Math.round(20 * badgeScale);
    composites.push({ input: scaledBadge, left: logoX, top: template?.logoY ?? 61 }, { input: scaledLogo, left: logoX + logoInset, top: (template?.logoY ?? 61) + logoInset });
  } else if (logoTreatment === "integrated") {
    const integrated = await sharp(logoBuffer).resize(150, 150, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).toBuffer();
    composites.push({ input: integrated, left: focusX + 272, top: cardTop + 119 });
  }
  if (showArrow && (template?.arrowEnabled ?? true)) {
    let arrow = sharp(join(publicDir, "bulk_symbols_110_colored/curved-arrow.png"));
    if (hostSide === "left") arrow = arrow.flop();
    const arrowSize = template?.arrowSize ?? 190;
    const arrowBuffer = await arrow.resize(arrowSize, arrowSize, { fit: "contain" }).png().toBuffer();
    // The arrowhead lands on the lower-right action area of the UI card. It is
    // never allowed to point off-canvas or at an unrelated desk/background.
    composites.push({ input: arrowBuffer, left: template?.arrowX ?? (hostSide === "right" ? focusX + 505 : focusX + 345), top: template?.arrowY ?? 405 });
  }
  composites.push({ input: hostImage.buffer, left: hostX, top: hostY });

  const base = backgroundPath
    ? sharp(backgroundPath).resize(1280, 720, { fit: "cover" }).modulate({ brightness: dark ? .68 : 1.08, saturation: .36 }).blur(16)
    : sharp({ create: { width: 1280, height: 720, channels: 3, background: backgroundColor ?? (dark ? "#111318" : "#f3f5f7") } });
  await base
    .composite(composites)
    .png()
    .toFile(outputPath);
  const supportedLocale=(language.trim().toLowerCase()||'en') as ProceduralQaLocale;
  const layers:ProceduralQaLayer[]=[
    {id:'background',kind:'background',rect:{x:0,y:0,width:1280,height:720}},
    {id:'ui',kind:'ui',rect:{x:focusX,y:cardTop,width:focusWidth,height:cardHeight},isPrimaryFocal:true},
    {id:'host',kind:'host',rect:{x:hostX,y:hostY,width:hostImage.width,height:hostImage.height},focalRect:{x:hostX+hostImage.width*.27,y:42,width:hostImage.width*.28,height:hostImage.height*.36},allowEdgeBleed:true,...(hostPointsAtTarget?{pointerTargetId:'ui'}:{})},
  ];
  headline.measurements.forEach((measurement,index)=>{const pillId=`headline-pill-${index}`;layers.push({id:pillId,kind:'pill',rect:measurement.pillRect},{id:`headline-${index}`,kind:'headline',rect:measurement.pillRect,glyphRect:measurement.glyphRect,text:measurement.text,fontSizePx:measurement.fontSizePx,glyphWidthPx:measurement.glyphWidthPx,glyphHeightPx:measurement.glyphHeightPx,containerId:pillId})});
  if(logoTreatment!=='off')layers.push({id:'logo',kind:'logo',rect:{x:logoTreatment==='badge'?logoX:focusX+272,y:logoTreatment==='badge'?(template?.logoY??61):cardTop+119,width:logoTreatment==='badge'?logoSize:150,height:logoTreatment==='badge'?logoSize:150},...(logoPath?{logoRaster:await logoRasterMetrics(logoBuffer)}:{})});
  if(showArrow&&(template?.arrowEnabled??true))layers.push({id:'arrow',kind:'arrow',rect:{x:template?.arrowX??(hostSide==='right'?focusX+505:focusX+345),y:template?.arrowY??405,width:template?.arrowSize??190,height:template?.arrowSize??190},pointerTargetId:'ui'});
  return {quality:inspectProceduralComposition({locale:supportedLocale,width:1280,height:720,layers})};
}

function resolveAssetPath(path: string): string {
  return isAbsolute(path)
    ? path
    : join(PUBLIC_DIR, path.replace(/^[/\\]+/, ""));
}

async function derivedLogoPath(
  title: string,
): Promise<{ path: string | null; subject: string | null }> {
  const subject = deriveLogoSubject(title);
  if (!subject) return { path: null, subject: null };
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = normalize(subject);
  const files = await readdir(join(PUBLIC_DIR, "app_logos_png")).catch(
    () => [] as string[],
  );
  const match =
    files.find((file) => normalize(file.replace(/\.[^.]+$/, "")) === wanted) ??
    files.find((file) =>
      wanted.includes(normalize(file.replace(/\.[^.]+$/, ""))),
    );
  return {
    path: match ? join(PUBLIC_DIR, "app_logos_png", match) : null,
    subject,
  };
}

let libraryLogoCache: {
  expiresAt: number;
  value: Array<{ name: string; filePath: string }>;
} | null = null;

async function reusableLogoPath(
  db: DrizzleClient,
  title: string,
  subject: string | null,
): Promise<string | null> {
  if (!libraryLogoCache || libraryLogoCache.expiresAt < Date.now()) {
    const rows = await db
      .select({
        name: thumbnailLibraryAssets.name,
        filePath: thumbnailLibraryAssets.file_path,
      })
      .from(thumbnailLibraryAssets)
      .where(eq(thumbnailLibraryAssets.category, "LOGOS"))
      .orderBy(desc(thumbnailLibraryAssets.created_at));
    libraryLogoCache = { expiresAt: Date.now() + 60_000, value: rows };
  }
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedTitle = normalize(title);
  const normalizedSubject = subject ? normalize(subject) : "";
  return (
    libraryLogoCache.value
      .map((asset) => {
        const name = normalize(
          asset.name.replace(/(?:logo|symbol|png|pic|thumb)/gi, ""),
        );
        const score =
          normalizedSubject &&
          (name.includes(normalizedSubject) || normalizedSubject.includes(name))
            ? 10_000 + name.length
            : name && normalizedTitle.includes(name)
              ? name.length
              : 0;
        return { ...asset, score };
      })
      .filter((asset) => asset.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.filePath ?? null
  );
}

/** Produce the selected manual-system thumbnail owned by one finished variant. */
export async function ensureManualTutorialThumbnail(
  db: DrizzleClient,
  job: Pick<
    TutorialJob,
    | "id"
    | "title"
    | "language"
    | "channel_id"
    | "source_job_id"
    | "recording_path"
    | "final_path"
    | "thumbnail_text_top"
    | "thumbnail_text_bottom"
  >,
  options: { forceRender?: boolean } = {},
): Promise<{ id: string; created: boolean }> {
  const context = await resolveTutorialThumbnailContext(db, job);
  const existing = (
    await listThumbnailsForSubject(db, "tutorial_job", job.id)
  ).find(
    (thumbnail) =>
      thumbnail.language === context.language &&
      thumbnail.channel_id === context.channelId &&
      thumbnail.status === "completed" &&
      thumbnail.output_path,
  );
  if (existing && !options.forceRender) {
    await selectThumbnail(db, existing.id);
    return { id: existing.id, created: false };
  }

  const [settings, profile, tutorialProfile, character, derivedLogo] = await Promise.all([
    getTutorialSettings(db),
    getChannelThumbnailProfile(db, context.channelId),
    getTutorialChannelProfile(db, context.channelId),
    resolveCharacterReference(db, context.channelId, {
      subjectId: job.id,
      variantIndex: 0,
      parentThumbnailId: null,
      preferredPoseTerms: ["point", "explain"],
    }),
    derivedLogoPath(job.title),
  ]);
  if (!character) {
    throw new Error(
      `Tutorial ${job.id} channel has no active host image; thumbnail generation will not borrow another channel's host`,
    );
  }

  const host = resolveAssetPath(character.imagePath);
  const reusableLogo = await reusableLogoPath(
    db,
    job.title,
    derivedLogo.subject,
  );
  const logo = profile?.logo_image_path
    ? {
        path: resolveAssetPath(profile.logo_image_path),
        subject: derivedLogo.subject,
      }
    : reusableLogo
      ? { path: resolveAssetPath(reusableLogo), subject: derivedLogo.subject }
      : derivedLogo;
  const headlineSource = [context.thumbnailTextTop, context.thumbnailTextBottom]
    .filter(Boolean)
    .join(" ");
  const lines = proceduralHeadlineBlocks(headlineSource, {
    maxWords: 4,
    logoSubject: logo.subject,
  });
  const palette = ["#a8ff00", "#00e5ff", "#ffd400", "#ff5c8a"];
  const accent =
    profile?.primary_color ??
    palette[hash(context.channelId) % palette.length]!;
  const rootJobId = job.source_job_id ?? job.id;
  const configuredTemplates = tutorialProfile.proceduralTemplates.filter(template => template.enabled&&proceduralTemplateMatches(template,lines,context.language));
  // Built-ins stay consistently right-host. A left-host automatic composition
  // is possible only when an Admin deliberately saves and enables that custom
  // template in Workflow Settings.
  const configuredLayouts = tutorialProfile.proceduralLayoutIds.filter(id => !id.includes("left"));
  const layoutPool: ProceduralLayoutId[] = configuredLayouts.length
    ? configuredLayouts
    : ["ui-card-host-right", "icon-focus-host-right"];
  const outputDir = join(MEDIA_DIR, job.id);
  const outputPath = join(outputDir, `manual-default-${context.language}.png`);
  await mkdir(outputDir, { recursive: true });

  const videoPath = job.final_path ?? job.recording_path;
  const uiScreenshot = tutorialProfile.proceduralUiScreenshot && videoPath
    ? await extractBestInterfaceFrame(videoPath, join(outputDir, `ui-frame-${context.language}.png`))
    : null;
  const logoTreatment = uiScreenshot
    ? tutorialProfile.proceduralLogoTreatment
    : "integrated";
  const hostAlreadyPoints = /\bpoint(?:s|ed|ing)?\b/i.test(
    `${character.pose ?? ""} ${character.expression ?? ""} ${character.imagePath}`,
  );

  const requestedBackgrounds = tutorialProfile.proceduralBackgrounds;
  const configuredBackgrounds: Array<{ path?: string; color?: string; tone: "light" | "dark" }> = requestedBackgrounds.length
    ? requestedBackgrounds.map((id) => BACKGROUND_BY_ID[id])
    : settings.thumbnail_background_rotation.map((name) => {
        const path = BACKGROUND_BY_NAME[name];
        return path ? { path, tone: "light" as const } : undefined;
      }).filter((item): item is { path: string; tone: "light" } => Boolean(item));
  const fallbackBackgrounds: Array<{ path?: string; color?: string; tone: "light" | "dark" }> = ROTATION_BACKGROUNDS.map((path) => ({ path, tone: "light" as const }));
  const backgroundPool = configuredBackgrounds.length ? configuredBackgrounds : fallbackBackgrounds;
  const selectedBackground = backgroundPool[hash(`${rootJobId}:${job.title}:background`) % backgroundPool.length]!;
  const background = selectedBackground.path ? join(PUBLIC_DIR, selectedBackground.path) : undefined;
  const customOffset=configuredTemplates.length?hash(`${rootJobId}:${job.title}:template`)%configuredTemplates.length:0;
  const orderedCustom=configuredTemplates.map((_,index)=>configuredTemplates[(index+customOffset)%configuredTemplates.length]!);
  const automaticTemplates=Array.from({length:6},(_,attempt)=>planProceduralLayout({
    lines,hasUiScreenshot:Boolean(uiScreenshot),variantIndex:hash(`${rootJobId}:${job.title}:geometry`)+attempt,
    auraEnabled:tutorialProfile.proceduralLogoAura,auraX:tutorialProfile.proceduralLogoAuraX,auraY:tutorialProfile.proceduralLogoAuraY,auraRadius:tutorialProfile.proceduralLogoAuraRadius,auraOpacity:tutorialProfile.proceduralLogoAuraOpacity,
  }).template);
  const templateCandidates=[...orderedCustom,...automaticTemplates].map(safeProceduralTemplate);
  let acceptedQuality:ProceduralLocaleQualityReport|null=null;
  const failedReports:ProceduralLocaleQualityReport[]=[];
  for(let attempt=0;attempt<templateCandidates.length;attempt+=1){
    const candidateTemplate=templateCandidates[attempt]!;
    const hostSide:LayoutSide=candidateTemplate.hostSide;
    const requestedLayoutId:ProceduralLayoutId=attempt<orderedCustom.length?`ui-card-host-${hostSide}`:layoutPool[hash(`${rootJobId}:${job.title}:layout:${attempt}`)%layoutPool.length]!;
    const layoutId:ProceduralLayoutId=uiScreenshot?requestedLayoutId:hostSide==='left'?'icon-focus-host-left':'icon-focus-host-right';
    const candidatePath=`${outputPath}.candidate-${attempt}.png`;
    const rendered=await renderManualTutorialArtwork({outputPath:candidatePath,backgroundPath:background,backgroundColor:selectedBackground.color,hostPath:host,logoPath:logo.path,lines,accent,hostSide,layoutId,uiScreenshotPath:uiScreenshot,theme:tutorialProfile.proceduralTheme,hostCrop:tutorialProfile.proceduralHostCrop,hostZoom:candidateTemplate.hostScale,showArrow:tutorialProfile.proceduralArrow&&!hostAlreadyPoints,logoTreatment,logoAura:tutorialProfile.proceduralLogoAura,logoAuraX:tutorialProfile.proceduralLogoAuraX,logoAuraY:tutorialProfile.proceduralLogoAuraY,logoAuraRadius:tutorialProfile.proceduralLogoAuraRadius,logoAuraOpacity:tutorialProfile.proceduralLogoAuraOpacity,template:candidateTemplate,language:context.language,hostPointsAtTarget:hostAlreadyPoints});
    if(rendered.quality?.passed){await rm(outputPath,{force:true});await rename(candidatePath,outputPath);acceptedQuality=rendered.quality;break}
    if(rendered.quality)failedReports.push(rendered.quality);
    await rm(candidatePath,{force:true});
  }
  if(!acceptedQuality){
    const reasons=[...new Set(failedReports.flatMap(report=>report.issues.filter(issue=>issue.severity==='error').map(issue=>issue.message)))];
    throw new Error(`Procedural thumbnail QA rejected every layout candidate: ${reasons.join(' ')||'quality evidence unavailable'}`);
  }
  await writeFile(`${outputPath}.quality.json`,JSON.stringify(acceptedQuality,null,2));

  const headline = lines.join("\n");
  if (existing) {
    await updateThumbnailRecord(db, existing.id, {
      channel_id: context.channelId,
      output_path: outputPath,
      reference_paths: {
        persona: host,
        ...(logo.path ? { logo: logo.path } : {}),
        ...(background ? { base: background } : {}),
        ...(uiScreenshot ? { ui: uiScreenshot } : {}),
      },
      headline_text: headline,
      headline_source: "operator",
      status: "completed",
    });
    await selectThumbnail(db, existing.id);
    return { id: existing.id, created: false };
  }

  const record = await createThumbnailRecord(db, {
    subject_kind: "tutorial_job",
    subject_id: job.id,
    channel_id: context.channelId,
    archetype_id: null,
    language: context.language,
    prompt_mode: "manual",
    prompt_used: `Procedural ${context.language} channel-profile thumbnail`,
    reference_paths: {
      persona: host,
      ...(logo.path ? { logo: logo.path } : {}),
      ...(background ? { base: background } : {}),
      ...(uiScreenshot ? { ui: uiScreenshot } : {}),
    },
    extra_reference_paths: [],
    aspect_ratio: "16:9",
    resolution: "1k",
    title: job.title.slice(0, 300),
    headline_text: headline,
    headline_source: "operator",
    generation_kind: "original",
    output_path: outputPath,
    requested_backend: null,
    provider_used: "manual_system",
    status: "completed",
    is_selected: false,
  });
  await selectThumbnail(db, record.id);
  return { id: record.id, created: true };
}
