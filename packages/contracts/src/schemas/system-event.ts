import { z } from "zod";

/**
 * System Event Schema
 *
 * Used for PostgreSQL LISTEN/NOTIFY → SSE realtime updates.
 *
 * The Hub control plane uses pg-listen to subscribe to database events
 * and streams them to the UI via Server-Sent Events (SSE).
 *
 * The system_events table logs all state transitions for SSE consumption
 * and audit purposes.
 *
 * Fields:
 * - event_type: String discriminator for event categorization
 * - job_id: Nullable (system-wide events have no job)
 * - payload: Flexible JSONB for event-specific data
 * - timestamp: ISO 8601 datetime
 */
export const SystemEventSchema = z.object({
  event_type: z
    .string()
    .min(1)
    .describe("Event type discriminator (e.g., 'job.status_changed', 'worker.started')"),

  job_id: z
    .string()
    .uuid()
    .nullable()
    .describe("Related job ID (null for system-wide events)"),

  payload: z
    .record(z.string(), z.unknown())
    .describe("Flexible event-specific data"),

  timestamp: z
    .string()
    .datetime()
    .describe("ISO 8601 timestamp of event occurrence"),
});

export type SystemEvent = z.infer<typeof SystemEventSchema>;
