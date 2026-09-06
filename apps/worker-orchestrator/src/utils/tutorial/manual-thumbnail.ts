import { mkdir, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import sharp from "sharp";
import type { DrizzleClient, TutorialJob } from "@repo/db";
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
  "background/bg_9_5717314.jpg",
  "background/bg_6_322338.jpg",
  "background/bg_5_4386356.jpg",
  "background/bg_1_1128207.jpg",
];
const BACKGROUND_BY_NAME: Record<string, string> = {
  "Modern Minimal Tech": "background/bg_9_5717314.jpg",
  "Neon Glow Studio": "background/bg_6_322338.jpg",
  "Dark Corporate Slate": "background/bg_5_4386356.jpg",
  "Abstract Gradient Blue": "background/bg_1_1128207.jpg",
};

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
  const lines = [context.thumbnailTextTop, context.thumbnailTextBottom];
  const fontSize = Math.max(
    54,
    Math.min(
      94,
      Math.floor(760 / Math.max(...lines.map((line) => line.length), 5)) * 1.2,
    ),
  );
  const palette = ["#a8ff00", "#00e5ff", "#ffd400", "#ff5c8a"];
  const accent =
    profile?.primary_color ??
    palette[hash(context.channelId) % palette.length]!;
  const secondary = profile?.secondary_color ?? "#000000";
  const hostLeft = hash(`${job.id}:layout`) % 2 === 0;
  const textX = hostLeft ? 535 : 55;
  const hostX = hostLeft ? 20 : 790;
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
      hash(`${context.channelId}:background`) % backgroundPool.length
    ]!,
  );
  const svg =
    Buffer.from(`<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
    <circle cx="1100" cy="80" r="330" fill="${escapeXml(accent)}" opacity=".13"/>
    <rect x="${textX - 24}" y="92" width="690" height="360" rx="28" fill="${escapeXml(secondary)}" opacity=".34"/>
    ${lines.map((line, index) => `<text x="${textX}" y="${220 + index * 122}" font-family="Arial Black,Arial" font-weight="900" font-size="${fontSize}" font-style="italic" fill="white" stroke="#000" stroke-width="14" paint-order="stroke" letter-spacing="2">${escapeXml(line)}</text>`).join("")}
    <rect x="${textX}" y="367" width="300" height="14" rx="7" fill="${escapeXml(accent)}"/>
  </svg>`);

  const rawHost = await sharp(host)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let index = 0; index < rawHost.data.length; index += 4) {
    const red = rawHost.data[index]!;
    const green = rawHost.data[index + 1]!;
    const blue = rawHost.data[index + 2]!;
    if (green > red * 1.16 && green > blue * 1.16) {
      const neutral = Math.max(red, blue);
      const spill = green - neutral;
      rawHost.data[index + 1] = Math.min(255, neutral + 8);
      rawHost.data[index + 3] = Math.round(
        rawHost.data[index + 3]! * Math.max(0, 1 - (spill / 255) * 0.9),
      );
    }
  }
  const hostBuffer = await sharp(rawHost.data, { raw: rawHost.info })
    .trim({ background: "#000000", threshold: 8 })
    .resize(470, 680, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const composites: sharp.OverlayOptions[] = [
    { input: hostBuffer, left: hostX, top: 40 },
  ];
  if (logo.path) {
    const disc = Buffer.from(
      `<svg width="190" height="190" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="180" height="180" rx="38" fill="white" stroke="${escapeXml(accent)}" stroke-width="10"/></svg>`,
    );
    const logoBuffer = await sharp(logo.path)
      .resize(130, 130, { fit: "contain" })
      .png()
      .toBuffer();
    composites.push(
      { input: disc, left: textX + 430, top: 470 },
      { input: logoBuffer, left: textX + 460, top: 500 },
    );
  }
  await sharp(background)
    .resize(1280, 720, { fit: "cover" })
    .composite([{ input: svg }, ...composites])
    .png()
    .toFile(outputPath);

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
