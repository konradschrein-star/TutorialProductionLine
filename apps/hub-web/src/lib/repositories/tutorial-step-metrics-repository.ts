import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tutorialJobs, users } from "@repo/db";

/**
 * Industry-4.0 step-level metrics for the Tutorial Studio.
 *
 * Every tutorial job records the exact timestamp of each production step
 * (created_at → script_done_at → audio_done_at → recorded_at → completed_at).
 * From those we derive, per VA, how long each STEP takes — so an owner can see
 * whether one VA is slow at scripting, or whether every VA is slow on Mondays,
 * i.e. total information clarity over the production floor.
 *
 * All durations are in minutes. Step definitions:
 *   script  = script_done_at - created_at      (idea/keyword → script written)
 *   audio   = audio_done_at  - script_done_at  (script → TTS narration ready)
 *   record  = recorded_at    - audio_done_at   (narration → VA screen recording)
 *   finish  = completed_at   - recorded_at      (recording → spliced/stitched)
 */

export const STEP_KEYS = ["script", "audio", "record", "finish"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export const STEP_LABELS: Record<StepKey, string> = {
  script: "Script",
  audio: "Audio (TTS)",
  record: "Recording",
  finish: "Splice/Finish",
};

export interface VAStepDurations {
  userId: string | null;
  name: string | null;
  completed: number;
  script_min: number | null;
  audio_min: number | null;
  record_min: number | null;
  finish_min: number | null;
  bottleneck: StepKey | null; // the slowest step for this VA
}

export interface DowScriptPoint {
  dow: number; // 0=Sun … 6=Sat (Postgres extract(dow))
  avg_script_min: number | null;
  samples: number;
}

export interface IntradayPoint {
  va: string | null;
  hour: number; // fractional hour-of-day (0..24) of completed_at
}

// minutes between two timestamp columns, guarded so a>=b and both present
function stepMin(a: unknown, b: unknown) {
  return sql<string>`round(avg(extract(epoch from (${a} - ${b})) / 60.0) filter (where ${a} is not null and ${b} is not null and ${a} >= ${b}), 1)`;
}

export async function getVAStepDurations(
  windowDays = 28,
): Promise<VAStepDurations[]> {
  const rows = await db
    .select({
      userId: tutorialJobs.created_by,
      name: users.name,
      completed: sql<number>`cast(count(*) filter (where ${tutorialJobs.status} = 'COMPLETED') as integer)`,
      script_min: stepMin(tutorialJobs.script_done_at, tutorialJobs.created_at),
      audio_min: stepMin(tutorialJobs.audio_done_at, tutorialJobs.script_done_at),
      record_min: stepMin(tutorialJobs.recorded_at, tutorialJobs.audio_done_at),
      finish_min: stepMin(tutorialJobs.completed_at, tutorialJobs.recorded_at),
    })
    .from(tutorialJobs)
    .leftJoin(users, sql`${users.id} = ${tutorialJobs.created_by}`)
    .where(
      sql`${tutorialJobs.created_at} >= now() - (${windowDays} || ' days')::interval`,
    )
    .groupBy(tutorialJobs.created_by, users.name)
    .orderBy(
      sql`count(*) filter (where ${tutorialJobs.status} = 'COMPLETED') desc`,
    );

  return rows.map((r) => {
    const steps: Record<StepKey, number | null> = {
      script: r.script_min == null ? null : Number(r.script_min),
      audio: r.audio_min == null ? null : Number(r.audio_min),
      record: r.record_min == null ? null : Number(r.record_min),
      finish: r.finish_min == null ? null : Number(r.finish_min),
    };
    let bottleneck: StepKey | null = null;
    let worst = -1;
    for (const k of STEP_KEYS) {
      const v = steps[k];
      if (v != null && v > worst) {
        worst = v;
        bottleneck = k;
      }
    }
    return {
      userId: r.userId,
      name: r.name,
      completed: r.completed ?? 0,
      script_min: steps.script,
      audio_min: steps.audio,
      record_min: steps.record,
      finish_min: steps.finish,
      bottleneck,
    };
  });
}

/** Average scripting minutes by day-of-week — reveals "Mondays are always slow". */
export async function getScriptTimeByDow(
  windowDays = 90,
): Promise<DowScriptPoint[]> {
  const rows = await db
    .select({
      dow: sql<number>`cast(extract(dow from ${tutorialJobs.created_at}) as integer)`,
      avg_script_min: sql<string>`round(avg(extract(epoch from (${tutorialJobs.script_done_at} - ${tutorialJobs.created_at})) / 60.0) filter (where ${tutorialJobs.script_done_at} is not null and ${tutorialJobs.script_done_at} >= ${tutorialJobs.created_at}), 1)`,
      samples: sql<number>`cast(count(*) filter (where ${tutorialJobs.script_done_at} is not null) as integer)`,
    })
    .from(tutorialJobs)
    .where(
      sql`${tutorialJobs.created_at} >= now() - (${windowDays} || ' days')::interval`,
    )
    .groupBy(sql`extract(dow from ${tutorialJobs.created_at})`)
    .orderBy(sql`extract(dow from ${tutorialJobs.created_at})`);

  return rows.map((r) => ({
    dow: r.dow ?? 0,
    avg_script_min: r.avg_script_min == null ? null : Number(r.avg_script_min),
    samples: r.samples ?? 0,
  }));
}

/** One tutorial job with its VA-action timestamps, for the daily event timeline. */
export interface VaTimelineJob {
  userId: string | null;
  va: string | null;
  jobId: string;
  title: string | null;
  status: string;
  /** VA hit "Generate/Render" — the job was created. Always present. */
  createdAt: string;
  /** VA uploaded their screen recording. Null until they do. */
  recordedAt: string | null;
  /** System finished splicing. Null until done. */
  completedAt: string | null;
}

/**
 * Raw per-job event timeline for the "when did the VA actually work today" view.
 *
 * Returns every original (hands-on) job in the window with its VA-action
 * timestamps as ISO strings, newest first. The client unpivots each job into
 * events (created = render/generate click, recorded = upload click, completed =
 * finish) and plots them on a 24h-per-day axis, so the owner's eye can read the
 * real working window, the length of the noon pause, and videos-per-day —
 * without inventing any "claimed hours" the system does not store.
 *
 * Timestamps are returned as UTC ISO; the client renders hour-of-day in the
 * viewer's local timezone (labelled), since the DB stores only timestamptz.
 */
export async function getVaEventTimeline(
  windowDays = 14,
): Promise<VaTimelineJob[]> {
  const rows = await db
    .select({
      userId: tutorialJobs.created_by,
      va: users.name,
      jobId: tutorialJobs.id,
      title: tutorialJobs.title,
      status: tutorialJobs.status,
      createdAt: sql<string>`to_char(${tutorialJobs.created_at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      recordedAt: sql<
        string | null
      >`to_char(${tutorialJobs.recorded_at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      completedAt: sql<
        string | null
      >`to_char(${tutorialJobs.completed_at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
    })
    .from(tutorialJobs)
    .leftJoin(users, sql`${users.id} = ${tutorialJobs.created_by}`)
    .where(
      sql`${tutorialJobs.source_job_id} is null and ${tutorialJobs.created_at} >= now() - (${windowDays} || ' days')::interval`,
    )
    .orderBy(sql`${tutorialJobs.created_at} desc`)
    .limit(5000);

  return rows.map((r) => ({
    userId: r.userId,
    va: r.va,
    jobId: r.jobId,
    title: r.title,
    status: r.status,
    createdAt: r.createdAt,
    recordedAt: r.recordedAt ?? null,
    completedAt: r.completedAt ?? null,
  }));
}

/**
 * Intraday production rhythm — every produced video mapped to its HOUR OF DAY
 * (0..24) of completion, per VA. This is the "clock" view: it reveals the VA's
 * ACTUAL working window regardless of what they claim — e.g. 120 videos all made
 * between 09:00 and 14:00 (5h), not the 8h logged. Only original (non-translated)
 * jobs count as hands-on VA production (`source_job_id IS NULL`).
 */
export async function getIntradayProduction(
  windowDays = 28,
): Promise<IntradayPoint[]> {
  const rows = await db
    .select({
      va: users.name,
      hour: sql<string>`extract(hour from ${tutorialJobs.completed_at}) + extract(minute from ${tutorialJobs.completed_at}) / 60.0`,
    })
    .from(tutorialJobs)
    .leftJoin(users, sql`${users.id} = ${tutorialJobs.created_by}`)
    .where(
      sql`${tutorialJobs.status} = 'COMPLETED' and ${tutorialJobs.source_job_id} is null and ${tutorialJobs.completed_at} >= now() - (${windowDays} || ' days')::interval`,
    )
    .orderBy(sql`${tutorialJobs.completed_at} asc`)
    .limit(3000);

  return rows.map((r) => ({ va: r.va, hour: Number(r.hour) }));
}
