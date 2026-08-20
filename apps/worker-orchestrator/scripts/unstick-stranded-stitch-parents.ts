#!/usr/bin/env tsx
/**
 * unstick-stranded-stitch-parents.ts
 *
 * One-shot repair for LONG_FORM tutorial parents whose stitch job finished but
 * whose parent row was never promoted out of SENT_TO_STITCHER.
 *
 * ROOT CAUSE (verified 2026-08-03): the write-back in
 * apps/worker-video-stitch/src/processors/stitch-processor.ts was never in the
 * deployed bundle. pm2 ran dist/index.js compiled 2026-06-19; the app appears
 * nowhere in .github/workflows/ci.yml, so nothing ever rebuilt it. The
 * try/catch everyone blamed was never reached. See
 * docs/sessions/2026-08-03-TUTORIAL-PIPELINE-HANDOFF.md.
 *
 * This script only repairs the backlog. The forward fix is the rebuild (done)
 * plus the stitch reconciler.
 *
 * Trusts the filesystem over DB status: it promotes ONLY when the rendered
 * artifact is a real non-empty file. A stitch row that says RENDERED while the
 * bytes are gone is surfaced, never promoted — promoting it would write a
 * COMPLETED row whose final_path points at nothing, which the Drive scanner
 * would then fail on forever.
 *
 * NO SYNTHETIC FALLBACKS: never reconstructs a path from a job id, never
 * estimates a duration. Missing data means the job is skipped and named.
 *
 * Run ON THE VPS (it stats real artifact paths — meaningless from a workstation):
 *   DRY RUN:  ./node_modules/.bin/tsx apps/worker-orchestrator/scripts/unstick-stranded-stitch-parents.ts
 *   APPLY:    ./node_modules/.bin/tsx apps/worker-orchestrator/scripts/unstick-stranded-stitch-parents.ts --apply
 *
 * Touches parent rows only. Never children — they rest at RECORDED by design.
 */

import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotenv({ path: resolve(__dirname, "../../../.env") });

import { stat } from "node:fs/promises";
import {
  createDrizzleClient,
  tutorialJobs,
  videoStitchJobs,
  updateTutorialJob,
} from "@repo/db";
import { eq, and, inArray, isNull } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

type Candidate = {
  id: string;
  title: string;
  parent_status: string;
  updated_at: Date;
  stitch_id: string;
  stitch_status: string;
  output_video_path: string | null;
  output_duration_seconds: number | null;
  render_completed_at: Date | null;
};

const days = (d: Date) => Math.round((Date.now() - d.getTime()) / 864e5);

async function main() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const db = createDrizzleClient(databaseUrl);

  const rows = (await db
    .select({
      id: tutorialJobs.id,
      title: tutorialJobs.title,
      parent_status: tutorialJobs.status,
      updated_at: tutorialJobs.updated_at,
      stitch_id: videoStitchJobs.id,
      stitch_status: videoStitchJobs.status,
      output_video_path: videoStitchJobs.output_video_path,
      output_duration_seconds: videoStitchJobs.output_duration_seconds,
      render_completed_at: videoStitchJobs.render_completed_at,
    })
    .from(tutorialJobs)
    .innerJoin(
      videoStitchJobs,
      eq(videoStitchJobs.id, tutorialJobs.stitch_job_id),
    )
    .where(
      and(
        eq(tutorialJobs.mode, "LONG_FORM"),
        isNull(tutorialJobs.parent_job_id),
        inArray(tutorialJobs.status, ["SENT_TO_STITCHER", "READY_TO_STITCH"]),
        inArray(videoStitchJobs.status, ["RENDERED", "UPLOADED"]),
      ),
    )) as Candidate[];

  console.log(
    `${APPLY ? "*** APPLY ***" : "DRY RUN"} — ${rows.length} candidate parent(s)\n`,
  );

  const promote: Candidate[] = [];
  const skip: Array<{ row: Candidate; reason: string }> = [];

  for (const row of rows) {
    if (!row.output_video_path) {
      skip.push({
        row,
        reason: "output_video_path is NULL — refusing to guess",
      });
      continue;
    }
    try {
      const s = await stat(row.output_video_path);
      if (!s.isFile() || s.size === 0) {
        skip.push({ row, reason: `not a non-empty file (size=${s.size})` });
        continue;
      }
      promote.push(row);
    } catch {
      skip.push({ row, reason: `ARTIFACT GONE: ${row.output_video_path}` });
    }
  }

  console.log(`PROMOTE — artifact verified on disk (${promote.length}):`);
  for (const r of promote) {
    console.log(
      `  ${r.id}  ${r.parent_status.padEnd(17)} stitch=${r.stitch_status.padEnd(8)} ${String(days(r.updated_at)).padStart(3)}d  ${r.title}`,
    );
  }

  console.log(`\nSKIP — needs a human (${skip.length}):`);
  for (const { row, reason } of skip) {
    console.log(
      `  ${row.id}  ${String(days(row.updated_at)).padStart(3)}d  ${row.title}`,
    );
    console.log(`      ${reason}`);
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to promote.");
    process.exit(0);
  }

  let done = 0;
  for (const r of promote) {
    // updateTutorialJob, NOT raw SQL: it is the single choke-point that fires
    // the Video ERP status webhook (tutorial-job-repository.ts). Same reasoning
    // as splice-reconciler.
    await updateTutorialJob(db, r.id, {
      status: "COMPLETED",
      final_path: r.output_video_path!,
      completed_at: r.render_completed_at ?? new Date(),
      progress: 100,
      // Duration ONLY when the stitch row actually recorded it. Never estimated.
      ...(r.output_duration_seconds !== null
        ? { recording_duration_s: String(r.output_duration_seconds) }
        : {}),
    });
    done++;
    console.log(`  promoted ${r.id}  ${r.title}`);
  }

  console.log(
    `\nDone: ${done} promoted, ${skip.length} left for a human.\n` +
      `The Drive scanner picks up COMPLETED rows with a non-null final_path — delivery follows.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
