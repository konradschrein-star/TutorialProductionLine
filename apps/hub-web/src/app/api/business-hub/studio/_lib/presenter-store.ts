/**
 * BUSINESS_PLAN_HUB Presenter Studio — filesystem access to the pose library.
 *
 * The Studio is the only thing in the product that WRITES
 * `media/style-assets/presenter/poses/poses.json`. Everything else reads it and
 * fails closed if a pose is uncalibrated (design §8 rule 2). This module is the
 * single seam between the Studio's HTTP routes and that directory, so path
 * resolution, traversal defence, validation and the atomic write all live in
 * one place.
 *
 * FAIL-CLOSED: every function here throws {@link PresenterStoreError} with a
 * diagnostic naming the path and what to do. Nothing returns an empty manifest,
 * a default root, or a partially-parsed pose. A half-calibrated pose is never
 * persisted — see {@link writePoseManifest}.
 *
 * `media/` is gitignored but present on disk, so the assets can never be
 * imported as modules; they are read at request time through these helpers.
 */

import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  rename,
  stat,
  mkdir,
  readdir,
} from "node:fs/promises";
import path from "node:path";

import {
  PoseManifestSchema,
  CalibratedPoseSchema,
  type Pose,
  type PoseManifest,
} from "@repo/contracts";

/**
 * Error type for every failure in this module. Carries an HTTP status so the
 * route handlers can translate without re-deriving it from the message.
 */
export class PresenterStoreError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PresenterStoreError";
    this.status = status;
  }
}

/** File name of the pose manifest inside `poses/`. */
const POSES_JSON = "poses.json";

/** Backup written immediately before every successful save. */
const POSES_JSON_BACKUP = "poses.json.bak";

/** Audio container extensions the sample-narration scrubber accepts. */
export const NARRATION_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
] as const;

/**
 * Absolute path of `media/style-assets/presenter/`.
 *
 * Resolution order:
 *  1. `BUSINESS_HUB_PRESENTER_ROOT` — explicit override, for a box where the
 *     presenter library is not under the media root.
 *  2. `LOCAL_MEDIA_ROOT/style-assets/presenter` — the real layout on both the
 *     Windows dev box (`LOCAL_MEDIA_ROOT` points at the repo's `media/`) and
 *     the VPS (`/opt/content-forge/media`, which IS the repo's `media/`).
 *
 * There is deliberately no third fallback: guessing a media root would let the
 * Studio silently author a `poses.json` that no renderer ever reads.
 *
 * @throws PresenterStoreError if neither variable is set.
 */
export function resolvePresenterRoot(): string {
  const override = process.env["BUSINESS_HUB_PRESENTER_ROOT"];
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim());
  }

  const mediaRoot = process.env["LOCAL_MEDIA_ROOT"];
  if (!mediaRoot || mediaRoot.trim().length === 0) {
    throw new PresenterStoreError(
      "Presenter library location is unknown: neither BUSINESS_HUB_PRESENTER_ROOT nor " +
        "LOCAL_MEDIA_ROOT is set in this process's environment. The Presenter Studio " +
        "reads and writes media/style-assets/presenter/, and will not guess where that is. " +
        "Set LOCAL_MEDIA_ROOT to the repo's media/ directory (dev) or /opt/content-forge/media (VPS).",
      500,
    );
  }

  return path.resolve(path.join(mediaRoot.trim(), "style-assets", "presenter"));
}

/** Absolute path of `presenter/poses/`. */
export function posesDir(): string {
  return path.join(resolvePresenterRoot(), "poses");
}

/** Absolute path of `presenter/poses/poses.json`. */
export function posesJsonPath(): string {
  return path.join(posesDir(), POSES_JSON);
}

/** Absolute path of `presenter/mark/`. */
export function markDir(): string {
  return path.join(resolvePresenterRoot(), "mark");
}

/**
 * Absolute path of `presenter/sample-narration/` — where an operator drops the
 * narration clips the head-pump scrubber plays. Not created here; see
 * {@link ensureSampleNarrationDir}.
 */
