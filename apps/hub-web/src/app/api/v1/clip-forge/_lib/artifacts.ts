import { stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Clip Forge — artifact presence checks for the API layer.
 *
 * `cf_raw_clips.raw_mp4_key` and `cf_finishing_variants.rendered_mp4_key` are
 * storage keys relative to `LOCAL_MEDIA_ROOT`. A populated key is NOT proof
 * the file still exists: media has been deleted from under the database
 * before, and the console happily reported 61 clips "ready" with `<video>`
 * elements pointing at 404s. Every screen that claims an artifact exists must
 * check the filesystem, so the operator can tell "rendered" from "was
 * rendered once, file is gone".
 *
 * Mirrors `apps/worker-orchestrator/src/processors/clip-forge/artifact-fs.ts`;
 * the two run in different apps with different config loaders, hence the
 * duplication.
 */

/** Minimum plausible size for a rendered artifact. Below this it is corrupt. */
const MIN_ARTIFACT_BYTES = 1024;

export interface ArtifactStat {
  present: boolean;
  size_bytes: number | null;
}

const MISSING: ArtifactStat = { present: false, size_bytes: null };

function mediaRoot(): string | null {
  const root = process.env["LOCAL_MEDIA_ROOT"];
  return root ? resolve(root) : null;
}

/**
 * Stat the artifact behind a storage key. Missing key, missing file, a
 * directory, a path escaping the media root, or a suspiciously small file all
 * report `present: false`.
 */
export async function statArtifact(
  key: string | null | undefined,
): Promise<ArtifactStat> {
  if (!key) return MISSING;
  const root = mediaRoot();
  if (!root) return MISSING;

  // Keys are written with the platform separator by the worker; normalise so
  // Windows-authored keys resolve on Linux and vice versa.
  const normalised = key.replace(/\\/g, "/");
  const abs = isAbsolute(normalised)
    ? resolve(normalised)
    : resolve(join(root, normalised));
  if (!abs.startsWith(root)) return MISSING;

  try {
    const st = await stat(abs);
    if (!st.isFile()) return MISSING;
    return { present: st.size >= MIN_ARTIFACT_BYTES, size_bytes: st.size };
  } catch {
    return MISSING;
  }
}

/**
 * Stat many keys at once, returning a key → stat map. Duplicate keys are
 * statted once.
 */
export async function statArtifacts(
  keys: Array<string | null | undefined>,
): Promise<Map<string, ArtifactStat>> {
  const unique = [...new Set(keys.filter((k): k is string => !!k))];
  const stats = await Promise.all(unique.map((k) => statArtifact(k)));
  return new Map(unique.map((k, i) => [k, stats[i]!]));
}
