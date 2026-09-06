import { ProductionMetrics, VAProductivityStat, FinishedVideo, StudioJob, VAUser } from '../types';
import { StorageService } from './storageService';
import { KeywordService } from './keywordService';

/**
 * MetricsService — HONEST aggregation only.
 *
 * Every number here is derived strictly from real records in the store
 * (finished videos, studio jobs, drive deliveries, keyword claims, VA targets).
 * There are NO invented floors, no `Math.max(real, hardcoded)`, no fabricated
 * fallbacks. Where there is no data the value is a true zero / empty — the UI is
 * responsible for showing an honest empty state rather than dressing a zero up as
 * activity.
 *
 * Attribution note: keyword claims historically store the VA *display name* in
 * `claimedBy`; we match on id first and fall back to name. Produced videos/jobs
 * are attributed only when `producedByUserId` / `producedByName` is stamped on the
 * record (optional). Absent that, production still counts toward the team totals
 * but cannot be split per-VA — so per-VA capacity/target numbers stay honest zero
 * until the producing surface stamps the operator.
 */

/** Terminal studio statuses that are NOT "active in the pipeline". */
const TERMINAL_STATUSES = new Set<StudioJob['status']>([
  'COMPLETED',
  'CANCELLED',
  'FAILED_SCRIPT',
  'FAILED_AUDIO',
  'FAILED_SPLICE',
]);

/** A single unified "produced video" record, normalised across both stores. */
interface ProducedRecord {
  /** ISO calendar day (YYYY-MM-DD). */
  date: string;
  channel: string;
  durationMin: number;
  vaId?: string;
  vaName?: string;
}