export function sampleNarrationDir(): string {
  return path.join(resolvePresenterRoot(), "sample-narration");
}

/**
 * Create `presenter/sample-narration/` if it does not exist.
 *
 * @returns Its absolute path.
 * @throws PresenterStoreError if the directory cannot be created.
 */
export async function ensureSampleNarrationDir(): Promise<string> {
  const dir = sampleNarrationDir();
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    throw new PresenterStoreError(
      `Could not create the sample-narration directory at "${dir}": ` +
        `${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
  return dir;
}

/**
 * Content revision of a manifest, used for optimistic concurrency.
 *
 * Two operators calibrating at once would otherwise last-write-wins each other's
 * poses. The client echoes back the revision it loaded; {@link writePoseManifest}
 * rejects the save if the file moved underneath it.
 *
 * @param rawJson The exact bytes read from (or about to be written to) disk.
 */
export function manifestRevision(rawJson: string): string {
  return createHash("sha256")
    .update(rawJson, "utf8")
    .digest("hex")
    .slice(0, 16);
}

export interface LoadedManifest {
  poses: PoseManifest;
  /** Revision of the bytes on disk at read time. */
  revision: string;
  /** Absolute path the manifest was read from — surfaced in the UI. */
  path: string;
}

/**
 * Read and validate `poses.json`.
 *
 * @throws PresenterStoreError if the file is missing, is not valid JSON, or does
 *         not satisfy `PoseManifestSchema` (duplicate slugs, missing fields, a
 *         partially-authored hitbox set). A malformed manifest is never
 *         "repaired" — the operator is shown exactly which entry is wrong.
 */
export async function readPoseManifest(): Promise<LoadedManifest> {
  const filePath = posesJsonPath();

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw new PresenterStoreError(
      `Pose manifest not found at "${filePath}". The Presenter Studio cannot author ` +
        "hitboxes for a library it cannot see. Check LOCAL_MEDIA_ROOT / " +
        "BUSINESS_HUB_PRESENTER_ROOT and that media/style-assets/presenter/poses/ exists " +
        `on this machine. (${error instanceof Error ? error.message : String(error)})`,
      404,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new PresenterStoreError(
      `"${filePath}" is not valid JSON: ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        "Refusing to overwrite a file whose current contents cannot be read — " +
        "fix or restore it by hand first (a poses.json.bak may be alongside it).",
      500,
    );
  }

  const result = PoseManifestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new PresenterStoreError(
      `"${filePath}" does not match the pose manifest contract: ${formatIssues(result.error.issues)}`,
      500,
    );
  }

  return {
    poses: result.data,
    revision: manifestRevision(raw),
    path: filePath,
  };
}

/**
 * Validate a candidate manifest and write it atomically.
 *
 * The write is gated on three checks, in order, and any failure means nothing
 * touches the disk:
 *
 *  1. `PoseManifestSchema` — shape, unique slugs, unique files. A pose carrying
 *     a PARTIAL hitbox set fails here, because `hitboxes` is either absent or
 *     complete; there is no half-filled form of it.
 *  2. `CalibratedPoseSchema` for every pose claiming `anchor_status:
 *     "calibrated"` — this is the "reject a save that leaves a required hitbox
 *     unset" rule. Flipping the flag without authoring all six hitboxes is
 *     exactly the half-calibrated state that must never reach a render.
 *  3. Every `file` must exist in `poses/`. A manifest entry pointing at a PNG
 *     that is not there renders an empty presenter layer.
 *
 * Then: previous contents are copied to `poses.json.bak`, the new contents are
 * written to a temp file in the same directory and `rename()`d over the target,
 * so a reader never observes a truncated manifest.
 *
 * @param poses The full manifest to persist (not a patch — the Studio always
 *        sends every entry, so a dropped pose is visible in review).
 * @param expectedRevision Revision the client loaded. Pass `null` only for a
 *        deliberate force-overwrite; anything else is a concurrency bug.
 * @returns The revision of the bytes now on disk.
 * @throws PresenterStoreError (400 on validation, 409 on a stale revision,
 *         500 on an I/O failure).
 */
