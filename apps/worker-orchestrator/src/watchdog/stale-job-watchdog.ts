import { and, lt, eq } from "drizzle-orm";
import type { DrizzleClient } from "@repo/db";
import { contentJobs, systemEvents } from "@repo/db";
import { buildErrorDetail } from "@repo/contracts";
import { isTestAgentMode } from "@repo/config";

/**
 * Stale Job Watchdog
 *
 * Runs every 5 minutes and transitions jobs that have exceeded their
 * maximum allowed processing time into an appropriate FAILED status.
 *
 * Thresholds (all automated pipeline states):
 * - RENDERING_REMOTION / RENDERING_FFMPEG  → FAILED_RENDER   after 90 min
 * - ASSET_COLLECTION                       → FAILED_GENERAL  after 30 min
 * - QMS_VALIDATING                         → FAILED_GENERAL  after 15 min
 * - SCRIPTING                              → FAILED_GENERAL  after 30 min
 * - TRANSLATING                            → FAILED_GENERAL  after 30 min
 * - IDEA_GENERATION                        → FAILED_GENERAL  after 30 min
 * - ROUTING_RENDER                         → FAILED_GENERAL  after 60 min
 * - UPLOADING                              → FAILED_UPLOAD   after 30 min
 *
 * Human-in-the-loop states (AWAITING_*) are intentionally excluded — they
 * may remain in that state indefinitely until an operator acts.
 *
 * Design:
 * - Uses updated_at so jobs that make progress reset their own clock
 * - Logs every transition for observability / audit trail
 * - Does not re-enqueue — BullMQ queue-level retries handle that
 */

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface StaleRule {
  status: string;
  thresholdMs: number;
  failedStatus: string;
}

