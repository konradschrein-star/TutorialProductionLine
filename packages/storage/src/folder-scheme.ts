import type { StorageArtifactKind } from "@repo/db";

/**
 * The Drive folder scheme.
 *
 * Konrad browses this by hand to download a finished video and upload it to
 * YouTube, so it is optimised for a human scanning a folder list - not for a
 * machine. Newest-first ordering falls out of the YYYY-MM level; the job
 * folder name is readable without opening it.
 *
 *   Content Forge/
 *     <Channel Name>/
 *       2026-07/
 *         2026-07-28__why-cats-knock-things-over__a1b2c3d4/
 *           final_video.mp4
 *           thumbnail.jpg
 *           metadata.json
 *
 * The short job id suffix guarantees uniqueness when two jobs on the same day
 * share a title, without making the folder name unreadable.
 *
 * Everything in this file is pure.
 */

export const DEFAULT_ROOT_FOLDER_NAME = "Content Forge";
/** Leading underscore sorts tutorials away from the content channels. */
export const DEFAULT_TUTORIALS_FOLDER_NAME = "_Tutorials";
/** Sibling to Content Forge, NEVER nested inside it (Clip Forge owns it). */
export const DEFAULT_CLIPFORGE_ROOT_FOLDER_NAME = "Clip Forge";
/**
 * Comparison videos get their own top-level tree, sibling to `Content Forge/`
 * and `_Tutorials/`. They are a separate operation with a separate uploader
 * rota, so mixing them into the channel tree makes the folder a human has to
 * scan twice as long. Leading underscore keeps it grouped with `_Tutorials`.
 */
export const DEFAULT_COMPARISONS_FOLDER_NAME = "_Comparisons";
export const UNKNOWN_CHANNEL_FOLDER = "_no-channel";

/**
 * Formats whose finished artefacts live OUTSIDE the default content root.
 *
 * Keyed by `content_jobs.format`. Everything not listed here lands in
 * `Content Forge/<Channel>/YYYY-MM/...` exactly as before — adding a format to
 * this map is the only thing needed to give it its own tree.
 *
 * Values are the DEFAULT names; `DriveConfig.formatRootFolderNames` (built
 * from env in config.ts) can override any of them without a code change.
 */
export const DEFAULT_FORMAT_ROOT_FOLDERS: Readonly<Record<string, string>> =
  Object.freeze({
    TECH_COMPARISON: DEFAULT_COMPARISONS_FOLDER_NAME,
  });

/**
 * Which Drive root a given content format belongs under.
 *
 * `format` is nullable because `content_jobs.format` is nullable; a null or
 * unrecognised format falls back to the content root rather than inventing a
 * folder — an unknown format must never silently vanish into a new tree.
 */
export function rootFolderForFormat(
  format: string | null | undefined,
  defaultRootFolderName: string = DEFAULT_ROOT_FOLDER_NAME,
  overrides: Readonly<Record<string, string>> = DEFAULT_FORMAT_ROOT_FOLDERS,
): string {
  if (typeof format !== "string" || format.trim() === "") {
    return defaultRootFolderName;
  }
  return overrides[format.trim().toUpperCase()] ?? defaultRootFolderName;
}

/** Filenames are fixed per kind - predictable for the distribution engine. */
export const ARTIFACT_FILENAMES: Record<StorageArtifactKind, string> = {
  final_video: "final_video.mp4",
  thumbnail: "thumbnail.jpg",
  metadata: "metadata.json",
  transcript: "transcript.json",
  subtitles: "subtitles.srt",
  raw_recording: "raw_recording.mp4",
  // Plain text on purpose: the VA copy-pastes out of it. metadata.json is for
  // machines, upload.txt is for the person doing the upload.
  upload_sheet: "upload.txt",
};

/**
 * Normalise a language code for use as a folder segment. English (or null)
 * means "the original", which lives at the leaf root — NOT in an en/ subfolder.
 * Everything else becomes a lowercase ISO-639-1(-region) segment.
 */
