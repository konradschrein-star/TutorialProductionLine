import { pgTable, uuid, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { tutorialJobs } from "./tutorial-jobs.js";
import { users } from "./users.js";

/** Tutorial-owned audit history, never broadcast through Content Forge SSE. */
export const tutorialJobEvents = pgTable("tutorial_job_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorial_job_id: uuid("tutorial_job_id").notNull().references(() => tutorialJobs.id, { onDelete: "cascade" }),
  event_type: varchar("event_type", { length: 64 }).notNull(),
  event_key: varchar("event_key", { length: 128 }),
  actor_id: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ jobTime: index("tutorial_job_events_job_time_idx").on(table.tutorial_job_id, table.created_at) }));
