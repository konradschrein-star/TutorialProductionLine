import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Video,
  Clock,
  FolderCheck,
  Users,
  Tv,
  Gauge,
  Target,
  RefreshCw,
  HardDrive,
  CheckCircle2,
  CalendarDays,
  Trophy,
  Info,
} from 'lucide-react';
import { MetricsService } from '../services/metricsService';
import { StorageService } from '../services/storageService';
import {
  useFinishedVideos,
  useStudioJobs,
  useUsers,
  useConfig,
  useStore,
} from '../hooks/useStore';
import { useRole } from '../context/RoleContext';
import { VAProductivityStat } from '../types';

// ---------------------------------------------------------------------------
// Small presentational helpers (token-driven, no raw color literals)
// ---------------------------------------------------------------------------

const roleBadgeClass = (role: VAProductivityStat['role']): string => {
  switch (role) {
    case 'admin':
      return 'badge badge-accent';
    case 'manager':
      return 'badge badge-info';
    case 'va':
      return 'badge badge-success';
    default:
      return 'badge badge-neutral';
  }
};

const KpiCard: React.FC<{
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  sub?: React.ReactNode;
}> = ({ label, value, icon, sub }) => (
  <div className="pro-panel p-4 rounded-xl space-y-1">
    <div className="flex items-center justify-between text-muted">
      <span className="text-xs font-mono font-bold uppercase tracking-wide">{label}</span>
      {icon}
    </div>
    <div className="text-2xl font-bold font-mono text-foreground">{value}</div>
    {sub && <div className="text-xs text-muted">{sub}</div>}
  </div>
);

const ProgressBar: React.FC<{ value: number; max: number; complete?: boolean }> = ({
  value,
  max,
  complete,
}) => {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const reached = complete ?? pct >= 100;
  return (
    <div className="h-2 w-full rounded-full bg-surface-300 overflow-hidden" role="presentation">
      <div
        className={`h-full rounded-full transition-all ${reached ? 'bg-success' : 'bg-accent'}`}
        style={{ width: `${max > 0 ? pct : 0}%` }}
      />
    </div>
  );
};

const EmptyHint: React.FC<{ icon?: React.ReactNode; title: string; children?: React.ReactNode }> = ({
  icon,
  title,
  children,
}) => (
  <div className="flex flex-col items-center justify-center text-center gap-1.5 py-8 px-4">
    <div className="text-muted">{icon ?? <Info className="w-5 h-5" />}</div>
    <div className="text-sm font-semibold text-foreground">{title}</div>
    {children && <div className="text-xs text-muted max-w-sm">{children}</div>}
  </div>
);

// ---------------------------------------------------------------------------