export async function writePoseManifest(
  poses: unknown,
  expectedRevision: string | null,
): Promise<{ revision: string; path: string }> {
  const shape = PoseManifestSchema.safeParse(poses);
  if (!shape.success) {
    throw new PresenterStoreError(
      `Refusing to save: the manifest does not satisfy the pose contract. ${formatIssues(shape.error.issues)}`,
      400,
    );
  }

  for (const [index, pose] of shape.data.entries()) {
    if (pose.anchor_status !== "calibrated") continue;
    const calibrated = CalibratedPoseSchema.safeParse(pose);
    if (!calibrated.success) {
      throw new PresenterStoreError(
        `Refusing to save pose "${pose.slug}" (index ${index}): it is marked ` +
          "calibrated but does not carry a complete hitbox set. A half-calibrated pose " +
          "would be placed by guesswork at render time, so it is rejected here instead. " +
          `Missing or invalid: ${formatIssues(calibrated.error.issues)}`,
        400,
      );
    }
  }

  const dir = posesDir();
  for (const pose of shape.data) {
    const abs = safeJoinInside(dir, pose.file);
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(abs);
    } catch {
      throw new PresenterStoreError(
        `Refusing to save: pose "${pose.slug}" names file "${pose.file}", which does not ` +
          `exist in "${dir}". A manifest entry with no PNG renders an empty presenter layer.`,
        400,
      );
    }
    if (!fileStat.isFile()) {
      throw new PresenterStoreError(
        `Refusing to save: "${pose.file}" (pose "${pose.slug}") is not a regular file.`,
        400,
      );
    }
  }

  const target = posesJsonPath();

  let previousRaw: string | null = null;
  try {
    previousRaw = await readFile(target, "utf8");
  } catch {
    previousRaw = null;
  }

  if (expectedRevision !== null) {
    if (previousRaw === null) {
      throw new PresenterStoreError(
        `Refusing to save: "${target}" no longer exists, but the Studio was editing a ` +
          "manifest loaded from it. Reload the Studio before saving.",
        409,
      );
    }
    const currentRevision = manifestRevision(previousRaw);
    if (currentRevision !== expectedRevision) {
      throw new PresenterStoreError(
        `Refusing to save: poses.json changed on disk since it was loaded ` +
          `(loaded revision ${expectedRevision}, current ${currentRevision}). Another session ` +
          "or a script wrote it. Reload the Studio and re-apply your calibration so the other " +
          "edit is not silently discarded.",
        409,
      );
    }
  }

  // Two trailing newline-terminated spaces of formatting keep the file readable
  // in review; it is a hand-inspected asset, not a blob.
  const nextRaw = `${JSON.stringify(shape.data, null, 2)}\n`;
  const tmp = path.join(dir, `.poses.json.${process.pid}.${Date.now()}.tmp`);

  try {
    if (previousRaw !== null) {
      await writeFile(path.join(dir, POSES_JSON_BACKUP), previousRaw, "utf8");
    }
    await writeFile(tmp, nextRaw, "utf8");
    await rename(tmp, target);
  } catch (error) {
    throw new PresenterStoreError(
      `Failed to write "${target}": ${error instanceof Error ? error.message : String(error)}. ` +
        `The previous manifest is intact (a copy is at "${path.join(dir, POSES_JSON_BACKUP)}").`,
      500,
    );
  }

  return { revision: manifestRevision(nextRaw), path: target };
}

/**
 * Resolve a pose PNG by file name, refusing anything not named by the manifest.
 *
 * Two gates rather than one: the name must resolve inside `poses/` (traversal),
 * AND it must be a `file` some manifest entry declares (so the route cannot be
 * used to enumerate or exfiltrate unrelated files that happen to live there).
 *
 * @throws PresenterStoreError 400 on a traversal attempt, 404 if no manifest
 *         entry names the file or the file is absent.
 */
