import { pgTable, uuid, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { contentJobs } from "./content-jobs.js";

/**
 * System Events Table
 *
 * LISTEN/NOTIFY event log for SSE streaming to Hub UI.
 * Enables real-time updates without database polling.
 *
 * Event flow:
 * 1. State transition occurs in content_jobs
 * 2. INSERT into system_events triggers PostgreSQL NOTIFY
 * 3. Backend pg-listen subscriber receives event
 * 4. SSE stream pushes to connected Hub clients
 *
 * Foreign key policy:
 * - job_id → content_jobs.id (CASCADE - no orphaned events)
 *
 * Indexes:
 * - timestamp (for pruning old events)
 * - job_id (for job-specific event queries)
 * - event_type (for event filtering)
 *
 * Future work:
 * - Implement retention policy (auto-delete events older than N days)
 */
export const systemEvents = pgTable(
  "system_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_type: varchar("event_type", { length: 100 }).notNull(),
    job_id: uuid("job_id").references(() => contentJobs.id, { onDelete: "cascade" }),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    timestampIdx: index("system_events_timestamp_idx").on(table.timestamp),
    jobIdIdx: index("system_events_job_id_idx").on(table.job_id),
    eventTypeIdx: index("system_events_event_type_idx").on(table.event_type),
  })
);
