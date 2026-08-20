/**
 * B-Roll Selection Studio — duplicate source detection.
 *
 * ## Why this exists (the "Timeline 1 and Timeline 2 are the same video" bug)
 *
 * On the live job `bd4bfd38…` every item carried two footage candidates — one
 * `source:"user-url"` and one `source:"yt-dlp"` — with different filenames,
 * different candidate indices, and IDENTICAL bytes (same md5, same size, same
 * YouTube video, downloaded twice hours apart). The studio drew them as two
 * separate source rows, so switching a segment between "Timeline 1" and
 * "Timeline 2" changed nothing on screen or in the render, and the VA had no
 * way to know why.
 *
 * Nothing in the pipeline deduplicates candidates: `ranking-footage-collection`
 * appends the create-time upload pool AND its own yt-dlp fetch, and `add-url`
 * appends whatever is pasted. Two paths to the same video produce two rows.
 *
 * We do NOT collapse them at read time. Segments address candidates by INDEX
 * into `footageCandidates`, and the Remotion renderer indexes the same raw
 * array — reindexing on read would silently desync the studio from the render.
 * Instead we fingerprint and LABEL: duplicates keep their index and get a
 * `duplicateOfIndex` badge, and `add-url` refuses to append a source that is
 * already there. Honest and index-stable.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Bytes read from the head of a file for the content fingerprint. */
const FINGERPRINT_BYTES = 256 * 1024;

/**
 * Resolve a candidate `url` to an absolute local path, or null when it is not a
 * local file (http candidates are fingerprinted by URL instead).
 */
export function localPathForUrl(
  raw: string | undefined,
  mediaRoot: string,
): string | null {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return null;
  let path = raw.startsWith("file://") ? raw.slice("file://".length) : raw;
  // A Windows-style file:///C:/... leaves a leading slash before the drive.
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  if (!path.startsWith("/") && !/^[A-Za-z]:/.test(path)) {
    path = `${mediaRoot.replace(/\/+$/, "")}/${path}`;
  }
  return path;
}

/**
 * Content fingerprint for one candidate: `size:md5(first 256 KiB)`.
 *
 * Size alone would be suggestive; the head hash makes a collision between two
 * genuinely different clips effectively impossible, and both are cheap (one
 * stat + one 256 KiB read) so a 10-candidate block costs a few milliseconds.
 * Returns null when the file is missing or unreadable — an unknown fingerprint
 * must never be treated as "matches everything".
 */
export async function fingerprintFile(path: string): Promise<string | null> {
  try {
    const stats = await stat(path);
    if (!stats.isFile() || stats.size === 0) return null;
    const handle = await open(path, "r");
    try {
      const len = Math.min(FINGERPRINT_BYTES, stats.size);
      const buf = Buffer.alloc(len);
      await handle.read(buf, 0, len, 0);
      const hash = createHash("md5").update(buf).digest("hex");
      return `${stats.size}:${hash}`;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export interface IdentifiableCandidate {
  url?: string;
  sourceUrl?: string;
}

const FFPROBE_BIN =
  process.env["FFPROBE_PATH"] ?? process.env["FFPROBE_BIN"] ?? "ffprobe";
const PROBE_TIMEOUT_MS = 10_000;

interface ProbeableCandidate {
  url?: string;
  kind?: string;
  durationSeconds?: number;
}

/**
 * Fill in `durationSeconds` for candidates that were stored without it.
 *
 * A candidate with no known duration is not a cosmetic gap: the studio falls
 * back to the BLOCK length for that row's time scale, which makes
 * `maxStart = candDur − segmentDuration` exactly 0 — the green window on that
 * row cannot be dragged one pixel, and the row's filmstrip is scaled to the
 * wrong span. The create-time upload pool (`source:"user-url"`) routinely lands
 * candidates with no duration and no sprite, so on a real job the FIRST source
 * row was the frozen one.
 *
 * Mutates `candidates` in place (they are plain JSON objects read from the job
 * row, not persisted here). Probes run in parallel and failures are left as
 * `undefined` — an unknown duration must stay unknown, never be guessed.
 */
export async function backfillCandidateDurations(
  candidates: ProbeableCandidate[],
  mediaRoot: string,
): Promise<void> {
  await Promise.all(
    candidates.map(async (cand) => {
      if (
        typeof cand.durationSeconds === "number" &&
        cand.durationSeconds > 0
      ) {
        return;
      }
      if (cand.kind === "photo") return;
      const path = localPathForUrl(cand.url, mediaRoot);
      if (!path) return;
      try {
        const { stdout } = await execFileAsync(
          FFPROBE_BIN,
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
          ],
          { timeout: PROBE_TIMEOUT_MS },
        );
        const seconds = Number(stdout.trim());
        if (Number.isFinite(seconds) && seconds > 0) {
          cand.durationSeconds = seconds;
        }
      } catch {
        /* unreadable / not a media file — leave it unknown */
      }
    }),
  );
}

/**
 * For each candidate, the index of the EARLIER candidate holding the same
 * source, or undefined when it is unique (or cannot be determined).
 *
 * Two candidates are the same source when they share a `sourceUrl`, share a
 * `url`, or their files share a content fingerprint.
 */
export async function findDuplicateIndices(
  candidates: ReadonlyArray<IdentifiableCandidate>,
  mediaRoot: string,
): Promise<Array<number | undefined>> {
  const fingerprints = await Promise.all(
    candidates.map(async (c) => {
      const path = localPathForUrl(c.url, mediaRoot);
      return path ? await fingerprintFile(path) : null;
    }),
  );

  const seenBy = new Map<string, number>();
  const result: Array<number | undefined> = candidates.map(() => undefined);

  candidates.forEach((cand, i) => {
    const keys: string[] = [];
    if (cand.sourceUrl) keys.push(`src:${cand.sourceUrl}`);
    if (cand.url) keys.push(`url:${cand.url}`);
    const fp = fingerprints[i];
    if (fp) keys.push(`fp:${fp}`);

    let firstIdx: number | undefined;
    for (const k of keys) {
      const prev = seenBy.get(k);
      if (prev !== undefined && (firstIdx === undefined || prev < firstIdx)) {
        firstIdx = prev;
      }
    }
    if (firstIdx !== undefined) result[i] = firstIdx;
    // Register this candidate's keys against the ORIGINAL index so a third copy
    // points at the first, not at the second.
    const owner = firstIdx ?? i;
    for (const k of keys) if (!seenBy.has(k)) seenBy.set(k, owner);
  });

  return result;
}
