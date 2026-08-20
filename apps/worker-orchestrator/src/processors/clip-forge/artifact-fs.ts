import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { getConfig } from "@repo/config";

/**
 * Clip Forge — artifact presence check.
 *
 * `cf_raw_clips.raw_mp4_key` / `cf_finishing_variants.rendered_mp4_key` are
 * storage keys relative to `LOCAL_MEDIA_ROOT`. The DB row asserting a key is
 * NOT proof the file is still on disk: media has been wiped from under the
 * database before (2026-07 incident), which left 61 raw clips permanently
 * `ready` with keys pointing at nothing. Because raw-render's idempotency
 * guard trusted the row, those clips could never be rebuilt — the pipeline
 * looked "done" while producing zero playable output.
 *
 * Anything that treats a stored key as "already rendered" must go through
 * here so the filesystem, not the row, is the authority.
 */

/** Minimum plausible size for a rendered artifact. Below this it is corrupt. */
const MIN_ARTIFACT_BYTES = 1024;

export interface ArtifactStat {
  present: boolean;
  size_bytes: number | null;
}

/** Absolute path for a storage key. Absolute keys are returned unchanged. */
export function artifactPath(key: string): string {
  if (isAbsolute(key)) return key;
  return join(getConfig().LOCAL_MEDIA_ROOT, key);
}

/**
 * Stat the artifact behind a storage key.
 *
 * A null/empty key, a missing file, a directory, or a suspiciously small file
 * all report `present: false` — the caller should rebuild.
 */
export async function statArtifact(
  key: string | null | undefined,
): Promise<ArtifactStat> {
  if (!key) return { present: false, size_bytes: null };
  try {
    const st = await stat(artifactPath(key));
    if (!st.isFile()) return { present: false, size_bytes: null };
    return { present: st.size >= MIN_ARTIFACT_BYTES, size_bytes: st.size };
  } catch {
    return { present: false, size_bytes: null };
  }
}

/** Convenience boolean form of {@link statArtifact}. */
export async function artifactPresent(
  key: string | null | undefined,
): Promise<boolean> {
  return (await statArtifact(key)).present;
}
