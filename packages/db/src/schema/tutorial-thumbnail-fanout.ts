import { pgTable, uuid, text, integer, timestamp, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { tutorialJobs } from "./tutorial-jobs.js";
import { thumbnails } from "./thumbnails.js";
import { channels } from "./channels.js";

export const tutorialThumbnailFanout = pgTable("tutorial_thumbnail_fanout", {
  id: uuid("id").primaryKey().defaultRandom(),
  source_job_id: uuid("source_job_id").notNull().references(() => tutorialJobs.id, { onDelete: "cascade" }),
  source_thumbnail_id: uuid("source_thumbnail_id").notNull().references(() => thumbnails.id, { onDelete: "restrict" }),
  approval_revision: text("approval_revision").notNull(),
  source_path: text("source_path").notNull(),
  source_sha256: text("source_sha256").notNull(),
  source_size: integer("source_size").notNull(),
  target_language: text("target_language").notNull(),
  target_channel_id: uuid("target_channel_id").notNull().references(() => channels.id, { onDelete: "restrict" }),
  state: text("state").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  generation_request_id: uuid("generation_request_id"),
  retry_history: jsonb("retry_history").$type<Array<{ requestId: string; actorId: string; at: string; previousState: string; previousError: string | null; generationRequestId: string }>>().notNull().default([]),
  lease_token: uuid("lease_token"),
  lease_until: timestamp("lease_until", { withTimezone: true }),
  output_thumbnail_id: uuid("output_thumbnail_id").references(() => thumbnails.id, { onDelete: "restrict" }),
  last_error: text("last_error"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqueApprovalLocale: uniqueIndex("uq_tutorial_thumbnail_fanout_approval_locale").on(t.source_job_id, t.approval_revision, t.target_language) }));