export function languageSegment(
  languageCode: string | null | undefined,
): string | null {
  if (languageCode === null || languageCode === undefined) return null;
  const code = languageCode.trim().toLowerCase();
  if (code === "" || code === "en" || code === "en-us" || code === "en-gb") {
    return null;
  }
  // Keep it filesystem-boring: letters, digits, single hyphen (e.g. pt-br).
  const cleaned = code.replace(/[^a-z0-9-]+/g, "").replace(/-+/g, "-");
  return cleaned === "" ? null : cleaned;
}

/** Unicode combining marks, stripped after NFKD so "uber" survives an umlaut. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Slugify a title for use as part of a folder name.
 *
 * Drive itself tolerates almost anything, but these names get typed, pasted
 * into shell commands and synced to local disks, so we keep them boring:
 * lowercase ascii, hyphens, nothing else.
 */
export function slugifyTitle(title: string, maxLength = 60): string {
  const slug = title
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug === "") return "untitled";
  if (slug.length <= maxLength) return slug;

  // Cut on a word boundary when there is one reasonably close to the limit,
  // so we get "why-cats-knock" not "why-cats-knoc".
  const cut = slug.slice(0, maxLength);
  const lastHyphen = cut.lastIndexOf("-");
  const trimmed = lastHyphen > maxLength * 0.6 ? cut.slice(0, lastHyphen) : cut;
  return trimmed.replace(/-+$/, "");
}

/**
 * Sanitise a channel name into a folder name. Unlike the job slug we keep the
 * original casing and spaces - the channel level is the one a human reads
 * most, and "Casually Explained" beats "casually-explained".
 */
