import { notFound } from "next/navigation";
import { Cpu, Clock, Zap, TrendingUp } from "lucide-react";
import { V2Card, V2MetaField } from "../../_components";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RenderTimeDistributionChart } from "@/components/analytics/render-time-distribution";
import { RenderJobsPerHourChart } from "@/components/analytics/render-jobs-per-hour";
import { SystemMetricsPlaceholder } from "@/components/analytics/system-metrics-placeholder";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "../../_lib/v2-auth";
import {
  getRenderMetrics,
  getRenderTimeDistribution,
  getRenderJobsPerHour,
} from "@/lib/repositories/analytics-repository";

/**
 * V2 Render Performance Analytics Page
 *
 * Monitors render worker health, utilization, and performance.
 * Shows both job-level metrics (from DB) and system-level placeholders
 * (CPU temp, load, utilization - to be collected later).
 */

interface RenderAnalyticsPageProps {
  searchParams: Promise<{
    days?: string;
  }>;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "N/A";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export default async function V2RenderAnalyticsPage({
  searchParams,
}: RenderAnalyticsPageProps) {
  const params = await searchParams;
  const session = await getSession();

  if (!hasPermission(session, "view:analytics")) {
    notFound();
  }

  const days = parseInt(params.days || "30", 10);

  // Fetch render metrics in parallel
  const [metrics, timeDistribution, jobsPerHour] = await Promise.all([
    getRenderMetrics(days),
    getRenderTimeDistribution(days),
    getRenderJobsPerHour(Math.min(days, 7)), // Last 7 days for hourly chart
  ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "var(--v2-text-1)",
              margin: "0 0 6px 0",
            }}
          >
            Render Performance
          </h1>
          <p style={{ fontSize: 13, color: "var(--v2-text-2)", margin: 0 }}>
            Worker health and render utilization over the last {days} days
          </p>
        </div>

        {/* Date range filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`/analytics/render?days=${d}`}
              className={d === days ? "v2-btn-accent" : "v2-btn"}
              style={{
                padding: "6px 14px",
                fontSize: 11,
                textDecoration: "none",
              }}
            >
              {d}d
            </a>
          ))}
        </div>
      </div>

      {/* Top-line KPI Metrics */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
        }}
      >
        <MetricCard
          title="Avg Render Time"
          value={formatDuration(metrics.avg_render_time_seconds)}
          subtitle={`${metrics.total_renders} completed`}
          icon={Clock}
          variant="primary"
        />
        <MetricCard
          title="Fastest Render"
          value={formatDuration(metrics.min_render_time_seconds)}
          subtitle="minimum duration"
          icon={Zap}
          variant="success"
        />
        <MetricCard
          title="Slowest Render"
          value={formatDuration(metrics.max_render_time_seconds)}
          subtitle="maximum duration"
          icon={TrendingUp}
          variant="warning"
        />
        <MetricCard
          title="Renders Today"
          value={metrics.renders_today}
          subtitle={`${metrics.renders_per_hour_avg.toFixed(2)}/hour avg`}
          icon={Cpu}
          variant="default"
        />
      </div>

      {/* Render Time Distribution */}
      <RenderTimeDistributionChart data={timeDistribution} />

      {/* Render Jobs Per Hour */}
      <RenderJobsPerHourChart data={jobsPerHour} />

      {/* System Metrics Placeholder */}
      <SystemMetricsPlaceholder />
    </div>
  );
}
