import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type {
  TutorialUploaderAttributes,
  TutorialUploaderJob,
  TutorialUploaderReceipt,
} from "@repo/contracts";
import { tutorialJobs } from "./tutorial-jobs.js";
import { thumbnails } from "./thumbnails.js";
import { users } from "./users.js";

/**
 * One durable request per localized tutorial variant. The uploader remains a
 * separate product; this row stores only the provider-neutral wire identity
 * and Tutorial Studio's projection of the latest receipt.
 */
export const tutorialUploadDispatches = pgTable(
  "tutorial_upload_dispatches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tutorial_job_id: uuid("tutorial_job_id")
      .notNull()
      .references(() => tutorialJobs.id, { onDelete: "cascade" }),
    exchange_job_id: uuid("exchange_job_id").notNull().defaultRandom(),
    revision: integer("revision").notNull().default(1),
    idempotency_key: varchar("idempotency_key", { length: 128 }).notNull(),
    manifest_sha256: varchar("manifest_sha256", { length: 64 }),
    channel_key: varchar("channel_key", { length: 64 }).notNull(),
    // Immutable local source snapshot approved by the dispatch action. The
    // publisher must never re-resolve "currently selected" thumbnail state.
    video_path: text("video_path").notNull(),
    thumbnail_id: uuid("thumbnail_id")
      .notNull()
      .references(() => thumbnails.id, { onDelete: "restrict" }),
    thumbnail_path: text("thumbnail_path").notNull(),
    state: varchar("state", { length: 32 }).notNull().default("requested"),
    attributes: jsonb("attributes").$type<TutorialUploaderAttributes>().notNull(),
    manifest: jsonb("manifest").$type<TutorialUploaderJob>(),
    drive_folder_id: text("drive_folder_id"),
    latest_sequence: integer("latest_sequence").notNull().default(0),
    latest_message: text("latest_message"),
    error_code: varchar("error_code", { length: 64 }),
    error_message: text("error_message"),
    error_retryable: boolean("error_retryable"),
    youtube_video_id: varchar("youtube_video_id", { length: 11 }),
    youtube_video_url: text("youtube_video_url"),
    proof_ref: text("proof_ref"),
    requested_by: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    requested_at: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    published_at: timestamp("published_at", { withTimezone: true }),
    terminal_at: timestamp("terminal_at", { withTimezone: true }),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    tutorialJobUnique: uniqueIndex(
      "tutorial_upload_dispatches_tutorial_job_unique",
    ).on(table.tutorial_job_id),
    exchangeJobUnique: uniqueIndex(
      "tutorial_upload_dispatches_exchange_job_unique",
    ).on(table.exchange_job_id),
    idempotencyUnique: uniqueIndex(
      "tutorial_upload_dispatches_idempotency_unique",
    ).on(table.idempotency_key),
    stateIndex: index("tutorial_upload_dispatches_state_idx").on(table.state),
  }),
);

/** Append-only journal copied from the uploader's immutable Drive receipts. */
export const tutorialUploadReceipts = pgTable(
  "tutorial_upload_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dispatch_id: uuid("dispatch_id")
      .notNull()
      .references(() => tutorialUploadDispatches.id, { onDelete: "cascade" }),
    exchange_job_id: uuid("exchange_job_id").notNull(),
    revision: integer("revision").notNull(),
    sequence: integer("sequence").notNull(),
    state: varchar("state", { length: 32 }).notNull(),
    progress: doublePrecision("progress").notNull(),
    message: text("message").notNull(),
    result: jsonb("result").$type<TutorialUploaderReceipt["result"]>(),
    error: jsonb("error").$type<TutorialUploaderReceipt["error"]>(),
    raw_receipt: jsonb("raw_receipt").$type<TutorialUploaderReceipt>().notNull(),
    receipt_sha256: varchar("receipt_sha256", { length: 64 }).notNull(),
    occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull(),
    received_at: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    identitySequenceUnique: uniqueIndex(
      "tutorial_upload_receipts_identity_sequence_unique",
    ).on(table.exchange_job_id, table.revision, table.sequence),
    dispatchIndex: index("tutorial_upload_receipts_dispatch_idx").on(
      table.dispatch_id,
    ),
  }),
);

export type TutorialUploadDispatch =
  typeof tutorialUploadDispatches.$inferSelect;
export type TutorialUploadReceipt = typeof tutorialUploadReceipts.$inferSelect;