// Get stale rules based on environment mode
function getStaleRules(): StaleRule[] {
  // Test-agent mode: fast-fail timeouts for rapid iteration
  if (isTestAgentMode()) {
    return [
      {
        status: "RENDERING_REMOTION",
        thresholdMs: 10 * 60 * 1000,
        failedStatus: "FAILED_RENDER",
      },
      {
        status: "RENDERING_FFMPEG",
        thresholdMs: 10 * 60 * 1000,
        failedStatus: "FAILED_RENDER",
      },
      {
        status: "ASSET_COLLECTION",
        thresholdMs: 5 * 60 * 1000,
        failedStatus: "FAILED_GENERAL",
      },
      {
        status: "SCRIPTING",
        thresholdMs: 5 * 60 * 1000,
        failedStatus: "FAILED_GENERAL",
      },
      {
        status: "TRANSLATING",
        thresholdMs: 5 * 60 * 1000,
        failedStatus: "FAILED_GENERAL",
      },
      {
        status: "IDEA_GENERATION",
        thresholdMs: 5 * 60 * 1000,
        failedStatus: "FAILED_GENERAL",
      },
      {
        status: "ROUTING_RENDER",
        thresholdMs: 60 * 60 * 1000, // 60 min: render queue can be long when CPU-only (no GPU)
        failedStatus: "FAILED_GENERAL",
      },
      {
        status: "QMS_VALIDATING",
        thresholdMs: 3 * 60 * 1000,
        failedStatus: "FAILED_GENERAL",
      },
      {
        status: "UPLOADING",
        thresholdMs: 5 * 60 * 1000,
        failedStatus: "FAILED_UPLOAD",
      },
      // DRAMA fast-fail rules — testing iteration needs to catch hung
      // dramas inside one work session.
      {
        status: "DRAMA_VIDEO_GENERATING",
        thresholdMs: 15 * 60 * 1000,
        failedStatus: "FAILED_DRAMA_PIPELINE",
      },
      {
        status: "DRAMA_IMAGE_GENERATING",
        thresholdMs: 10 * 60 * 1000,
        failedStatus: "FAILED_DRAMA_PIPELINE",
      },
      {
        status: "DRAMA_ASSEMBLING",
        thresholdMs: 15 * 60 * 1000,
        failedStatus: "FAILED_DRAMA_PIPELINE",
      },
    ];
  }

  // Production mode: conservative timeouts
  return [
    {
      status: "RENDERING_REMOTION",
      thresholdMs: 90 * 60 * 1000,
      failedStatus: "FAILED_RENDER",
    },
    {
      status: "RENDERING_FFMPEG",
      thresholdMs: 90 * 60 * 1000,
      failedStatus: "FAILED_RENDER",
    },
    {
      status: "ASSET_COLLECTION",
      thresholdMs: 120 * 60 * 1000, // 120 min: image gen can take 100+ images at 1-2 min each
      failedStatus: "FAILED_GENERAL",
    },
    {
      status: "SCRIPTING",
      thresholdMs: 90 * 60 * 1000, // 90 min: long-form scripts take 30-60 min
      failedStatus: "FAILED_GENERAL",
    },
    {
      status: "TRANSLATING",
      thresholdMs: 30 * 60 * 1000,
      failedStatus: "FAILED_GENERAL",
    },
    {
      status: "IDEA_GENERATION",
      thresholdMs: 90 * 60 * 1000, // 90 min: matches SCRIPTING
      failedStatus: "FAILED_GENERAL",
    },
    {
      status: "ROUTING_RENDER",
      thresholdMs: 60 * 60 * 1000, // 60 min: render queue can be long when CPU-only (no GPU)
      failedStatus: "FAILED_GENERAL",
    },
    {
      status: "QMS_VALIDATING",
      thresholdMs: 15 * 60 * 1000,
      failedStatus: "FAILED_GENERAL",
    },
    {
      status: "UPLOADING",
      thresholdMs: 30 * 60 * 1000,
      failedStatus: "FAILED_UPLOAD",
    },
    // DRAMA_* states — the watchdog had a hole here, so a drama stuck
    // in any of these would sit forever.
    {
      status: "DRAMA_TTS_GENERATING",
      thresholdMs: 60 * 60 * 1000, // 60 min: ElevenLabs for 25-min audio
      failedStatus: "FAILED_DRAMA_PIPELINE",
    },
    {
      status: "DRAMA_TRANSCRIBING",
      thresholdMs: 30 * 60 * 1000, // 30 min: Whisper on 25-min audio (GPU much faster)
      failedStatus: "FAILED_DRAMA_PIPELINE",
    },
    {
      status: "DRAMA_PROMPT_GENERATING",
      thresholdMs: 30 * 60 * 1000, // 30 min: Gemini + autonomous character gen
      failedStatus: "FAILED_DRAMA_PIPELINE",
    },
    {
      status: "DRAMA_IMAGE_GENERATING",
      thresholdMs: 120 * 60 * 1000, // 2 hours: 25-30 images at lab clone with retries
      failedStatus: "FAILED_DRAMA_PIPELINE",
    },
    {
      status: "DRAMA_VIDEO_GENERATING",
      thresholdMs: 180 * 60 * 1000, // 3 hours: 25-30 VEO i2v at ~90s each with retries
      failedStatus: "FAILED_DRAMA_PIPELINE",
    },
    {
      status: "DRAMA_ASSEMBLING",
      thresholdMs: 180 * 60 * 1000, // 3 hours: 1-hour videos with 400+ clips run long, GPU offload can also queue
      failedStatus: "FAILED_DRAMA_PIPELINE",
    },
    {
      status: "DRAMA_QC",
      thresholdMs: 15 * 60 * 1000, // 15 min: just a preview render
      failedStatus: "FAILED_DRAMA_PIPELINE",
    },
  ];
}

export function startStaleJobWatchdog(db: DrizzleClient): NodeJS.Timeout {
  const rules = getStaleRules();

  console.log(
    JSON.stringify({
      level: "info",
      message: "[watchdog] Stale job watchdog started",
      mode: isTestAgentMode() ? "test-agent (fast-fail)" : "production",
      pollIntervalMs: POLL_INTERVAL_MS,
      rules: rules.map((r) => ({
        status: r.status,
        threshold_minutes: r.thresholdMs / 60000,
        failedStatus: r.failedStatus,
      })),
      timestamp: new Date().toISOString(),
    }),
  );

  const timer = setInterval(() => {
    runWatchdogCycle(db).catch((err) => {
      console.error(
        JSON.stringify({
          level: "error",
          message: "[watchdog] Watchdog cycle failed",
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          timestamp: new Date().toISOString(),
        }),
      );
    });
  }, POLL_INTERVAL_MS);

  return timer;
}

