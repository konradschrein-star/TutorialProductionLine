import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import type { DrizzleClient, TutorialJob } from "@repo/db";
import {
  createThumbnailRecord,
  listThumbnailsForSubject,
  selectThumbnail,
  updateThumbnailRecord,
  getTutorialSettings,
} from "@repo/db";
import { deriveLogoSubject } from "@repo/domain";
import { condenseHeadline } from "../thumbnail/headline.js";

const MEDIA_DIR = process.env["THUMBNAIL_MEDIA_DIR"] ?? join(process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media", "thumbnails");
const PUBLIC_DIR = process.env["HUB_PUBLIC_DIR"] ?? resolve(process.cwd(), "../hub-web/public");
const ROTATION_BACKGROUNDS = [
  "background/bg_9_5717314.jpg", // Modern Minimal Tech
  "background/bg_6_322338.jpg", // Neon Glow Studio
  "background/bg_5_4386356.jpg", // Dark Corporate Slate
  "background/bg_1_1128207.jpg", // Abstract Gradient Blue
];
const BACKGROUND_BY_NAME: Record<string, string> = {
  "Modern Minimal Tech": "background/bg_9_5717314.jpg",
  "Neon Glow Studio": "background/bg_6_322338.jpg",
  "Dark Corporate Slate": "background/bg_5_4386356.jpg",
  "Abstract Gradient Blue": "background/bg_1_1128207.jpg",
};

const HOSTS: Record<string, string[]> = {
  en: ["English/american-hero.png", "English/american-pointing.png", "English/american-thumbs-up.png", "English/american-explaining.png"],
  de: ["germanese/german-hero.png", "germanese/german-pointing.png", "germanese/german-thumbs-up.png", "germanese/german-explaining.png"],
  fr: ["French/french-hero.png", "French/french-pointing.png", "French/french-thumbs-up.png", "French/french-explaining.png"],
  it: ["Italy/italian-hero.png", "Italy/italian-pointing.png", "Italy/italian-thumbs-up.png", "Italy/italian-explaining.png"],
  nl: ["Dutch/dutch-hero.png", "Dutch/dutch-pointing.png", "Dutch/dutch-thumbs-up.png", "Dutch/dutch-explaining.png"],
  sv: ["Swedish/swedish-hero.png", "Swedish/swedish-pointing.png", "Swedish/swedish-thumbs-up.png"],
};

function languageCode(language: string | null): string {
  const value = (language ?? "en").toLowerCase();
  return ({ english: "en", german: "de", french: "fr", italian: "it", dutch: "nl", swedish: "sv" } as Record<string, string>)[value] ?? value.slice(0, 2);
}

function hash(text: string): number {
  return [...text].reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 7);
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function logoPath(title: string): Promise<{ path: string | null; subject: string | null }> {
  const subject = deriveLogoSubject(title);
  if (!subject) return { path: null, subject: null };
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = normalise(subject);
  const files = await readdir(join(PUBLIC_DIR, "app_logos_png")).catch(() => [] as string[]);
  const match = files.find((file) => normalise(file.replace(/\.[^.]+$/, "")) === wanted)
    ?? files.find((file) => wanted.includes(normalise(file.replace(/\.[^.]+$/, ""))));
  return { path: match ? join(PUBLIC_DIR, "app_logos_png", match) : null, subject };
}

/** Produce the editable/manual-system starting point for one finished video. */
export async function ensureManualTutorialThumbnail(
  db: DrizzleClient,
  job: Pick<TutorialJob, "id" | "title" | "language" | "channel_id">,
  options: { forceRender?: boolean; targetLanguage?: string; translatedTitle?: string } = {},
): Promise<{ id: string; created: boolean }> {
  const lang = languageCode(options.targetLanguage ?? job.language);
  const title = options.translatedTitle?.trim() || job.title;
  const existing = (await listThumbnailsForSubject(db, "tutorial_job", job.id))
    .find((thumbnail) => thumbnail.language === lang && thumbnail.status === "completed" && thumbnail.output_path);
  if (existing && !options.forceRender) return { id: existing.id, created: false };

  const settings = await getTutorialSettings(db);
  const configuredHosts = settings.thumbnail_persona_rotation?.[lang];
  const hosts = configuredHosts?.length ? configuredHosts : (HOSTS[lang] ?? HOSTS.en!);
  const host = join(PUBLIC_DIR, hosts[hash(job.id) % hosts.length]!);
  const logo = await logoPath(title);
  const headline = condenseHeadline(title, { maxWords: 3, logoSubject: logo.path ? logo.subject : null }) || "WATCH THIS";
  const words = headline.toUpperCase().split(/\s+/);
  const lines = words.length === 3 ? [words.slice(0, 2).join(" "), words[2]!] : words.length === 2 ? words : [words[0]!];
  const fontSize = Math.max(62, Math.min(100, Math.floor(760 / Math.max(...lines.map((line) => line.length), 5)) * 1.2));
  const accent = ["#a8ff00", "#00e5ff", "#ffd400", "#ff5c8a"][hash(title) % 4]!;
  const hostLeft = hash(`${job.id}:layout`) % 2 === 0;
  const textX = hostLeft ? 535 : 55;
  const hostX = hostLeft ? 20 : 790;
  const outputDir = join(MEDIA_DIR, job.id);
  const outputPath = join(outputDir, `manual-default-${lang}.png`);
  await mkdir(outputDir, { recursive: true });

  const configuredBackgrounds = settings.thumbnail_background_rotation
    .map((name) => BACKGROUND_BY_NAME[name])
    .filter((path): path is string => Boolean(path));
  const backgroundPool = configuredBackgrounds.length ? configuredBackgrounds : ROTATION_BACKGROUNDS;
  const background = join(
    PUBLIC_DIR,
    backgroundPool[hash(`${job.id}:background`) % backgroundPool.length]!,
  );
  const svg = Buffer.from(`<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
    <circle cx="1100" cy="80" r="330" fill="${accent}" opacity=".13"/>
    <rect x="${textX - 24}" y="92" width="690" height="360" rx="28" fill="#000" opacity=".28"/>
    ${lines.map((line, index) => `<text x="${textX}" y="${220 + index * 122}" font-family="Arial Black,Arial" font-weight="900" font-size="${fontSize}" font-style="italic" fill="white" stroke="#000" stroke-width="14" paint-order="stroke" letter-spacing="2">${escapeXml(line)}</text>`).join("")}
    <rect x="${textX}" y="${245 + (lines.length - 1) * 122}" width="300" height="14" rx="7" fill="${accent}"/>
  </svg>`);
  // Decontaminate the semi-transparent green-screen fringe once before
  // composition. Green-dominant edge pixels lose spill and opacity while skin,
  // clothing and intentional non-dominant greens remain untouched.
  const rawHost = await sharp(host).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < rawHost.data.length; index += 4) {
    const red = rawHost.data[index]!;
    const green = rawHost.data[index + 1]!;
    const blue = rawHost.data[index + 2]!;
    if (green > red * 1.16 && green > blue * 1.16) {
      const neutral = Math.max(red, blue);
      const spill = green - neutral;
      rawHost.data[index + 1] = Math.min(255, neutral + 8);
      rawHost.data[index + 3] = Math.round(rawHost.data[index + 3]! * Math.max(0, 1 - (spill / 255) * 0.9));
    }
  }
  const hostBuffer = await sharp(rawHost.data, { raw: rawHost.info })
    .trim({ background: "#000000", threshold: 8 })
    .resize(470, 680, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const composites: sharp.OverlayOptions[] = [{ input: hostBuffer, left: hostX, top: 40 }];
  if (logo.path) {
    const disc = Buffer.from(`<svg width="190" height="190" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="180" height="180" rx="38" fill="white" stroke="${accent}" stroke-width="10"/></svg>`);
    const logoBuffer = await sharp(logo.path).resize(130, 130, { fit: "contain" }).png().toBuffer();
    composites.push({ input: disc, left: textX + 430, top: 470 }, { input: logoBuffer, left: textX + 460, top: 500 });
  }
  await sharp(background)
    .resize(1280, 720, { fit: "cover" })
    .composite([{ input: svg }, ...composites])
    .png()
    .toFile(outputPath);

  if (existing) {
    await updateThumbnailRecord(db, existing.id, {
      output_path: outputPath,
      reference_paths: { persona: host, ...(logo.path ? { logo: logo.path } : {}), base: background },
      headline_text: headline,
      status: "completed",
    });
    return { id: existing.id, created: false };
  }

  const record = await createThumbnailRecord(db, {
    subject_kind: "tutorial_job", subject_id: job.id, channel_id: job.channel_id,
    archetype_id: null, language: lang, prompt_mode: "manual", prompt_used: "Procedural manual-system starting thumbnail",
    reference_paths: { persona: host, ...(logo.path ? { logo: logo.path } : {}), base: background }, extra_reference_paths: [],
    aspect_ratio: "16:9", resolution: "1k", title: title.slice(0, 300), headline_text: headline,
    headline_source: "title_fallback", generation_kind: "original", output_path: outputPath,
    requested_backend: null, provider_used: "manual_system", status: "completed", is_selected: false,
  });
  await selectThumbnail(db, record.id);
  return { id: record.id, created: true };
}