export const MetricsDashboard: React.FC = () => {
  const { can, user } = useRole();
  const canViewAll = can('viewAllMetrics');

  // Live domain slices — the dashboard re-renders when any of these change,
  // in this tab or another. No manual snapshot into state.
  const finishedVideos = useFinishedVideos();
  const studioJobs = useStudioJobs();
  const users = useUsers();
  const config = useConfig();
  const deliveries = useStore(() => StorageService.getDriveDeliveries(), ['drive_deliveries']);

  // Manual refresh only nudges keyword-derived numbers (KeywordService bypasses
  // the reactive store); the reactive slices above already update on their own.
  const [refreshNonce, setRefreshNonce] = useState(0);

  const metrics = useMemo(
    () => MetricsService.getMetrics(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finishedVideos, studioJobs, users, config, deliveries, refreshNonce]
  );

  const deliveryRate =
    metrics.totalProduced > 0
      ? Math.min(100, Math.round((metrics.deliveredToDriveCount / metrics.totalProduced) * 100))
      : 0;

  const hasProduction = metrics.totalProduced > 0;

  const leaderboard = useMemo(
    () =>
      [...(metrics.vaProductivityList || [])].sort(
        (a, b) =>
          b.completedCount - a.completedCount ||
          (b.completedThisWeek || 0) - (a.completedThisWeek || 0)
      ),
    [metrics.vaProductivityList]
  );

  const ownStat = useMemo(
    () => (metrics.vaProductivityList || []).find((v) => v.userId === user.id),
    [metrics.vaProductivityList, user.id]
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="pro-panel p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-foreground" />
            <h1 className="text-base font-bold font-display text-foreground">
              Production &amp; VA Capacity Metrics
            </h1>
          </div>
          <p className="text-xs text-muted mt-0.5">
            {canViewAll
              ? 'Honest, live tracking of real production output, per-VA throughput, target progress, and Google Drive delivery. Zero means zero — nothing is fabricated.'
              : 'Your live production output and progress against your daily and weekly targets.'}
          </p>
        </div>

        <button
          onClick={() => setRefreshNonce((n) => n + 1)}
          className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 focus-ring"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* KPI Hero Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Total Produced"
          icon={<Video className="w-4 h-4 text-foreground" />}
          value={metrics.totalProduced}
          sub={
            hasProduction ? (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="w-3 h-3" />
                {metrics.producedThisWeek ?? 0} in the last {metrics.windowDays ?? 7} days
              </span>
            ) : (
              'No videos produced yet'
            )
          }
        />
        <KpiCard
          label="Generated Runtime"
          icon={<Clock className="w-4 h-4 text-warning" />}
          value={
            <>
              {metrics.totalDurationMinutes}
              <span className="text-sm font-normal text-muted"> min</span>
            </>
          }
          sub={
            metrics.totalDurationMinutes > 0
              ? `~${(metrics.totalDurationMinutes / 60).toFixed(1)} hours of content`
              : 'No runtime recorded yet'
          }
        />
        <KpiCard
          label="Delivered to Drive"
          icon={<FolderCheck className="w-4 h-4 text-success" />}
          value={<span className="text-success">{metrics.deliveredToDriveCount}</span>}
          sub={hasProduction ? `${deliveryRate}% of produced videos synced` : 'Awaiting first delivery'}
        />
        <KpiCard
          label="Active In Pipeline"
          icon={<HardDrive className="w-4 h-4 text-info" />}
          value={metrics.inProductionCount}
          sub={`${metrics.queuedCount.toLocaleString()} topics queued in pool`}
        />
      </div>

      {/* ============================ TEAM VIEW ============================ */}
      {canViewAll && (
        <>
          {/* Team capacity strip */}
          <div className="pro-panel p-4 rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <Gauge className="w-4 h-4 text-foreground" />
              <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
                Maximum Production Capability
              </h3>
            </div>
            {hasProduction ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg bg-surface-200 border border-border p-3">
                  <div className="text-xs text-muted uppercase font-mono flex items-center gap-1">
                    <Trophy className="w-3 h-3 text-warning" /> Best Day
                  </div>
                  <div className="text-xl font-bold font-mono text-foreground mt-1">
                    {metrics.teamBestDay?.count ?? 0}
                    <span className="text-xs font-normal text-muted"> videos</span>
                  </div>
                  <div className="text-xs text-muted">
                    {metrics.teamBestDay?.date ?? 'no data'}
                  </div>
                </div>
                <div className="rounded-lg bg-surface-200 border border-border p-3">
                  <div className="text-xs text-muted uppercase font-mono">Avg / Active Day</div>
                  <div className="text-xl font-bold font-mono text-foreground mt-1">
                    {metrics.teamAvgPerActiveDay ?? 0}
                  </div>
                  <div className="text-xs text-muted">across producing days</div>
                </div>
                <div className="rounded-lg bg-surface-200 border border-border p-3">
                  <div className="text-xs text-muted uppercase font-mono">Produced Today</div>
                  <div className="text-xl font-bold font-mono text-foreground mt-1">
                    {metrics.producedToday ?? 0}
                  </div>
                  <div className="text-xs text-muted">so far today</div>
                </div>
                <div className="rounded-lg bg-surface-200 border border-border p-3">
                  <div className="text-xs text-muted uppercase font-mono">Active Days</div>
                  <div className="text-xl font-bold font-mono text-foreground mt-1">
                    {metrics.teamActiveDays ?? 0}
                  </div>
                  <div className="text-xs text-muted">days with output</div>
                </div>
              </div>
            ) : (
              <EmptyHint icon={<Gauge className="w-5 h-5" />} title="No production capability data yet">
                Once videos are produced, this shows the team&apos;s observed best day and average
                daily output — the real ceiling to benchmark targets against.
              </EmptyHint>
            )}
          </div>

          {/* Velocity + Channels */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-7 pro-panel p-4 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
                  {metrics.windowDays ?? 7}-Day Production Velocity
                </h3>
                <span className="text-xs font-mono text-muted">videos completed / day</span>
              </div>
              <VelocityChart data={metrics.dailyVelocity} />
            </div>

            <div className="lg:col-span-5 pro-panel p-4 rounded-xl space-y-3">
              <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
                Channel Distribution
              </h3>
              <ChannelDistribution channelCounts={metrics.channelCounts} total={metrics.totalProduced} />
            </div>
          </div>

          {/* VA leaderboard with targets + capacity */}
          <div className="pro-panel rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-foreground" />
                <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
                  VA Leaderboard &mdash; Throughput &amp; Targets
                </h3>
              </div>
              <span className="text-xs font-mono text-muted">{leaderboard.length} operators</span>
            </div>

            {leaderboard.length === 0 ? (
              <EmptyHint title="No operators configured">
                Add VA accounts in Settings &rarr; Team to start tracking per-operator output.
              </EmptyHint>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {leaderboard.map((va, idx) => (
                  <VACard key={va.userId} va={va} rank={idx + 1} />
                ))}
              </div>
            )}
            <p className="text-xs text-muted flex items-start gap-1.5 pt-1">
              <Info className="w-3.5 h-3.5 mt-px flex-shrink-0" />
              <span>
                Completed counts come from each VA&apos;s COMPLETED keyword claims. Today/week
                progress and peak-day capacity require the producing surface to stamp the operator
                onto the video — VAs without attributed, dated production show honest zeros there.
              </span>
            </p>
          </div>

          {/* Drive delivery log */}
          <div className="pro-panel rounded-xl overflow-hidden shadow-card">
            <div className="p-3.5 bg-surface-200/60 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderCheck className="w-4 h-4 text-success" />
                <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
                  Google Drive Delivery Log
                </h3>
              </div>
              <span className="text-xs font-mono text-muted">{deliveries.length} files</span>
            </div>
            <DeliveryTable deliveries={deliveries} />
          </div>
        </>
      )}

      {/* ============================ OWN VIEW ============================ */}
      {!canViewAll && (
        <div className="pro-panel rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Target className="w-4 h-4 text-foreground" />
            <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
              My Output &amp; Targets
            </h3>
          </div>
          {ownStat ? (
            <div className="max-w-xl">
              <VACard va={ownStat} />
              <p className="text-xs text-muted flex items-start gap-1.5 pt-3">
                <Info className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                <span>
                  Completed reflects your COMPLETED keyword claims. Today/week progress and your
                  peak day appear once produced videos are attributed to you.
                </span>
              </p>
            </div>
          ) : (
            <EmptyHint title="No stats for your account yet">
              Claim and complete keywords in the Keyword Hub, and your productivity and target
              progress will appear here.
            </EmptyHint>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Velocity chart — readable bars, value labels, y-axis reference, a11y, empty state
// ---------------------------------------------------------------------------

const VelocityChart: React.FC<{ data: { date: string; count: number }[] }> = ({ data }) => {
  const maxVal = Math.max(...data.map((d) => d.count), 0);
  const total = data.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    return (
      <EmptyHint icon={<BarChart3 className="w-5 h-5" />} title="No production in this window">
        Bars will fill in here as videos are completed day by day.
      </EmptyHint>
    );
  }

  // Round the axis ceiling up to a friendly number for the reference line.
  const axisMax = Math.max(maxVal, 1);
  const midVal = Math.round(axisMax / 2);

  return (
    <div
      role="group"
      aria-label={`Daily production for the last ${data.length} days. Peak ${maxVal} videos in a day.`}
      className="flex gap-2"
    >
      {/* Y-axis reference */}
      <div className="flex flex-col justify-between items-end text-xs font-mono text-muted h-44 py-1 pr-1 select-none">
        <span>{axisMax}</span>
        <span>{midVal}</span>
        <span>0</span>
      </div>

      {/* Plot area */}
      <div className="flex-1 relative">
        {/* gridlines */}
        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
          <div className="border-t border-border" />
          <div className="border-t border-border/60" />
          <div className="border-t border-border" />
        </div>

        <div className="relative h-44 flex items-end justify-between gap-2 pt-6 pb-0.5">
          {data.map((day, idx) => {
            const heightPct = axisMax > 0 ? Math.round((day.count / axisMax) * 100) : 0;
            return (
              <div
                key={idx}
                className="flex-1 flex flex-col items-center justify-end h-full gap-1 group"
              >
                <span className="text-xs font-mono font-bold text-foreground">{day.count}</span>
                <div
                  className="w-full max-w-[36px] bg-accent group-hover:opacity-80 rounded-t transition-all"
                  style={{ height: `${day.count > 0 ? Math.max(heightPct, 3) : 0}%` }}
                  role="img"
                  aria-label={`${day.date}: ${day.count} video${day.count === 1 ? '' : 's'}`}
                />
              </div>
            );
          })}
        </div>

        {/* X-axis labels */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
          {data.map((day, idx) => (
            <span key={idx} className="flex-1 text-center text-xs font-mono text-muted">
              {day.date}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------

const ChannelDistribution: React.FC<{
  channelCounts: Record<string, number>;
  total: number;
}> = ({ channelCounts, total }) => {
  const entries = Object.entries(channelCounts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return (
      <EmptyHint icon={<Tv className="w-5 h-5" />} title="No channel output yet">
        Produced videos are grouped by channel here.
      </EmptyHint>
    );
  }
  const max = Math.max(...entries.map((e) => e[1]), 1);
  return (
    <div className="space-y-2.5">
      {entries.map(([name, count]) => (
        <div key={name} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-foreground truncate">
              <Tv className="w-3.5 h-3.5 text-muted flex-shrink-0" />
              {name}
            </span>
            <span className="font-mono text-muted flex-shrink-0">
              {count}
              {total > 0 && <span className="text-muted"> · {Math.round((count / total) * 100)}%</span>}
            </span>
          </div>
          <ProgressBar value={count} max={max} complete={false} />
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------

const VACard: React.FC<{ va: VAProductivityStat; rank?: number }> = ({ va, rank }) => {
  const hasAttributed = (va.activeDays || 0) > 0;
  return (
    <div className="rounded-xl border border-border bg-surface-100 p-3.5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {rank && <span className="text-xs font-mono font-bold text-muted">#{rank}</span>}
            <span className="font-bold text-foreground truncate">{va.name}</span>
            <span className={roleBadgeClass(va.role)}>{va.role}</span>
          </div>
          <div className="text-xs text-muted truncate">{va.email}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-2xl font-bold font-mono text-foreground leading-none">
            {va.completedCount}
          </div>
          <div className="text-xs text-muted uppercase font-mono">completed</div>
        </div>
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-surface-200 border border-border py-1.5">
          <div className="text-sm font-bold font-mono text-warning">{va.inProductionCount}</div>
          <div className="text-xs text-muted uppercase">Active</div>
        </div>
        <div className="rounded-lg bg-surface-200 border border-border py-1.5">
          <div className="text-sm font-bold font-mono text-foreground">
            {hasAttributed ? va.bestDayCount : '—'}
          </div>
          <div className="text-xs text-muted uppercase">Peak/Day</div>
        </div>
        <div className="rounded-lg bg-surface-200 border border-border py-1.5">
          <div className="text-sm font-bold font-mono text-foreground">
            {hasAttributed ? va.avgPerActiveDay : '—'}
          </div>
          <div className="text-xs text-muted uppercase">Avg/Day</div>
        </div>
      </div>

      {/* Target progress */}
      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted uppercase font-mono flex items-center gap-1">
              <Target className="w-3 h-3" /> Today
            </span>
            <span className="font-mono text-foreground">
              {va.completedToday ?? 0} / {va.dailyTarget ?? 0}
              <span className="text-muted"> ({va.dailyProgressPct ?? 0}%)</span>
            </span>
          </div>
          <ProgressBar value={va.completedToday ?? 0} max={va.dailyTarget ?? 0} />
        </div>
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted uppercase font-mono flex items-center gap-1">
              <CalendarDays className="w-3 h-3" /> This Week
            </span>
            <span className="font-mono text-foreground">
              {va.completedThisWeek ?? 0} / {va.weeklyTarget ?? 0}
              <span className="text-muted"> ({va.weeklyProgressPct ?? 0}%)</span>
            </span>
          </div>
          <ProgressBar value={va.completedThisWeek ?? 0} max={va.weeklyTarget ?? 0} />
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------

const DeliveryTable: React.FC<{ deliveries: ReturnType<typeof StorageService.getDriveDeliveries> }> = ({
  deliveries,
}) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-xs text-foreground">
      <thead className="bg-surface-200/40 text-xs uppercase font-mono font-bold text-muted border-b border-border">
        <tr>
          <th className="py-2.5 px-4">Title</th>
          <th className="py-2.5 px-3">Channel</th>
          <th className="py-2.5 px-3">Drive Path</th>
          <th className="py-2.5 px-3">Size</th>
          <th className="py-2.5 px-3">Delivered</th>
          <th className="py-2.5 px-4 text-right">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {deliveries.length === 0 ? (
          <tr>
            <td colSpan={6} className="text-center py-8 text-xs text-muted">
              No files delivered to Google Drive yet.
            </td>
          </tr>
        ) : (
          deliveries.map((del) => (
            <tr key={del.id} className="hover:bg-surface-200/40 transition-colors">
              <td className="py-2.5 px-4 font-medium text-foreground max-w-xs truncate">{del.title}</td>
              <td className="py-2.5 px-3 font-mono text-muted">{del.channel}</td>
              <td className="py-2.5 px-3 font-mono text-muted max-w-sm truncate">{del.drivePath}</td>
              <td className="py-2.5 px-3 font-mono text-muted">
                {(del.fileSize / (1024 * 1024)).toFixed(1)} MB
              </td>
              <td className="py-2.5 px-3 font-mono text-muted">{del.uploadedAt}</td>
              <td className="py-2.5 px-4 text-right">
                {del.status === 'IN_GOOGLE_DRIVE' ? (
                  <span className="badge badge-success">
                    <CheckCircle2 className="w-3 h-3" /> Synced
                  </span>
                ) : del.status === 'FAILED' ? (
                  <span className="badge badge-danger">Failed</span>
                ) : (
                  <span className="badge badge-warning">Delivering</span>
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);