async function isJobInRetryBackoff(
  db: DrizzleClient,
  job: { id: string; status: string; metadata: unknown },
): Promise<boolean> {
  if (job.status !== "ASSET_COLLECTION") return false;
  const retryState = (job.metadata as any)?.image_retry_state;
  if (!retryState || typeof retryState !== "object") return false;
  const now = new Date();
  for (const imageKey of Object.keys(retryState)) {
    const state = retryState[imageKey];
    if (state?.next_retry_at && new Date(state.next_retry_at) > now)
      return true;
  }
  return false;
}

async function runWatchdogCycle(db: DrizzleClient): Promise<void> {
  const now = new Date();
  const rules = getStaleRules();

  for (const rule of rules) {
    const cutoff = new Date(now.getTime() - rule.thresholdMs);

    // Single query per rule: status matches AND updated_at is older than cutoff
    const staleJobs = await db
      .select({
        id: contentJobs.id,
        status: contentJobs.status,
        metadata: contentJobs.metadata,
        updated_at: contentJobs.updated_at,
        status_updated_at: contentJobs.status_updated_at,
        state_machine_history: contentJobs.state_machine_history,
      })
      .from(contentJobs)
      .where(
        and(
          eq(contentJobs.status, rule.status as any),
          lt(contentJobs.updated_at, cutoff),
        ),
      );

    if (staleJobs.length === 0) continue;

    for (const job of staleJobs) {
      if (await isJobInRetryBackoff(db, job)) {
        console.log(
          JSON.stringify({
            level: "info",
            message: "[watchdog] Skipping job in retry",
            job_id: job.id,
          }),
        );
        continue;
      }
      const errorMessage = `Watchdog: ${rule.status} exceeded ${rule.thresholdMs / 60000} min threshold`;

      const errorDetail = buildErrorDetail({
        code: "WATCHDOG_TIMEOUT",
        message: errorMessage,
        category: "orchestration",
        retryable: false,
        context: {
          from_status: rule.status,
          threshold_minutes: rule.thresholdMs / 60000,
          stuck_since: job.status_updated_at.toISOString(),
        },
      });

      const historyEntry = {
        from_status: rule.status,
        to_status: rule.failedStatus,
        timestamp: now.toISOString(),
        reason: errorMessage,
      };

      const existingHistory =
        (job.state_machine_history as (typeof historyEntry)[] | null) ?? [];

      try {
        await db.transaction(async (tx) => {
          // 1. Update the job (raw — bypass domain to allow TRANSLATING and QMS_VALIDATING)
          await tx
            .update(contentJobs)
            .set({
              status: rule.failedStatus as any,
              error_message: errorMessage,
              error_detail: errorDetail,
              state_machine_history: [...existingHistory, historyEntry],
              status_updated_at: now,
              updated_at: now,
            })
            .where(eq(contentJobs.id, job.id));

          // 2. Fire job_status_changed so the SSE stream picks it up
          await tx.insert(systemEvents).values({
            event_type: "job_status_changed",
            job_id: job.id,
            payload: {
              from_status: rule.status,
              to_status: rule.failedStatus,
              error_message: errorMessage,
              error_detail: errorDetail,
            },
          });

          // 3. Fire watchdog_triggered for error console filtering
          await tx.insert(systemEvents).values({
            event_type: "watchdog_triggered",
            job_id: job.id,
            payload: {
              from_status: rule.status,
              to_status: rule.failedStatus,
              threshold_minutes: rule.thresholdMs / 60000,
              stuck_since: job.status_updated_at.toISOString(),
            },
          });
        });

        console.warn(
          JSON.stringify({
            level: "warn",
            message: "[watchdog] Stale job detected and failed",
            job_id: job.id,
            from_status: rule.status,
            to_status: rule.failedStatus,
            threshold_minutes: rule.thresholdMs / 60000,
            timestamp: now.toISOString(),
          }),
        );
      } catch (jobErr) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "[watchdog] Failed to transition stale job — skipping",
            job_id: job.id,
            from_status: rule.status,
            error: jobErr instanceof Error ? jobErr.message : String(jobErr),
            timestamp: now.toISOString(),
          }),
        );
      }
    }

    console.log(
      JSON.stringify({
        level: "info",
        message: "[watchdog] Stale job cycle complete",
        count: staleJobs.length,
        from_status: rule.status,
        to_status: rule.failedStatus,
        timestamp: now.toISOString(),
      }),
    );
  }
}
