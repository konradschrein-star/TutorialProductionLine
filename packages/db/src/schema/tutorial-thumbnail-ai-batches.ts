import { pgTable, uuid, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { tutorialJobs } from "./tutorial-jobs.js";
export const tutorialThumbnailAiBatches = pgTable("tutorial_thumbnail_ai_batches", {
  job_id: uuid("job_id").notNull().references(() => tutorialJobs.id, { onDelete: "cascade" }),
  request_id: uuid("request_id").notNull(),
  payload_digest: text("payload_digest").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  attempted_variants: jsonb("attempted_variants").$type<number[]>().notNull().default([]),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({ pk: primaryKey({ columns: [table.job_id, table.request_id] }) }));
