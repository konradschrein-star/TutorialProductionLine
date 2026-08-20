import { readdir, stat, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MEDIA_BASE =
  process.env["DRAMA_MEDIA_DIR"] ?? "/opt/content-forge/media/long-form-drama";

/**
 * One-shot cleanup runs at worker-orchestrator startup.
 *
 * Two things we recover from:
 *
 * 1) Orphan ffmpeg processes left behind when the worker was killed
 *    mid-encode (e.g. PM2 restart during drama-assemble). They keep
 *    eating CPU + memory after the worker is gone. SIGTERM any
 *    ffmpeg whose parent isn't the current worker process.
 *
 * 2) Intermediate files from interrupted runs:
 *      *.raw.mp4         — pre-loop VEO output
 *      *.looped.mp4      — pre-Ken-Burns looped clip
 *      *.kbchunk-*.mp4   — Ken Burns chunked render
 *      *.kblist.txt      — concat list for Ken Burns chunks
 *      group-*.mp4       — per-group assembly output
 *      chunk-*.mp4       — older Ken Burns chunk format (still on disk)
 *    These are huge (50-500 MB each) and accumulate over failed runs.
 *    Older than 24 h gets nuked.
 */
export async function runDramaCleanup(): Promise<void> {
  await Promise.all([cleanupOrphanFfmpeg(), cleanupIntermediateFiles()]);
}

async function cleanupOrphanFfmpeg(): Promise<void> {
  const myPid = process.pid;
  try {
    // ps -eo pid=,ppid=,args= gives us PID, PPID, full command line —
    // PPID is what makes this safe: we only kill ffmpegs whose parent
    // is NOT this worker process (i.e. true orphans from a previous
    // worker that PM2 killed).
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,args="]);
    const lines = stdout.split("\n").filter(Boolean);
    let killed = 0;
    for (const raw of lines) {
      const m = raw.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const ppid = Number(m[2]);
      const cmd = m[3] ?? "";
      if (!cmd.startsWith("ffmpeg") && !cmd.includes("/ffmpeg")) continue;
      // Must look like drama intermediate work.
      if (!cmd.includes(MEDIA_BASE)) continue;
      // SAFETY: never kill a child of the current worker — that would
      // murder our own in-flight encodes (the new worker might already
      // have started one between bootstrap and cleanup).
      if (ppid === myPid) continue;
      try {
        process.kill(pid, "SIGTERM");
        killed += 1;
      } catch {
        // gone or perm denied
      }
    }
    if (killed > 0) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "[cleanup] Killed orphan ffmpeg processes",
          count: killed,
        }),
      );
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "[cleanup] orphan ffmpeg scan failed",
        error: String(err).slice(0, 200),
      }),
    );
  }
}

const INTERMEDIATE_PATTERNS = [
  /\.raw\.mp4$/,
  /\.looped\.mp4$/,
  /\.kbchunk-\d+\.mp4$/,
  /\.kblist\.txt$/,
  /^group-\d+\.mp4$/,
  /^chunk-\d+\.mp4$/,
];
const MAX_INTERMEDIATE_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

async function cleanupIntermediateFiles(): Promise<void> {
  let removed = 0;
  let bytesFreed = 0;
  try {
    const jobs = await readdir(MEDIA_BASE).catch(() => []);
    const now = Date.now();
    for (const jobDir of jobs) {
      const jobPath = join(MEDIA_BASE, jobDir);
      await walkAndClean(jobPath, now, (size) => {
        removed += 1;
        bytesFreed += size;
      });
    }
    if (removed > 0) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "[cleanup] Reclaimed intermediate files",
          files: removed,
          bytes_freed: bytesFreed,
          gb_freed: (bytesFreed / 1e9).toFixed(2),
        }),
      );
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "[cleanup] Intermediate scan failed",
        error: String(err).slice(0, 200),
      }),
    );
  }
}

async function walkAndClean(
  dir: string,
  now: number,
  onRemoved: (size: number) => void,
): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      await walkAndClean(full, now, onRemoved);
      continue;
    }
    if (!INTERMEDIATE_PATTERNS.some((re) => re.test(entry))) continue;
    if (now - s.mtimeMs < MAX_INTERMEDIATE_AGE_MS) continue;
    try {
      await unlink(full);
      onRemoved(s.size);
    } catch {
      // race: someone else got to it, fine
    }
  }
}

/**
 * Periodic cleanup runs every hour and only touches files belonging to
 * jobs in a terminal state (FAILED_* / PUBLISHED / DELETED). Avoids
 * stepping on in-flight jobs whose intermediates ARE needed.
 *
 * Currently scoped narrowly — we just run runDramaCleanup() above.
 * In future we can use the DB to find terminal-state jobs and aggressively
 * wipe their entire media folders.
 */
export function startDramaCleanupInterval(
  intervalMs = 60 * 60 * 1000,
): NodeJS.Timeout {
  // Kick off one immediate run at startup, then on the interval.
  runDramaCleanup().catch(() => {});
  return setInterval(() => {
    runDramaCleanup().catch(() => {});
  }, intervalMs);
}
