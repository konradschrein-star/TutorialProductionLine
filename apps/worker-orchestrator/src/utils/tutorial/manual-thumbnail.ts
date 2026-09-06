import { mkdir, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import * as fontkit from "fontkit";
import type { Font } from "fontkit";
import sharp from "sharp";
import type { DrizzleClient, TutorialJob } from "@repo/db";
import { defringePersonaRgba } from "@repo/media-core/images";
import {
  createThumbnailRecord,
  getChannelThumbnailProfile,
  getTutorialSettings,
  listThumbnailsForSubject,
  selectThumbnail,
  updateThumbnailRecord,
} from "@repo/db";
import { deriveLogoSubject } from "@repo/domain";
import { resolveCharacterReference } from "../thumbnail/character.js";
import { resolveTutorialThumbnailContext } from "./thumbnail-context.js";

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
const FONT_PATH = "fonts/Montserrat-Bold.ttf";

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

function headlinePaths(
  font: Font,
  lines: readonly string[],
  x: number,
  maxWidth: number,
): string {
  const runs = lines.map((line) => font.layout(line.toUpperCase()));
  const widest = Math.max(...runs.map((run) => run.advanceWidth), 1);
  const fontSize = Math.max(
    58,
    Math.min(88, (maxWidth / widest) * font.unitsPerEm),
  );
  const scale = fontSize / font.unitsPerEm;
  return runs
    .map((run, lineIndex) => {
      let cursor = 0;
      const paths = run.glyphs.map((glyph, glyphIndex) => {
        const position = run.positions[glyphIndex]!;
        const translated = cursor + position.xOffset;
        cursor += position.xAdvance;
        return `<path d="${glyph.path.toSVG()}" transform="translate(${translated} ${position.yOffset})"/>`;
      });
      const baseline = 225 + lineIndex * 112;
      return `<g transform="translate(${x} ${baseline}) scale(${scale} ${-scale})" fill="#111318" stroke="#ffffff" stroke-width="${4 / scale}" paint-order="stroke fill" stroke-linejoin="round">${paths.join("")}</g>`;
    })
    .join("");
}

async function cleanAndSizeHost(
  host: string,
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
  const resized = await sharp(cleaned, { raw: raw.info })
    .trim({ background: "#00000000", threshold: 6 })
    .resize(650, 710, {
      fit: "inside",
      position: "top",
      withoutEnlargement: false,
    })
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
  backgroundPath: string;
  hostPath: string;
  logoPath?: string | null;
  lines: readonly [string, string];
  accent: string;
  hostSide: LayoutSide;
  publicDir?: string;
}

/** Render the reference-inspired office layout without any database access. */
export async function renderManualTutorialArtwork({
  outputPath,
  backgroundPath,
  hostPath,
  logoPath,
  lines,
  accent,
  hostSide,
  publicDir = PUBLIC_DIR,
}: ManualTutorialArtworkInput): Promise<void> {
  const textX = hostSide === "left" ? 610 : 62;
  const cardX = textX - 28;
  const [hostImage, fontBytes] = await Promise.all([
    cleanAndSizeHost(hostPath),
    readFile(join(publicDir, FONT_PATH)),
  ]);
  const font = fontkit.create(fontBytes) as Font;
  const svg = Buffer.from(
    `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="card-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000000" flood-opacity=".24"/>
        </filter>
      </defs>
      <rect x="${cardX}" y="72" width="636" height="350" rx="28" fill="#ffffff" fill-opacity=".91" filter="url(#card-shadow)"/>
      <rect x="${cardX}" y="72" width="16" height="350" rx="8" fill="${escapeXml(accent)}"/>
      ${headlinePaths(font, lines, textX, 560)}
      <rect x="${textX}" y="376" width="270" height="12" rx="6" fill="${escapeXml(accent)}"/>
    </svg>`,
  );
  const hostX = hostSide === "left" ? -12 : 1280 - hostImage.width + 18;
  const hostY = 720 - hostImage.height;
  const composites: sharp.OverlayOptions[] = [
    { input: svg, left: 0, top: 0 },
    { input: hostImage.buffer, left: hostX, top: hostY },
  ];
  if (logoPath) {
    const disc = Buffer.from(
      `<svg width="176" height="176" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="160" height="160" rx="36" fill="white" stroke="${escapeXml(accent)}" stroke-width="8"/></svg>`,
    );
    const logoBuffer = await sharp(logoPath)
      .resize(116, 116, { fit: "contain" })
      .png()
      .toBuffer();
    composites.push(
      { input: disc, left: textX, top: 478 },
      { input: logoBuffer, left: textX + 30, top: 508 },
    );
  }
  await sharp(backgroundPath)
    .resize(1280, 720, { fit: "cover" })
    .modulate({ brightness: 1.02, saturation: 0.9 })
    .blur(0.6)
    .composite(composites)
    .png()
    .toFile(outputPath);
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

  const [settings, profile, character, derivedLogo] = await Promise.all([
    getTutorialSettings(db),
    getChannelThumbnailProfile(db, context.channelId),
    resolveCharacterReference(db, context.channelId, {
      subjectId: job.id,
      variantIndex: 0,
      parentThumbnailId: null,
    }),
    derivedLogoPath(job.title),
  ]);
  if (!character) {
    throw new Error(
      `Tutorial ${job.id} channel has no active host image; thumbnail generation will not borrow another channel's host`,
    );
  }

  const host = resolveAssetPath(character.imagePath);
  const logo = profile?.logo_image_path
    ? { path: resolveAssetPath(profile.logo_image_path), subject: null }
    : derivedLogo;
  const lines: [string, string] = [
    context.thumbnailTextTop,
    context.thumbnailTextBottom,
  ];
  const palette = ["#a8ff00", "#00e5ff", "#ffd400", "#ff5c8a"];
  const accent =
    profile?.primary_color ??
    palette[hash(context.channelId) % palette.length]!;
  const rootJobId = job.source_job_id ?? job.id;
  const hostSide: LayoutSide =
    hash(`${rootJobId}:${job.title}:layout`) % 2 === 0 ? "left" : "right";
  const outputDir = join(MEDIA_DIR, job.id);
  const outputPath = join(outputDir, `manual-default-${context.language}.png`);
  await mkdir(outputDir, { recursive: true });

  const configuredBackgrounds = settings.thumbnail_background_rotation
    .map((name) => BACKGROUND_BY_NAME[name])
    .filter((path): path is string => Boolean(path));
  const backgroundPool = configuredBackgrounds.length
    ? configuredBackgrounds
    : ROTATION_BACKGROUNDS;
  const background = join(
    PUBLIC_DIR,
    backgroundPool[
      hash(`${rootJobId}:${job.title}:background`) % backgroundPool.length
    ]!,
  );
  await renderManualTutorialArtwork({
    outputPath,
    backgroundPath: background,
    hostPath: host,
    logoPath: logo.path,
    lines,
    accent,
    hostSide,
  });

  const headline = lines.join("\n");
  if (existing) {
    await updateThumbnailRecord(db, existing.id, {
      channel_id: context.channelId,
      output_path: outputPath,
      reference_paths: {
        persona: host,
        ...(logo.path ? { logo: logo.path } : {}),
        base: background,
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
      base: background,
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