/** Parse a "m:ss" / "h:mm:ss" duration string to minutes. Unknown → 0 (honest). */
function parseDurationMinutes(duration?: string): number {
  if (!duration || typeof duration !== 'string' || !duration.includes(':')) return 0;
  const parts = duration.split(':').map((p) => Number(p));
  if (parts.some((n) => isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return 0;
}

/** Normalise any timestamp/date string to a YYYY-MM-DD calendar day, or '' if unusable. */
function toDay(value?: string): string {
  if (!value || typeof value !== 'string') return '';
  // Handles both 'YYYY-MM-DD' and full ISO 'YYYY-MM-DDTHH:mm:ss.sssZ'.
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

function localDayString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Does a claim belong to this user? Prefer id, fall back to display name. */
function claimBelongsTo(claimedBy: string | undefined, user: VAUser): boolean {
  if (!claimedBy) return false;
  return claimedBy === user.id || claimedBy === user.name;
}

/** Does a produced record belong to this user? Prefer id, fall back to name. */
function recordBelongsTo(rec: ProducedRecord, user: VAUser): boolean {
  if (rec.vaId && rec.vaId === user.id) return true;
  if (rec.vaName && rec.vaName === user.name) return true;
  return false;
}

interface CapacityStats {
  activeDays: number;
  bestDayCount: number;
  bestDayDate?: string;
  avgPerActiveDay: number;
  today: number;
  thisWeek: number;
}

/**
 * Capacity/throughput helper — from a set of dated produced records, compute the
 * observed maximum-per-day (peak capability), average over active days, and the
 * today / rolling-week counts. Zero-safe.
 */
function computeCapacity(records: ProducedRecord[], todayStr: string, weekStart: string): CapacityStats {
  const perDay = new Map<string, number>();
  let today = 0;
  let thisWeek = 0;

  for (const r of records) {
    if (!r.date) continue;
    perDay.set(r.date, (perDay.get(r.date) || 0) + 1);
    if (r.date === todayStr) today++;
    if (r.date >= weekStart && r.date <= todayStr) thisWeek++;
  }

  let bestDayCount = 0;
  let bestDayDate: string | undefined;
  let total = 0;
  for (const [day, count] of perDay) {
    total += count;
    if (count > bestDayCount) {
      bestDayCount = count;
      bestDayDate = day;
    }
  }

  const activeDays = perDay.size;
  const avgPerActiveDay = activeDays > 0 ? total / activeDays : 0;

  return { activeDays, bestDayCount, bestDayDate, avgPerActiveDay, today, thisWeek };
}

function pct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

export class MetricsService {
  /** Number of days shown in the velocity window. */
  static readonly VELOCITY_WINDOW_DAYS = 7;

  /**
   * Build the unified list of real produced-video records from both stores.
   * A finished video and a completed studio job are distinct records in distinct
   * stores; both count as produced output.
   */
  private static buildProducedRecords(
    finishedVideos: FinishedVideo[],
    studioJobs: StudioJob[]
  ): ProducedRecord[] {
    const records: ProducedRecord[] = [];

    for (const v of finishedVideos) {
      if (!v || !v.id) continue; // skip null / malformed entries
      records.push({
        date: toDay(v.createdAt),
        channel: (v.channel || '').trim(),
        durationMin: parseDurationMinutes(v.duration),
        vaId: v.producedByUserId,
        vaName: v.producedByName,
      });
    }

    for (const j of studioJobs) {
      if (!j || !j.id || j.status !== 'COMPLETED') continue;
      records.push({
        date: toDay(j.updatedAt) || toDay(j.createdAt),
        channel: (j.channelName || '').trim(),
        durationMin: j.durationSeconds && !isNaN(j.durationSeconds) ? j.durationSeconds / 60 : 0,
        vaId: j.producedByUserId,
        vaName: j.producedByName,
      });
    }

    return records;
  }

  static getMetrics(): ProductionMetrics {
    try {
      const finishedVideos = StorageService.getFinishedVideos() || [];
      const studioJobs = StorageService.getStudioJobs() || [];
      const driveDeliveries = StorageService.getDriveDeliveries() || [];
      const keywords = KeywordService.getKeywords() || [];
      const users = StorageService.getUsers() || [];

      const produced = this.buildProducedRecords(finishedVideos, studioJobs);

      const now = new Date();
      const todayStr = localDayString(now);
      const weekStartDate = new Date(now);
      weekStartDate.setDate(weekStartDate.getDate() - 6); // rolling 7-day window incl. today
      const weekStart = localDayString(weekStartDate);

      // ---- Top-level honest totals ------------------------------------------
      const totalProduced = produced.length;
      const totalDurationMinutes = Math.round(produced.reduce((sum, r) => sum + r.durationMin, 0));

      const inProductionCount =
        studioJobs.filter((j) => j && j.id && !TERMINAL_STATUSES.has(j.status)).length +
        keywords.filter((k) => k.status === 'IN_PRODUCTION' || k.status === 'CLAIMED').length;

      const queuedCount = keywords.filter((k) => k.status === 'NEW').length;

      const deliveredToDriveCount = driveDeliveries.filter(
        (d) => d && d.status === 'IN_GOOGLE_DRIVE'
      ).length;

      // ---- Channel distribution (real) --------------------------------------
      const channelCounts: Record<string, number> = {};
      for (const r of produced) {
        if (!r.channel) continue;
        channelCounts[r.channel] = (channelCounts[r.channel] || 0) + 1;
      }

      // ---- Daily velocity over the window (real per-day counts) -------------
      const dailyVelocity: { date: string; count: number }[] = [];
      const perDayAll = new Map<string, number>();
      for (const r of produced) {
        if (!r.date) continue;
        perDayAll.set(r.date, (perDayAll.get(r.date) || 0) + 1);
      }
      for (let i = this.VELOCITY_WINDOW_DAYS - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dayStr = localDayString(d);
        dailyVelocity.push({
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          count: perDayAll.get(dayStr) || 0,
        });
      }

      // ---- Team capacity across ALL history (peak/day, avg/active-day) ------
      const teamCapacity = computeCapacity(produced, todayStr, weekStart);

      // ---- Per-VA productivity (strictly from real attributed records) ------
      const vaActivityCounts: Record<string, number> = {};
      const vaProductivityList: VAProductivityStat[] = users.map((u) => {
        const userClaims = keywords.filter((k) => claimBelongsTo(k.claimedBy, u));
        const completedClaims = userClaims.filter((k) => k.status === 'COMPLETED');
        const activeClaims = userClaims.filter(
          (k) => k.status === 'IN_PRODUCTION' || k.status === 'CLAIMED'
        );
        const estRuntime = Math.round(
          completedClaims.reduce((sum, k) => sum + (k.estMinutes && !isNaN(k.estMinutes) ? k.estMinutes : 0), 0)
        );

        const vaRecords = produced.filter((r) => recordBelongsTo(r, u));
        const cap = computeCapacity(vaRecords, todayStr, weekStart);

        const target = StorageService.getVATarget(u.id);
        const dailyTarget = target.dailyTarget || 0;
        const weeklyTarget = target.weeklyTarget || 0;
        const dailyProgressPct = pct(cap.today, dailyTarget);
        const weeklyProgressPct = pct(cap.thisWeek, weeklyTarget);

        vaActivityCounts[u.name] = completedClaims.length;

        return {
          userId: u.id,
          name: u.name,
          role: u.role,
          email: u.email,
          assignedChannels: u.assignedChannels || [],
          completedCount: completedClaims.length,
          inProductionCount: activeClaims.length,
          watchTimeMinutes: estRuntime,
          efficiencyRating: weeklyProgressPct,
          claimedTotal: userClaims.length,
          dailyTarget,
          weeklyTarget,
          completedToday: cap.today,
          completedThisWeek: cap.thisWeek,
          dailyProgressPct,
          weeklyProgressPct,
          avgPerActiveDay: Math.round(cap.avgPerActiveDay * 10) / 10,
          bestDayCount: cap.bestDayCount,
          bestDayDate: cap.bestDayDate,
          activeDays: cap.activeDays,
        };
      });

      const totalClaimedCompleted = keywords.filter((k) => k.status === 'COMPLETED' && k.claimedBy).length;

      return {
        totalProduced,
        totalDurationMinutes,
        inProductionCount,
        queuedCount,
        deliveredToDriveCount,
        channelCounts,
        vaActivityCounts,
        vaProductivityList,
        dailyVelocity,
        windowDays: this.VELOCITY_WINDOW_DAYS,
        teamBestDay: teamCapacity.bestDayDate
          ? { date: teamCapacity.bestDayDate, count: teamCapacity.bestDayCount }
          : undefined,
        teamAvgPerActiveDay: Math.round(teamCapacity.avgPerActiveDay * 10) / 10,
        teamActiveDays: teamCapacity.activeDays,
        totalClaimedCompleted,
        producedToday: teamCapacity.today,
        producedThisWeek: teamCapacity.thisWeek,
      };
    } catch (e) {
      // Never fabricate on error — return an honest empty shape.
      console.warn('MetricsService.getMetrics failed, returning empty metrics:', e);
      const dailyVelocity: { date: string; count: number }[] = [];
      const now = new Date();
      for (let i = this.VELOCITY_WINDOW_DAYS - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dailyVelocity.push({ date: `${d.getMonth() + 1}/${d.getDate()}`, count: 0 });
      }
      return {
        totalProduced: 0,
        totalDurationMinutes: 0,
        inProductionCount: 0,
        queuedCount: 0,
        deliveredToDriveCount: 0,
        channelCounts: {},
        vaActivityCounts: {},
        vaProductivityList: [],
        dailyVelocity,
        windowDays: this.VELOCITY_WINDOW_DAYS,
        teamAvgPerActiveDay: 0,
        teamActiveDays: 0,
        totalClaimedCompleted: 0,
        producedToday: 0,
        producedThisWeek: 0,
      };
    }
  }
}
