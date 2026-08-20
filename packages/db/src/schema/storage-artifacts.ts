import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  date,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { channels } from "./channels.js";

/**
 * Artefact kinds we are willing to push to external storage.
 *
 * DELIBERATELY SMALL. Only *finished products* go to Google Drive — never
 * temp/intermediate files (per-scene images, TTS chunks, working renders,
 * scratch dirs). Adding a kind here is a product decision, not a plumbing one.
 *
 * v2 (0053) widened this from 3 to 6: the transcript + subtitles ship so
 * videos can be translated later without re-transcribing, and tutorials
 * additionally archive their raw screen recording (tutorials only).
 */
export const STORAGE_ARTIFACT_KINDS = [
  "final_video",
  "thumbnail",
  "metadata",
  "transcript",
  "subtitles",
  "raw_recording",
  // v3 (0065): the human-facing upload.txt. A VA opening Drive must be able to
  // publish from what is in the folder, without opening the app.
  "upload_sheet",
] as const;

export type StorageArtifactKind = (typeof STORAGE_ARTIFACT_KINDS)[number];

/**
 * Which subsystem owns the job this artefact belongs to. `job_id` is NOT a
 * foreign key any more (0053 dropped the content_jobs FK) precisely because it
 * can now point at three different owner tables. `owner_kind` says which one.
 */
export const STORAGE_OWNER_KINDS = [
  "content_job",
  "tutorial_job",
  "clip_variant",
] as const;

export type StorageOwnerKind = (typeof STORAGE_OWNER_KINDS)[number];

/**
 * Upload lifecycle. `skipped` means we deliberately did not upload (e.g. the
 * local file is missing) — it is a *recorded* decision, never a silent one.
 */
export const STORAGE_UPLOAD_STATES = [
  "pending",
  "uploading",
  "uploaded",
  "failed",
  "skipped",
] as const;

export type StorageUploadState = (typeof STORAGE_UPLOAD_STATES)[number];

/**
 * One row per (job, artefact kind). Links a finished deliverable to BOTH of
 * its storage locations:
 *
 *   - `vps_path`       — the authoritative copy on the VPS (always present)
 *   - `drive_file_id`  — the additional Google Drive copy (may be absent)
 *
 * The VPS copy is primary and is NEVER moved or deleted by this subsystem.
 * Drive is an additional destination for retrieval/distribution.
 *
 * The unique index on (job_id, kind) is the idempotency backbone: re-running
 * an upload for the same artefact updates the existing row rather than
 * creating a second Drive copy.
 */
export const storageArtifacts = pgTable(
  "storage_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // NOT a foreign key: it can reference content_jobs, tutorial_jobs, or a
    // clip-forge variant, depending on owner_kind. 0053 dropped the FK.
    job_id: uuid("job_id").notNull(),
    // content_job | tutorial_job | clip_variant
    owner_kind: text("owner_kind")
      .$type<StorageOwnerKind>()
      .notNull()
      .default("content_job"),
    channel_id: uuid("channel_id").references(() => channels.id, {
      onDelete: "set null",
    }),

    kind: text("kind").$type<StorageArtifactKind>().notNull(),

    // ISO-639-1 language of this artefact. NULL / "en" = the English original
    // (which lives at the folder root, NOT in an en/ subfolder). Any other
    // value places the artefact in a language subfolder of the parent job.
    language: text("language"),
    // When this artefact is a translated variant, the ORIGINAL job whose folder
    // it belongs under. NULL for the English original.
    source_job_id: uuid("source_job_id"),

    // --- local (primary) copy -------------------------------------------
    filename: text("filename").notNull(),
    vps_path: text("vps_path").notNull(),
    bytes: bigint("bytes", { mode: "number" }),
    checksum_sha256: text("checksum_sha256"),

    // --- Google Drive (secondary) copy ----------------------------------
    drive_file_id: text("drive_file_id"),
    drive_web_link: text("drive_web_link"),
    drive_folder_id: text("drive_folder_id"),
    // Human-readable folder path, e.g.
    // "Content Forge/Casually Explained/2026-07/2026-07-28__why-cats__a1b2c3d4"
    drive_folder_path: text("drive_folder_path"),
    // Drive-reported MD5 of the uploaded bytes, compared post-upload against a
    // locally computed MD5 (Drive exposes MD5, not SHA-256). Set only once the
    // checksum has been verified; a mismatch fails the upload.
    drive_md5: text("drive_md5"),
    verified_at: timestamp("verified_at", { withTimezone: true }),

    // --- upload lifecycle ------------------------------------------------
    state: text("state")
      .$type<StorageUploadState>()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error_kind: text("error_kind"),
    error_message: text("error_message"),

    // Resumable-upload bookkeeping. A session URI survives a worker restart,
    // so a 400 MB video does not restart from byte 0.
    resumable_session_uri: text("resumable_session_uri"),
    bytes_uploaded: bigint("bytes_uploaded", { mode: "number" })
      .notNull()
      .default(0),

    first_enqueued_at: timestamp("first_enqueued_at", { withTimezone: true }),
    upload_started_at: timestamp("upload_started_at", { withTimezone: true }),
    uploaded_at: timestamp("uploaded_at", { withTimezone: true }),
    last_attempt_at: timestamp("last_attempt_at", { withTimezone: true }),

    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    jobKindUniq: uniqueIndex("storage_artifacts_job_kind_uniq").on(
      table.job_id,
      table.kind,
    ),
    stateIdx: index("storage_artifacts_state_idx").on(table.state),
    jobIdx: index("storage_artifacts_job_idx").on(table.job_id),
    driveFileIdx: index("storage_artifacts_drive_file_idx").on(
      table.drive_file_id,
    ),
  }),
);

export type StorageArtifact = typeof storageArtifacts.$inferSelect;
export type NewStorageArtifact = typeof storageArtifacts.$inferInsert;

/**
 * Per-day byte budget accounting for Drive uploads.
 *
 * Google's binding limit is 750 GB *uploaded* per day per account (there is no
 * daily request cap worth worrying about). This table tracks bytes actually
 * pushed on each UTC date so the scanner can stop — visibly, with a reason —
 * before it hits the ceiling. One shared account = one shared budget across
 * Content Forge, Tutorials, and Clip Forge, so this table is keyed on the date
 * alone, not on subsystem.
 */
export const storageDailyUsage = pgTable("storage_daily_usage", {
  // UTC calendar date, the accounting bucket.
  usage_date: date("usage_date").primaryKey(),
  bytes_uploaded: bigint("bytes_uploaded", { mode: "number" })
    .notNull()
    .default(0),
  requests: integer("requests").notNull().default(0),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type StorageDailyUsage = typeof storageDailyUsage.$inferSelect;
export type NewStorageDailyUsage = typeof storageDailyUsage.$inferInsert;
