/**
 * System Event Repository
 *
 * Data access layer for system_events table.
 * Events are used for audit trails, SSE streaming, and system monitoring.
 */

import { eq, desc, and, gte } from "drizzle-orm";
import { systemEvents } from "../schema/system-events.js";
import type { Transaction } from "./transaction.js";
import { getDbOrTx } from "./transaction.js";

// Type for inserting a new event
export type NewSystemEvent = typeof systemEvents.$inferInsert;

// Type for a complete event record
export type SystemEvent = typeof systemEvents.$inferSelect;

/**
 * Create a new system event
 *
 * @param data - Event data to insert
 * @param tx - Optional transaction
 * @returns Created event
 */
export async function createSystemEvent(
  data: NewSystemEvent,
  tx?: Transaction
): Promise<SystemEvent> {
  const db = getDbOrTx(tx);

  const [event] = await db
    .insert(systemEvents)
    .values(data)
    .returning();

  if (!event) {
    throw new Error("Failed to create system event");
  }

  return event;
}

/**
 * Get event by ID
 *
 * @param id - Event ID
 * @param tx - Optional transaction
 * @returns Event or null if not found
 */
export async function getSystemEventById(
  id: string,
  tx?: Transaction
): Promise<SystemEvent | null> {
  const db = getDbOrTx(tx);

  const [event] = await db
    .select()
    .from(systemEvents)
    .where(eq(systemEvents.id, id))
    .limit(1);

  return event || null;
}

/**
 * Get events by job ID
 *
 * @param jobId - Job ID
 * @param limit - Optional limit (default: 100)
 * @param tx - Optional transaction
 * @returns Array of events, newest first
 */
export async function getEventsByJobId(
  jobId: string,
  limit: number = 100,
  tx?: Transaction
): Promise<SystemEvent[]> {
  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(systemEvents)
    .where(eq(systemEvents.job_id, jobId))
    .orderBy(desc(systemEvents.timestamp))
    .limit(limit);
}

/**
 * Get events by event type
 *
 * @param eventType - Event type
 * @param limit - Optional limit (default: 100)
 * @param tx - Optional transaction
 * @returns Array of events, newest first
 */
export async function getEventsByType(
  eventType: string,
  limit: number = 100,
  tx?: Transaction
): Promise<SystemEvent[]> {
  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(systemEvents)
    .where(eq(systemEvents.event_type, eventType))
    .orderBy(desc(systemEvents.timestamp))
    .limit(limit);
}

/**
 * Get recent events
 *
 * @param limit - Number of events to return (default: 50)
 * @param tx - Optional transaction
 * @returns Array of events, newest first
 */
export async function getRecentEvents(
  limit: number = 50,
  tx?: Transaction
): Promise<SystemEvent[]> {
  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(systemEvents)
    .orderBy(desc(systemEvents.timestamp))
    .limit(limit);
}

/**
 * Get events since a specific timestamp
 *
 * Used for SSE streaming - get all events newer than the client's last seen event.
 *
 * @param since - Timestamp to get events after
 * @param limit - Optional limit (default: 100)
 * @param tx - Optional transaction
 * @returns Array of events, oldest first (for chronological streaming)
 */
export async function getEventsSince(
  since: Date,
  limit: number = 100,
  tx?: Transaction
): Promise<SystemEvent[]> {
  const db = getDbOrTx(tx);

  return await db
    .select()
    .from(systemEvents)
    .where(gte(systemEvents.timestamp, since))
    .orderBy(systemEvents.timestamp) // Oldest first for streaming
    .limit(limit);
}

/**
 * Create job status change event
 *
 * Convenience function for the most common event type.
 *
 * @param jobId - Job ID
 * @param fromStatus - Previous status
 * @param toStatus - New status
 * @param userId - Optional user ID who triggered the change
 * @param metadata - Optional additional metadata
 * @param tx - Optional transaction
 * @returns Created event
 */
export async function createJobStatusEvent(
  jobId: string,
  fromStatus: string,
  toStatus: string,
  metadata?: Record<string, unknown>,
  tx?: Transaction
): Promise<SystemEvent> {
  return await createSystemEvent(
    {
      event_type: "job.status.changed",
      job_id: jobId,
      payload: {
        from_status: fromStatus,
        to_status: toStatus,
        ...metadata,
      },
    },
    tx
  );
}

/**
 * Create job error event
 *
 * Convenience function for error events.
 *
 * @param jobId - Job ID
 * @param error - Error message or object
 * @param metadata - Optional additional metadata
 * @param tx - Optional transaction
 * @returns Created event
 */
export async function createJobErrorEvent(
  jobId: string,
  error: string | Error,
  metadata?: Record<string, unknown>,
  tx?: Transaction
): Promise<SystemEvent> {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : undefined;

  return await createSystemEvent(
    {
      event_type: "job.error",
      job_id: jobId,
      payload: {
        error: errorMessage,
        stack: errorStack,
        ...metadata,
      },
    },
    tx
  );
}
