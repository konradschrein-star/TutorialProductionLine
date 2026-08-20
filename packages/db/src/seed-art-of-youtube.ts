#!/usr/bin/env tsx
/**
 * Seed: The Art of YouTube — full course ingestion
 *
 * Run AFTER download-art-of-youtube.sh has finished.
 * Scans /opt/content-forge/media/knowledge/art-of-youtube/ for downloaded
 * files (named {MM}-{LL}_*.mp4 by yt-dlp) and registers them in the DB.
 *
 * Usage:
 *   pnpm --filter @repo/db exec tsx src/seed-art-of-youtube.ts
 *
 * Idempotent: skips if a course with this slug-title already exists.
 */

import postgres from "postgres";
import { readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../.env") });

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const sql = postgres(DATABASE_URL, { max: 1 });

const BASE_PATH = "/opt/content-forge/media/knowledge/art-of-youtube";

// ─────────────────────────────────────────────────────────────────────────────
// Course definition — titles, docs links, chapter icons
// ─────────────────────────────────────────────────────────────────────────────

type VideoMeta = {
  prefix: string;          // e.g. "01-02" — matches downloaded filename prefix
  fallbackTitle: string;   // used if no file found yet
  docs?: string[];         // Google Docs / Drive links shown below video
};

type ChapterDef = {
  title: string;
  icon: string;            // Lucide icon name
  videos: VideoMeta[];
};

const CHAPTERS: ChapterDef[] = [
  {
    title: "Module 0 — Start Here",
    icon: "Rocket",
    videos: [
      {
        prefix: "00-00",
        fallbackTitle: "Niche Bending Workshop",
      },
    ],
  },
  {
    title: "Module 1 — Fundamentals",
    icon: "BookOpen",
    videos: [
      {
        prefix: "01-01",
        fallbackTitle: "The Algorithm Is an Ally: CTR, Retention, and Market Selection",
      },
      {
        prefix: "01-02",
        fallbackTitle: "How to Choose a Niche: Demand, Competition, and the SOP Table",
        docs: [
          "https://docs.google.com/spreadsheets/d/1qSIY8uSqImBrsIPkXJLXXYUGT7KsAHWnjKU2JV5N1ew/edit?gid=1349912912#gid=1349912912",
        ],
      },
      {
        prefix: "01-03",
        fallbackTitle: "\"Incognito Tap\": How to Find Growing YouTube Niches",
      },
      {
        prefix: "01-04",
        fallbackTitle: "\"Copycat Radar\": How to Tell a Thriving Niche from an Oversaturated One",
      },
      {
        prefix: "01-05",
        fallbackTitle: "\"Pattern Transfer\": Port Viral Formats into Your Niche",
        docs: [
          "https://docs.google.com/spreadsheets/d/1qSIY8uSqImBrsIPkXJLXXYUGT7KsAHWnjKU2JV5N1ew/edit?usp=sharing",
        ],
      },
      {
        prefix: "01-06",
        fallbackTitle: "\"Long-form vs. Shorts\": How to Choose the Right Format",
      },
      {
        prefix: "01-07",
        fallbackTitle: "\"Pipeline Builder\": How to Build a Production Line",
        docs: [
          "https://docs.google.com/spreadsheets/d/10NZ6iv1prlQ7DpBY9ScT8Ot-WNtJeQLnPgRBZaCwCuk/edit?gid=0#gid=0",
          "https://drive.google.com/drive/folders/17c3INJGLSLDkhkGF-GVV-zGeEixG-KYR",
        ],
      },
      {
        prefix: "01-08",
        fallbackTitle: "\"Niche Validator\": The Spreadsheet That Decides Enter or Not",
        docs: [
          "https://docs.google.com/spreadsheets/d/1qSIY8uSqImBrsIPkXJLXXYUGT7KsAHWnjKU2JV5N1ew/edit?gid=1349912912#gid=1349912912",
        ],
      },
    ],
  },
  {
    title: "Module 2 — Finding & Validating Niches + Scripts",
    icon: "Search",
    videos: [
      {
        prefix: "02-01",
        fallbackTitle: "YouTube System: From Idea to Final Video",
        docs: [
          "https://docs.google.com/document/d/1gSo-k8O1_TdEI3809KPAWRDKGLAkDU5yCZcesA6Stqs/edit?tab=t.0#heading=h.cw720iqqr5qh",
        ],
      },
      {
        prefix: "02-02",
        fallbackTitle: "Asana for Production: Team, Project, Board, Fields",
      },
      {
        prefix: "02-03",
        fallbackTitle: "Profit Model & Calculator: Costs, RPM/PPM, and Team",
        docs: [
          "https://docs.google.com/spreadsheets/d/1uw321sbjY6XWEkbgSLuNE_ql52ZZwFXzagsFnSgE6Dk/edit?gid=2085264411#gid=2085264411",
        ],
      },
      {
        prefix: "02-04",
        fallbackTitle: "Viral Idea Engine: 3 Discovery Methods & the Validator",
        docs: [
          "https://docs.google.com/spreadsheets/d/10NZ6iv1prlQ7DpBY9ScT8Ot-WNtJeQLnPgRBZaCwCuk/edit?gid=0#gid=0",
        ],
      },
      {
        prefix: "02-05",
        fallbackTitle: "How I Write My Scripts: 7 Steps, Hook Mechanics & Analysis",
        docs: [
          "https://docs.google.com/document/d/14PBdD6Hc_BEvqbXgQHGoheOScqaqXS-__8C7qUCbemc/edit?tab=t.0",
        ],
      },
      {
        prefix: "02-06",
        fallbackTitle: "Script Reviews",
      },
    ],
  },
  {
    title: "Module 3 — Content Production Control",
    icon: "Sliders",
    videos: [
      {
        prefix: "03-01",
        fallbackTitle: "How To Control Content Production",
        docs: [
          "https://docs.google.com/spreadsheets/d/1CBRJJYpUeCch3VeLdwF0RD4nvV2T2178Ppb6ZdAQsxU/edit?gid=1673758759#gid=1673758759",
        ],
      },
      {
        prefix: "03-02",
        fallbackTitle: "How It Looks in Asana",
      },
      {
        prefix: "03-03",
        fallbackTitle: "Quality Control",
        docs: [
          "https://docs.google.com/presentation/d/1yEfEX4JqLL-XMM1aBGOmdZiJ87-1sx_gzg8Giv-h6Z4/edit",
          "https://docs.google.com/presentation/d/16t_NspgmCxyhaBx0HzlTuCwC0yEMkKXIOkT_JPshK8s/edit",
        ],
      },
      {
        prefix: "03-04",
        fallbackTitle: "Monthly Report",
        docs: [
          "https://docs.google.com/document/d/11BXUuM4oA0eGxotPZB5wgQpv651CFsCqWJc5CLOjEgo/edit?tab=t.0",
        ],
      },
    ],
  },
  {
    title: "Module 4 — YouTube Hacks",
    icon: "Zap",
    videos: [
      {
        prefix: "04-01",
        fallbackTitle: "How To Set Up / Buy A YT Channel",
        docs: [
          "https://docs.google.com/spreadsheets/d/1qSIY8uSqImBrsIPkXJLXXYUGT7KsAHWnjKU2JV5N1ew/edit",
        ],
      },
      { prefix: "04-02", fallbackTitle: "YT Studio Set Up" },
      { prefix: "04-03", fallbackTitle: "Security" },
      { prefix: "04-04", fallbackTitle: "How To Post YT Videos: Hacks and Tricks" },
      { prefix: "04-05", fallbackTitle: "Benefits of Having an MCN" },
    ],
  },
  {
    title: "Module 5 — Hiring",
    icon: "Users",
    videos: [
      { prefix: "05-01", fallbackTitle: "Hiring Lecture" },
      { prefix: "05-02", fallbackTitle: "Building Your Hiring Funnel" },
      {
        prefix: "05-03",
        fallbackTitle: "How To Hire On Telegram",
        docs: [
          "https://docs.google.com/document/d/1s2yzuYmHagILldW9AFjRLFHFE6YyHlt8OvtWdJUuW48/edit?tab=t.0#heading=h.bag2wix28iww",
        ],
      },
      { prefix: "05-04", fallbackTitle: "How To Dial In Your Hiring Funnel" },
      {
        prefix: "05-05",
        fallbackTitle: "Hiring Scripts & Processes",
        docs: [
          "https://docs.google.com/spreadsheets/d/1wh8mzSsPnk7jAY6VrOuX0cQ00vNMsyw4FH-M5ssXIrI/edit?gid=180531119#gid=180531119",
        ],
      },
      {
        prefix: "05-06",
        fallbackTitle: "How To Manage Your Team",
        docs: [
          "https://docs.google.com/spreadsheets/d/1CBRJJYpUeCch3VeLdwF0RD4nvV2T2178Ppb6ZdAQsxU/edit?gid=1673758759#gid=1673758759",
          "https://docs.google.com/document/d/1LGr3emB60DfK6IU_QAJhTzeh012caIVepzik2UTo6cM/edit?tab=t.0#heading=h.xrsfcjh5ylu0",
        ],
      },
      {
        prefix: "05-07",
        fallbackTitle: "How To Fire People",
        docs: [
          "https://drive.google.com/file/d/1ALvwCSm7vaU2qyIpYj9rtMoV_ArlNYig/view?usp=sharing",
        ],
      },
    ],
  },
  {
    title: "Module 6 — Scaling",
    icon: "TrendingUp",
    videos: [
      { prefix: "06-01", fallbackTitle: "How & When You Need To Scale / Critical Mass" },
      {
        prefix: "06-02",
        fallbackTitle: "Making Executive Decisions Based on Data",
        docs: [
          "https://docs.google.com/spreadsheets/d/1uw321sbjY6XWEkbgSLuNE_ql52ZZwFXzagsFnSgE6Dk/edit?gid=2085264411#gid=2085264411",
        ],
      },
      {
        prefix: "06-03",
        fallbackTitle: "PNL: How/Why To Track Your Profit",
        docs: [
          "https://docs.google.com/spreadsheets/d/1uw321sbjY6XWEkbgSLuNE_ql52ZZwFXzagsFnSgE6Dk/edit?gid=2085264411#gid=2085264411",
        ],
      },
    ],
  },
  {
    title: "Module 7 — Investment",
    icon: "DollarSign",
    videos: [
      { prefix: "07-01", fallbackTitle: "Investment 101: The Big Lecture" },
      {
        prefix: "07-02",
        fallbackTitle: "Building Relationships with Investors (Current & Future)",
        docs: [
          "https://docs.google.com/document/d/1w4RVHlbZCeUX7pMP__b-UY7_czT4mtHIpg1FzG4XP4g/edit?tab=t.0#heading=h.6ilbd1iux0f1",
        ],
      },
      { prefix: "07-03", fallbackTitle: "Browsing Flipps" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan the download directory for a file whose name starts with the given prefix.
 * Returns { path, title } or null if not found.
 * yt-dlp names files: {PREFIX}_{title}.mp4 (--restrict-filenames replaces spaces with _)
 */
function findDownloadedFile(prefix: string): { path: string; title: string } | null {
  if (!existsSync(BASE_PATH)) return null;
  try {
    const files = readdirSync(BASE_PATH);
    const match = files.find((f) => f.startsWith(prefix + "_") && f.endsWith(".mp4"));
    if (!match) return null;

    // Extract title from filename: strip prefix and extension, then un-slug
    const raw = match.slice(prefix.length + 1, -4); // remove "01-02_" and ".mp4"
    const title = raw.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    return { path: `${BASE_PATH}/${match}`, title };
  } catch {
    return null;
  }
}

function buildDescription(docs?: string[]): string {
  if (!docs || docs.length === 0) return "";
  const lines = docs.map((url) => {
    if (url.includes("drive.google.com/drive")) return `📁 Google Drive: ${url}`;
    if (url.includes("drive.google.com/file")) return `📎 Google Drive File: ${url}`;
    if (url.includes("docs.google.com/spreadsheets")) return `📊 Spreadsheet: ${url}`;
    if (url.includes("docs.google.com/presentation")) return `📊 Slides: ${url}`;
    return `📄 Docs: ${url}`;
  });
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

console.log("[seed-art-of-youtube] Starting...");

// Idempotency: skip if course already exists
const existing = await sql`
  SELECT id FROM courses WHERE title = 'The Art of YouTube' LIMIT 1
`;
if (existing.length > 0) {
  console.log("[seed-art-of-youtube] Course already exists — skipping. Delete it first to re-seed.");
  await sql.end();
  process.exit(0);
}

// Create course
const [course] = await sql`
  INSERT INTO courses (title, description, allowed_roles, is_published)
  VALUES (
    'The Art of YouTube',
    'Timofey''s complete system for building and scaling faceless YouTube channels — from niche selection to team management and investment.',
    ARRAY['ADMIN', 'MANAGER', 'VIEWER']::text[],
    true
  )
  RETURNING id
`;
const courseId = course.id as string;
console.log(`[seed-art-of-youtube] Course created: ${courseId}`);

// Create chapters + videos
for (let ci = 0; ci < CHAPTERS.length; ci++) {
  const chapter = CHAPTERS[ci];

  const [chapterRow] = await sql`
    INSERT INTO course_chapters (course_id, title, icon, order_index)
    VALUES (${courseId}, ${chapter.title}, ${chapter.icon}, ${ci})
    RETURNING id
  `;
  const chapterId = chapterRow.id as string;
  console.log(`  Chapter [${ci}] ${chapter.title} → ${chapterId}`);

  for (let vi = 0; vi < chapter.videos.length; vi++) {
    const v = chapter.videos[vi];
    const downloaded = findDownloadedFile(v.prefix);

    const title = downloaded?.title || v.fallbackTitle;
    const videoKey = downloaded?.path || `${BASE_PATH}/${v.prefix}.mp4`;
    const isPublished = !!downloaded;
    const description = buildDescription(v.docs);

    await sql`
      INSERT INTO course_videos (chapter_id, title, description, order_index, video_key, is_published)
      VALUES (${chapterId}, ${title}, ${description}, ${vi}, ${videoKey}, ${isPublished})
    `;

    const status = downloaded ? "✓ file found" : "⚠ file not downloaded yet";
    console.log(`    [${v.prefix}] ${title.slice(0, 60)} — ${status}`);
  }
}

console.log("");
console.log("[seed-art-of-youtube] Done!");
console.log(`  Course ID: ${courseId}`);
console.log("  Videos without files will have is_published=false.");
console.log("  Re-run after downloading to update paths and publish.");

await sql.end();
process.exit(0);
