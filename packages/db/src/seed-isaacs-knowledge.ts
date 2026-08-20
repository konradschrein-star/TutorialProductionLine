#!/usr/bin/env tsx
/**
 * Seed: Isaac's Knowledge — full course ingestion
 *
 * Run AFTER download-isaacs-knowledge.sh has finished.
 * Scans /opt/content-forge/media/knowledge/isaacs-knowledge/ for downloaded
 * files (named {NN}_*.mp4 by yt-dlp) and registers them in the DB.
 *
 * Usage:
 *   pnpm --filter @repo/db exec tsx src/seed-isaacs-knowledge.ts
 *
 * Idempotent: skips if a course with this title already exists.
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

const BASE_PATH = "/opt/content-forge/media/knowledge/isaacs-knowledge";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan the download directory and return all .mp4 files sorted by prefix.
 * Returns array of { path, title, orderIndex }
 * yt-dlp names files: {NN}_title.mp4 (--restrict-filenames replaces spaces with _)
 */
function getDownloadedVideos(): Array<{ path: string; title: string; orderIndex: number }> {
  if (!existsSync(BASE_PATH)) {
    console.log(`[WARN] Download directory does not exist: ${BASE_PATH}`);
    return [];
  }

  try {
    const files = readdirSync(BASE_PATH)
      .filter((f) => f.endsWith(".mp4"))
      .sort(); // Natural sort by filename (01_, 02_, etc.)

    return files.map((filename) => {
      // Extract order index from prefix (e.g., "01" from "01_title.mp4")
      const match = filename.match(/^(\d+)_(.+)\.mp4$/);
      if (!match) {
        throw new Error(`Invalid filename format: ${filename}`);
      }

      const orderIndex = parseInt(match[1], 10) - 1; // Convert to 0-based index
      const rawTitle = match[2];

      // Un-slug the title: replace underscores with spaces
      const title = rawTitle.replace(/_/g, " ").replace(/\s+/g, " ").trim();

      return {
        path: `${BASE_PATH}/${filename}`,
        title,
        orderIndex,
      };
    });
  } catch (err) {
    console.error(`[ERROR] Failed to scan download directory: ${err}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

console.log("[seed-isaacs-knowledge] Starting...");

// Idempotency: skip if course already exists
const existing = await sql`
  SELECT id FROM courses WHERE title = 'Isaac''s Knowledge' LIMIT 1
`;
if (existing.length > 0) {
  console.log("[seed-isaacs-knowledge] Course already exists — skipping. Delete it first to re-seed.");
  await sql.end();
  process.exit(0);
}

// Create course
const [course] = await sql`
  INSERT INTO courses (title, description, allowed_roles, is_published)
  VALUES (
    'Isaac''s Knowledge',
    'Complete guide to YouTube video creation: scripting, recording, editing, thumbnails, and production workflow. Educational content from Isaac''s channel.',
    ARRAY[]::text[],
    true
  )
  RETURNING id
`;
const courseId = course.id as string;
console.log(`[seed-isaacs-knowledge] Course created: ${courseId}`);

// Create single chapter: "All Videos"
const [chapter] = await sql`
  INSERT INTO course_chapters (course_id, title, icon, order_index)
  VALUES (${courseId}, 'All Videos', 'Video', 0)
  RETURNING id
`;
const chapterId = chapter.id as string;
console.log(`  Chapter created: All Videos → ${chapterId}`);

// Get downloaded videos
const videos = getDownloadedVideos();

if (videos.length === 0) {
  console.log("[WARN] No downloaded videos found. Run download-isaacs-knowledge.sh first.");
  console.log("      Course and chapter created, but no videos registered.");
} else {
  console.log(`  Found ${videos.length} downloaded videos`);

  // Insert videos
  for (const video of videos) {
    await sql`
      INSERT INTO course_videos (chapter_id, title, order_index, video_key, is_published)
      VALUES (
        ${chapterId},
        ${video.title},
        ${video.orderIndex},
        ${video.path},
        true
      )
    `;

    console.log(`    [${video.orderIndex + 1}] ${video.title}`);
  }
}

console.log("");
console.log("[seed-isaacs-knowledge] Done!");
console.log(`  Course ID: ${courseId}`);
console.log(`  Videos registered: ${videos.length}`);
console.log("");
console.log("Next step: run the transcript generation:");
console.log("  python3 scripts/faster-whisper-transcribe-isaacs.py");

await sql.end();
process.exit(0);