export function sanitizeChannelFolder(name: string | null | undefined): string {
  if (name === null || name === undefined) return UNKNOWN_CHANNEL_FOLDER;
  const cleaned = name
    // Drive shows "/" as a path separator in some clients; strip path-ish chars.
    .replace(/[/\\<>:"|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned === "" ? UNKNOWN_CHANNEL_FOLDER : cleaned.slice(0, 100);
}

/** `YYYY-MM` in UTC. UTC on purpose: workers and the VPS are not in one zone. */
export function monthFolder(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** `YYYY-MM-DD` in UTC. */
export function dayStamp(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${monthFolder(date)}-${d}`;
}

export function shortJobId(jobId: string): string {
  return jobId.replace(/-/g, "").slice(0, 8);
}

export interface JobFolderInput {
  jobId: string;
  title: string | null | undefined;
  channelName: string | null | undefined;
  /** When the job finished. Falls back to created_at at the call site. */
  completedAt: Date;
  rootFolderName?: string;
  /**
   * ISO-639-1 language code. null / "en" keeps the artefact at the leaf root
   * (the English original). Anything else appends a language subfolder.
   */
  languageCode?: string | null;
  /**
   * For a translated variant, the parent (English) job id whose leaf folder the
   * variant lives under. When set, the leaf is derived from THIS job's id/title
   * so variants group under the original's folder name.
   */
  sourceJobId?: string | null;
  sourceTitle?: string | null;
  /**
   * `content_jobs.format`. Formats listed in `formatRootFolderNames` (default
   * `DEFAULT_FORMAT_ROOT_FOLDERS`) get their own top-level tree instead of the
   * content root — TECH_COMPARISON lands in `_Comparisons/`.
   */
  format?: string | null;
  /** Per-format root overrides; defaults to `DEFAULT_FORMAT_ROOT_FOLDERS`. */
  formatRootFolderNames?: Readonly<Record<string, string>>;
}

export interface FolderPlan {
  /** Folder names from the Drive root downwards, in order. */
  segments: string[];
  /** `a/b/c` - human-readable, stored on the artefact row for display. */
  path: string;
}

/**
 * Build the folder chain for a content job. Returns names only; resolving them
 * to Drive folder ids (and creating them) is the client's job.
 *
 * Language variants: the English original stays at the leaf root; a translated
 * variant appends one `<lang>/` segment. The leaf folder itself always uses the
 * *original* job's id/title slug, so a title's variants group under one name.
 *
 * Format routing: a format listed in `formatRootFolderNames` replaces the root
 * segment (TECH_COMPARISON -> `_Comparisons/`). Everything below the root —
 * channel, month, leaf, language — is identical, so the uploader VA's habits
 * and any future Drive-pulling YouTube uploader work unchanged in both trees.
 */
export function planJobFolder(input: JobFolderInput): FolderPlan {
  const root = rootFolderForFormat(
    input.format,
    input.rootFolderName ?? DEFAULT_ROOT_FOLDER_NAME,
    input.formatRootFolderNames ?? DEFAULT_FORMAT_ROOT_FOLDERS,
  );
  // The leaf identifies the ORIGINAL job so variants share one folder name.
  const leafJobId = input.sourceJobId ?? input.jobId;
  const leafTitle =
    input.sourceJobId != null
      ? (input.sourceTitle ?? input.title)
      : input.title;
  const jobFolder = [
    dayStamp(input.completedAt),
    slugifyTitle(leafTitle ?? ""),
    shortJobId(leafJobId),
  ].join("__");
  const segments = [
    root,
    sanitizeChannelFolder(input.channelName),
    monthFolder(input.completedAt),
    jobFolder,
  ];
  const lang = languageSegment(input.languageCode);
  if (lang !== null) segments.push(lang);
  return { segments, path: segments.join("/") };
}

export interface TutorialFolderInput {
  jobId: string;
  title: string | null | undefined;
  channelName: string | null | undefined;
  completedAt: Date;
  tutorialsFolderName?: string;
}

/**
 * Tutorials get their own top-level tree (`_Tutorials/<Channel>/YYYY-MM/leaf`),
 * because the tutorial operation is separate from Content Forge (D7).
 */
export function planTutorialFolder(input: TutorialFolderInput): FolderPlan {
  const root = input.tutorialsFolderName ?? DEFAULT_TUTORIALS_FOLDER_NAME;
  const jobFolder = [
    dayStamp(input.completedAt),
    slugifyTitle(input.title ?? ""),
    shortJobId(input.jobId),
  ].join("__");
  const segments = [
    root,
    sanitizeChannelFolder(input.channelName),
    monthFolder(input.completedAt),
    jobFolder,
  ];
  return { segments, path: segments.join("/") };
}

/**
 * Subfolder holding the raw screen recording, split out of the leaf.
 *
 * ## Why the archive is separated
 *
 * `raw_recording` is 83% of all bytes delivered (59 of 71 GB) and exists for
 * the laptop TRANSLATION pipeline, not for the person publishing the video.
 * Sitting next to `final_video.mp4` in the same folder it did active harm: the
 * leaf held two mp4s, one of them much larger, and "which mp4 do I upload?"
 * became a question a VA had to ask — with the wrong answer being a raw,
 * unedited screen capture published to the channel.
 *
 * One level down rather than a separate root, deliberately: the translation
 * pipeline consumes the raw recording TOGETHER WITH the transcript, so they
 * must stay in one place a single job folder can be handed off.
 *
 * Existing uploads are not moved. This changes where NEW raw recordings land.
 */
export const TUTORIAL_ARCHIVE_FOLDER_NAME = "_raw";

/**
 * The archive folder for a tutorial: its normal leaf plus `_raw/`.
 *
 * Takes the ALREADY-PLANNED leaf rather than re-deriving it, so the archive can
 * never drift into a different job folder than the video it belongs to.
 */
export function planTutorialArchiveFolder(leaf: FolderPlan): FolderPlan {
  const segments = [...leaf.segments, TUTORIAL_ARCHIVE_FOLDER_NAME];
  return { segments, path: segments.join("/") };
}

export interface ClipForgeFolderInput {
  clipId: string;
  slug: string | null | undefined;
  ownerName: string | null | undefined;
  completedAt: Date;
  rootFolderName?: string;
}

/**
 * Clip Forge lives in a WHOLLY SEPARATE root (`Clip Forge/`), never nested
 * inside Content Forge. Its distribution logic is owned by the Clip Forge
 * agent; this just gives it a consistent folder layout to target.
 */
export function planClipForgeFolder(input: ClipForgeFolderInput): FolderPlan {
  const root = input.rootFolderName ?? DEFAULT_CLIPFORGE_ROOT_FOLDER_NAME;
  const leaf = [
    dayStamp(input.completedAt),
    slugifyTitle(input.slug ?? ""),
    shortJobId(input.clipId),
  ].join("__");
  const segments = [
    root,
    sanitizeChannelFolder(input.ownerName),
    monthFolder(input.completedAt),
    leaf,
  ];
  return { segments, path: segments.join("/") };
}

/**
 * The v1 metadata sidecar (schema_version: 1). Kept for readers of already
 * uploaded files. New uploads use v2.
 */
export interface ArtifactMetadataSidecar {
  content_forge_job_id: string;
  title: string | null;
  description: string | null;
  format: string | null;
  channel_id: string | null;
  channel_name: string | null;
  render_completed_at: string | null;
  duration_seconds: number | null;
  size_bytes: number | null;
  sha256: string | null;
  vps_path: string;
  generated_at: string;
  schema_version: 1;
}

export function buildMetadataSidecar(
  data: Omit<ArtifactMetadataSidecar, "generated_at" | "schema_version">,
  now: Date = new Date(),
): ArtifactMetadataSidecar {
  return { ...data, generated_at: now.toISOString(), schema_version: 1 };
}

/**
 * Per-file integrity entry inside the v2 sidecar. Turns the folder into a
 * self-verifying manifest: "is this complete and intact?" answerable without
 * the DB.
 */
export interface SidecarFileEntry {
  name: string;
  kind: StorageArtifactKind;
  bytes: number | null;
  sha256: string | null;
  drive_file_id: string | null;
}

/**
 * The v2 metadata sidecar (schema_version: 2).
 *
 * STANDING RULE: every added field is nullable and a null means "we do not
 * know". Nothing here is estimated or derived-to-look-measured — a fabricated
 * value poisons the operational dataset this archive exists to build
 * (feedback-no-synthetic-fallbacks). Fields with no real source are simply
 * left null (or omitted by the caller), never invented.
 */
export interface ArtifactMetadataSidecarV2 {
  schema_version: 2;
  content_forge_job_id: string;
  owner_kind: string;
  // content shape
  title: string | null;
  description: string | null;
  format: string | null;
  channel_id: string | null;
  channel_name: string | null;
  language: string | null;
  /** Parent (original) job id when this is a translated variant. */
  is_translation_of: string | null;
  duration_seconds: number | null;
  size_bytes: number | null;
  sha256: string | null;
  word_count: number | null;
  // pointers to sibling documents (never the transcript body itself)
  transcript_file: string | null;
  subtitles_file: string | null;
  transcript_language: string | null;
  raw_recording_file: string | null;
  recording_duration_s: number | null;
  // provenance (all nullable)
  render_engine: string | null;
  script_provider: string | null;
  script_model: string | null;
  tts_provider: string | null;
  tts_voice: string | null;
  pipeline_git_sha: string | null;
  // lifecycle
  render_completed_at: string | null;
  published_at: string | null;
  youtube_video_id: string | null;
  youtube_url: string | null;
  /** YouTube tags. null = never generated; [] = generated and genuinely empty. */
  tags: string[] | null;
  // integrity
  files: SidecarFileEntry[];
  vps_path: string;
  generated_at: string;
}

export type MetadataSidecarV2Input = Omit<
  ArtifactMetadataSidecarV2,
  "schema_version" | "generated_at"
>;

/** Every optional field defaults to null — never to a fabricated value. */
const V2_NULL_DEFAULTS: Omit<
  MetadataSidecarV2Input,
  "content_forge_job_id" | "owner_kind" | "vps_path" | "files"
> = {
  title: null,
  description: null,
  format: null,
  channel_id: null,
  channel_name: null,
  language: null,
  is_translation_of: null,
  duration_seconds: null,
  size_bytes: null,
  sha256: null,
  word_count: null,
  transcript_file: null,
  subtitles_file: null,
  transcript_language: null,
  raw_recording_file: null,
  recording_duration_s: null,
  render_engine: null,
  script_provider: null,
  script_model: null,
  tts_provider: null,
  tts_voice: null,
  pipeline_git_sha: null,
  render_completed_at: null,
  published_at: null,
  youtube_video_id: null,
  youtube_url: null,
  tags: null,
};

export function buildMetadataSidecarV2(
  data: Partial<MetadataSidecarV2Input> &
    Pick<
      MetadataSidecarV2Input,
      "content_forge_job_id" | "owner_kind" | "vps_path"
    >,
  now: Date = new Date(),
): ArtifactMetadataSidecarV2 {
  return {
    schema_version: 2,
    ...V2_NULL_DEFAULTS,
    files: [],
    ...data,
    generated_at: now.toISOString(),
  };
}

// ── Upload sheet ─────────────────────────────────────────────────────────────

export interface UploadSheetInput {
  title: string | null;
  description: string | null;
  tags: string[] | null;
  channelName: string | null;
  language: string | null;
  videoFilename: string;
  thumbnailFilename: string | null;
  durationSeconds: number | null;
  jobId: string;
}

/** "1h 04m 12s" / "6m 30s" / "48s" — how a person says a duration. */
function humanDuration(totalSeconds: number | null): string {
  if (
    totalSeconds === null ||
    !Number.isFinite(totalSeconds) ||
    totalSeconds <= 0
  ) {
    return "unknown";
  }
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/**
 * The plain-text sheet a VA reads in Google Drive to publish a video.
 *
 * ## Why this exists
 *
 * A VA opening a finished tutorial's Drive folder used to find the video, the
 * raw recording, a transcript — and a LOWERCASE SLUG as the only title. There
 * was no description and no tags anywhere in the schema. So "open Drive and
 * upload" was not an achievable instruction: the VA had to come back into the
 * app for the title alone, which is exactly the manual step the pipeline is
 * supposed to remove.
 *
 * ## Why plain text
 *
 * `metadata.json` already exists and is for machines. This is for a person with
 * the YouTube upload form open in the next tab: labelled blocks they can select
 * and copy, in the order the form asks for them.
 *
 * ## Why missing fields are stated, not filled
 *
 * A null description prints "(NOT GENERATED …)", never a plausible sentence.
 * An invented description is a silent wrong answer that gets published under
 * the owner's channel; a visible gap costs thirty seconds and is obviously a
 * gap. Same rule as the sidecar's nulls.
 */
export function buildUploadSheet(
  input: UploadSheetInput,
  now: Date = new Date(),
): string {
  const missing: string[] = [];
  const title = input.title?.trim();
  if (!title) missing.push("title");
  const description = input.description?.trim();
  if (!description) missing.push("description");
  const tags = input.tags?.filter((t) => t.trim() !== "") ?? null;
  if (!tags || tags.length === 0) missing.push("tags");
  if (!input.thumbnailFilename) missing.push("thumbnail");

  const lines: string[] = [
    "UPLOAD SHEET",
    "Everything below is what you need to publish this video.",
    "Copy each block into the matching field on YouTube.",
    "",
    `Channel:    ${input.channelName ?? "(unassigned — ask before publishing)"}`,
    `Video file: ${input.videoFilename}`,
    `Thumbnail:  ${input.thumbnailFilename ?? "(NOT GENERATED — upload without one or regenerate in the app)"}`,
    `Duration:   ${humanDuration(input.durationSeconds)}`,
    `Language:   ${input.language ?? "en"}`,
    "",
    "─".repeat(60),
    "TITLE",
    "─".repeat(60),
    title ||
      "(NOT GENERATED — ask for it to be regenerated; do not invent one)",
    "",
    "─".repeat(60),
    "DESCRIPTION",
    "─".repeat(60),
    description || "(NOT GENERATED — do not invent one, regenerate in the app)",
    "",
    "─".repeat(60),
    "TAGS (comma-separated, paste as-is)",
    "─".repeat(60),
    tags && tags.length > 0
      ? tags.join(", ")
      : "(NOT GENERATED — ask for them to be regenerated; do not invent them)",
    "",
  ];

  if (missing.length > 0) {
    lines.push(
      "─".repeat(60),
      "⚠ INCOMPLETE",
      "─".repeat(60),
      `Missing: ${missing.join(", ")}.`,
      "These were not produced by the pipeline. They are deliberately left",
      "blank rather than guessed.",
      "",
      "There is NO self-serve regenerate for description/tags yet — they are",
      "written once, alongside the script. Ask for the job to be re-run rather",
      "than writing your own: an invented description is published under the",
      "channel's name and nobody can tell it was a guess.",
      "",
    );
  }

  lines.push(
    "─".repeat(60),
    `Content Forge job ${input.jobId}`,
    `Sheet generated ${now.toISOString()}`,
  );

  return lines.join("\n");
}
