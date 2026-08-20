import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tutorialJobs, users } from "@repo/db";

/**
 * Tutorial Repository (hub-web side)
 *
 * Server-side reads for the Dashboard metrics.
 * Uses window / filter counts following the analytics-repository pattern.
 */

export interface TutorialTotals {
  total: number;
  week: number;
}

export interface LeaderboardEntry {
  userId: string | null;
  name: string | null;
  completed: number;
}

export interface VAStats {
  userId: string | null;
  name: string | null;
  count_7d: number;
  count_28d: number;
  count_90d: number;
  count_lifetime: number;
  minutes_7d: number;
  minutes_28d: number;
  minutes_90d: number;
  minutes_lifetime: number;
}

export interface VADailyEntry {
  userId: string | null;
  name: string | null;
  count_today: number;
  minutes_today: number;
}

export async function getTutorialTotals(): Promise<TutorialTotals> {
  const [total] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(tutorialJobs)
    .where(sql`${tutorialJobs.status} = 'COMPLETED'`);

  const [week] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(tutorialJobs)
    .where(
      sql`${tutorialJobs.status} = 'COMPLETED' AND ${tutorialJobs.completed_at} >= now() - interval '7 days'`,
    );

  return {
    total: total?.count ?? 0,
    week: week?.count ?? 0,
  };
}

export async function getTutorialLeaderboard(): Promise<LeaderboardEntry[]> {
  return db
    .select({
      userId: tutorialJobs.created_by,
      name: users.name,
      completed: sql<number>`cast(count(*) filter (where ${tutorialJobs.status} = 'COMPLETED') as integer)`,
    })
    .from(tutorialJobs)
    .leftJoin(users, sql`${users.id} = ${tutorialJobs.created_by}`)
    .groupBy(tutorialJobs.created_by, users.name)
    .orderBy(
      sql`count(*) filter (where ${tutorialJobs.status} = 'COMPLETED') desc`,
    );
}

const durExpr = sql`coalesce(${tutorialJobs.recording_duration_s}, ${tutorialJobs.audio_duration_s}, cast(0 as numeric))`;

export async function getVAStats(): Promise<VAStats[]> {
  const rows = await db
    .select({
      userId: tutorialJobs.created_by,
      name: users.name,
      count_7d: sql<number>`cast(count(*) filter (where ${tutorialJobs.status} = 'COMPLETED' and ${tutorialJobs.completed_at} >= now() - interval '7 days') as integer)`,
      count_28d: sql<number>`cast(count(*) filter (where ${tutorialJobs.status} = 'COMPLETED' and ${tutorialJobs.completed_at} >= now() - interval '28 days') as integer)`,
      count_90d: sql<number>`cast(count(*) filter (where ${tutorialJobs.status} = 'COMPLETED' and ${tutorialJobs.completed_at} >= now() - interval '90 days') as integer)`,
      count_lifetime: sql<number>`cast(count(*) filter (where ${tutorialJobs.status} = 'COMPLETED') as integer)`,
      minutes_7d: sql<string>`round(coalesce(sum(${durExpr}) filter (where ${tutorialJobs.status} = 'COMPLETED' and ${tutorialJobs.completed_at} >= now() - interval '7 days'), cast(0 as numeric)) / 60, 1)`,
      minutes_28d: sql<string>`round(coalesce(sum(${durExpr}) filter (where ${tutorialJobs.status} = 'COMPLETED' and ${tutorialJobs.completed_at} >= now() - interval '28 days'), cast(0 as numeric)) / 60, 1)`,
      minutes_90d: sql<string>`round(coalesce(sum(${durExpr}) filter (where ${tutorialJobs.status} = 'COMPLETED' and ${tutorialJobs.completed_at} >= now() - interval '90 days'), cast(0 as numeric)) / 60, 1)`,
      minutes_lifetime: sql<string>`round(coalesce(sum(${durExpr}) filter (where ${tutorialJobs.status} = 'COMPLETED'), cast(0 as numeric)) / 60, 1)`,
    })
    .from(tutorialJobs)
    .leftJoin(users, sql`${users.id} = ${tutorialJobs.created_by}`)
    .groupBy(tutorialJobs.created_by, users.name)
    .orderBy(
      sql`count(*) filter (where ${tutorialJobs.status} = 'COMPLETED') desc`,
    );

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    count_7d: r.count_7d ?? 0,
    count_28d: r.count_28d ?? 0,
    count_90d: r.count_90d ?? 0,
    count_lifetime: r.count_lifetime ?? 0,
    minutes_7d: Number(r.minutes_7d ?? 0),
    minutes_28d: Number(r.minutes_28d ?? 0),
    minutes_90d: Number(r.minutes_90d ?? 0),
    minutes_lifetime: Number(r.minutes_lifetime ?? 0),
  }));
}

export interface VADailyPoint {
  userId: string | null;
  name: string | null;
  day: string;
  count: number;
  minutes: number;
}

export async function getVADailyTimeseries(): Promise<VADailyPoint[]> {
  const rows = await db
    .select({
      userId: tutorialJobs.created_by,
      name: users.name,
      day: sql<string>`to_char(${tutorialJobs.completed_at}::date, 'YYYY-MM-DD')`,
      count: sql<number>`cast(count(*) as integer)`,
      minutes: sql<string>`round(coalesce(sum(${durExpr}), cast(0 as numeric)) / 60, 1)`,
    })
    .from(tutorialJobs)
    .leftJoin(users, sql`${users.id} = ${tutorialJobs.created_by}`)
    .where(
      sql`${tutorialJobs.status} = 'COMPLETED' and ${tutorialJobs.completed_at} >= now() - interval '28 days'`,
    )
    .groupBy(
      tutorialJobs.created_by,
      users.name,
      sql`${tutorialJobs.completed_at}::date`,
    )
    .orderBy(sql`${tutorialJobs.completed_at}::date asc`);

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    day: r.day,
    count: r.count ?? 0,
    minutes: Number(r.minutes ?? 0),
  }));
}

export async function getVADailyLeaderboard(): Promise<VADailyEntry[]> {
  const rows = await db
    .select({
      userId: tutorialJobs.created_by,
      name: users.name,
      count_today: sql<number>`cast(count(*) as integer)`,
      minutes_today: sql<string>`round(coalesce(sum(${durExpr}), cast(0 as numeric)) / 60, 1)`,
    })
    .from(tutorialJobs)
    .leftJoin(users, sql`${users.id} = ${tutorialJobs.created_by}`)
    .where(
      sql`${tutorialJobs.status} = 'COMPLETED' and ${tutorialJobs.completed_at} >= current_date`,
    )
    .groupBy(tutorialJobs.created_by, users.name)
    .orderBy(sql`count(*) desc`);

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    count_today: r.count_today ?? 0,
    minutes_today: Number(r.minutes_today ?? 0),
  }));
}