export async function resolvePoseImage(
  fileName: string,
): Promise<{ absPath: string; pose: Pose }> {
  const { poses } = await readPoseManifest();
  const pose = poses.find((p) => p.file === fileName);
  if (!pose) {
    throw new PresenterStoreError(
      `No pose in poses.json declares file "${fileName}".`,
      404,
    );
  }

  const absPath = safeJoinInside(posesDir(), fileName);
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(absPath);
  } catch {
    throw new PresenterStoreError(
      `Pose "${pose.slug}" declares "${fileName}" but it is not on disk at "${absPath}".`,
      404,
    );
  }
  if (!fileStat.isFile()) {
    throw new PresenterStoreError(`"${absPath}" is not a regular file.`, 404);
  }

  return { absPath, pose };
}

/**
 * List the audio files in `presenter/sample-narration/`.
 *
 * Returns an empty array when the directory is absent or empty — that is a real
 * state the UI must show honestly ("drop a narration clip here"), not an error,
 * and NOT something to paper over with a generated tone. The head pump is only
 * ever driven by real narration.
 *
 * @throws PresenterStoreError if the directory exists but cannot be read.
 */
export async function listSampleNarration(): Promise<
  Array<{ file: string; sizeBytes: number; modifiedAt: string }>
> {
  const dir = sampleNarrationDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "ENOENT") return [];
    throw new PresenterStoreError(
      `Could not read "${dir}": ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }

  const out: Array<{ file: string; sizeBytes: number; modifiedAt: string }> =
    [];
  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!(NARRATION_EXTENSIONS as readonly string[]).includes(ext)) continue;
    const abs = path.join(dir, entry);
    const fileStat = await stat(abs);
    if (!fileStat.isFile()) continue;
    out.push({
      file: entry,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    });
  }
  out.sort((a, b) => a.file.localeCompare(b.file));
  return out;
}

/**
 * Resolve a sample-narration file name to an absolute path.
 *
 * @throws PresenterStoreError 400 for traversal or an unsupported extension,
 *         404 when the file is absent.
 */
export async function resolveSampleNarration(
  fileName: string,
): Promise<string> {
  const ext = path.extname(fileName).toLowerCase();
  if (!(NARRATION_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new PresenterStoreError(
      `"${fileName}" is not a supported narration container. Allowed: ${NARRATION_EXTENSIONS.join(", ")}.`,
      400,
    );
  }
  const abs = safeJoinInside(sampleNarrationDir(), fileName);
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(abs);
  } catch {
    throw new PresenterStoreError(
      `Sample narration "${fileName}" is not present at "${abs}".`,
      404,
    );
  }
  if (!fileStat.isFile()) {
    throw new PresenterStoreError(`"${abs}" is not a regular file.`, 400);
  }
  return abs;
}

/**
 * Join `name` onto `root` and prove the result stays inside `root`.
 *
 * `path.basename` alone is not enough on Windows, where `..\\x` and drive-
 * relative forms both exist; resolving and comparing with `path.sep` is.
 *
 * @throws PresenterStoreError 400 if the name escapes, is empty, or contains a
 *         path separator.
 */
export function safeJoinInside(root: string, name: string): string {
  if (name.trim().length === 0) {
    throw new PresenterStoreError("Empty file name.", 400);
  }
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new PresenterStoreError(
      `File name "${name}" may not contain a path separator.`,
      400,
    );
  }
  const rootAbs = path.resolve(root);
  const target = path.resolve(path.join(rootAbs, name));
  if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) {
    throw new PresenterStoreError(`Path traversal blocked for "${name}".`, 400);
  }
  return target;
}

/** Flatten zod issues into one line an operator can act on. */
function formatIssues(
  issues: ReadonlyArray<{ path: Array<string | number>; message: string }>,
): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}
