import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const LOCAL_MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "/opt/content-forge/media";

const TUTORIAL_MEDIA_BASE = join(LOCAL_MEDIA_ROOT, "tutorial");

const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 h

// NOTE: tts.mp3 is NOT an intermediate. It is the final narration artefact
// (generate.ts writes it, persists it as tutorial_jobs.audio_path, and sets
// status READY_TO_RECORD). READY_TO_RECORD is a HUMAN gate — the VA records
// their screen against that audio on their own schedule, which can easily be
// longer than 48 h across a weekend. Deleting it stranded the job: the DB still
// reported a valid audio_path, the Studio still offered the job, and splice
// failed later with a confusing ENOENT. There is no regeneration path.
// Only genuinely disposable per-chunk artefacts belong in this list.
const INTERMEDIATE_PATTERNS = [/^tts-chunk-\d+\.mp3$/, /^tts-concat\.txt$/];

/**
 * Reclaim tutorial intermediate files older than 48 h.
 *
 * Targets: ${LOCAL_MEDIA_ROOT}/tutorial/* — per-job subdirectories.
 * Removes TTS chunk files and concat lists left behind by interrupted runs.
 * Final outputs (final.mp4) are intentionally excluded.
 */
export async function runTutorialCleanup(): Promise<void> {
  let removed = 0;
  let bytesFreed = 0;
  try {
    const jobs = await readdir(TUTORIAL_MEDIA_BASE).catch(() => []);
    const now = Date.now();
    for (const jobDir of jobs) {
      const jobPath = join(TUTORIAL_MEDIA_BASE, jobDir);
      await walkAndClean(jobPath, now, (size) => {
        removed += 1;
        bytesFreed += size;
      });
    }
    if (removed > 0) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "[tutorial-cleanup] Reclaimed intermediate files",
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
        message: "[tutorial-cleanup] Scan failed",
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
    if (now - s.mtimeMs < MAX_AGE_MS) continue;
    try {
      await unlink(full);
      onRemoved(s.size);
    } catch {
      // race: someone else got to it, fine
    }
  }
}

/**
 * Start periodic tutorial cleanup interval.
 * Runs once at startup + every hour thereafter.
 */
export function startTutorialCleanupInterval(
  intervalMs = 60 * 60 * 1000,
): NodeJS.Timeout {
  runTutorialCleanup().catch(() => {});
  return setInterval(() => {
    runTutorialCleanup().catch(() => {});
  }, intervalMs);
}
