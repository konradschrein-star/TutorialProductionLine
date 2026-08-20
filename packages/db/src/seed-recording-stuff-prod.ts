#!/usr/bin/env tsx
/**
 * Seed: Recording Stuff — OBS recording tutorial course (PRODUCTION)
 *
 * Adds the "Recording Stuff" knowledge course with the OBS setup tutorial video.
 * Production version: assumes video file is already uploaded to server.
 *
 * Usage (on production server):
 *   cd /opt/content-forge
 *   pnpm --filter @repo/db exec tsx src/seed-recording-stuff-prod.ts
 *
 * Idempotent: skips if a course with this title already exists.
 */

import postgres from "postgres";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../.env") });

const DATABASE_URL = process.env["DATABASE_URL"];
const LOCAL_MEDIA_ROOT = process.env["LOCAL_MEDIA_ROOT"];

if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
if (!LOCAL_MEDIA_ROOT) throw new Error("LOCAL_MEDIA_ROOT not set");

const sql = postgres(DATABASE_URL, { max: 1 });

// Production paths
const COURSE_SLUG = "recording-stuff";
const VIDEO_PATH = `${LOCAL_MEDIA_ROOT}/knowledge/${COURSE_SLUG}/best-obs-studio-settings-for-recording-2026.mp4`;

// Video metadata (from ffprobe)
const VIDEO_DURATION_SECONDS = 330; // 329.63 rounded

console.log("[seed-recording-stuff-prod] Starting...");
console.log(`  Video path: ${VIDEO_PATH}`);
console.log(`  LOCAL_MEDIA_ROOT: ${LOCAL_MEDIA_ROOT}`);

// Verify video file exists
if (!existsSync(VIDEO_PATH)) {
  console.error(`[ERROR] Video file not found: ${VIDEO_PATH}`);
  console.error("  Make sure the video has been uploaded to the server first.");
  await sql.end();
  process.exit(1);
}
console.log(`  ✓ Video file found`);

// Idempotency: skip if course already exists
const existing = await sql`
  SELECT id FROM courses WHERE title = 'Recording Stuff' LIMIT 1
`;
if (existing.length > 0) {
  console.log(
    "[seed-recording-stuff-prod] Course already exists — skipping. Delete it first to re-seed.",
  );
  await sql.end();
  process.exit(0);
}

// Create course
const [course] = await sql`
  INSERT INTO courses (title, description, allowed_roles, is_published)
  VALUES (
    'Recording Stuff',
    'Learn professional recording techniques, OBS Studio setup, and screen capture best practices for content creation.',
    ARRAY[]::text[],
    true
  )
  RETURNING id
`;
const courseId = course.id as string;
console.log(`[seed-recording-stuff-prod] Course created: ${courseId}`);

// Create chapter: "Setting Up OBS"
const [chapter] = await sql`
  INSERT INTO course_chapters (course_id, title, description, icon, order_index)
  VALUES (
    ${courseId},
    'Setting Up OBS',
    'Configure OBS Studio for high-quality screen recording and streaming',
    'Monitor',
    0
  )
  RETURNING id
`;
const chapterId = chapter.id as string;
console.log(`  Chapter created: Setting Up OBS → ${chapterId}`);

// Insert video
await sql`
  INSERT INTO course_videos (
    chapter_id,
    title,
    description,
    order_index,
    video_key,
    duration_seconds,
    is_published
  )
  VALUES (
    ${chapterId},
    'Best OBS Studio Settings for RECORDING in 2026 (For Beginners)',
    'Complete guide to configuring OBS Studio for optimal recording quality, including resolution, bitrate, encoder settings, and output formats.',
    0,
    ${VIDEO_PATH},
    ${VIDEO_DURATION_SECONDS},
    true
  )
`;

console.log(
  `    [1] Best OBS Studio Settings for RECORDING in 2026 (For Beginners)`,
);
console.log("");
console.log("[seed-recording-stuff-prod] Done!");
console.log(`  Course ID: ${courseId}`);
console.log(`  Duration: ${VIDEO_DURATION_SECONDS}s (~5.5 minutes)`);
console.log(`  Video file: ${VIDEO_PATH}`);
console.log("");
console.log(
  "✓ Course 'Recording Stuff' is now available in production Hub knowledge section.",
);

await sql.end();
process.exit(0);
