import { Thermometer, Cpu, Activity, AlertCircle } from 'lucide-react';

/**
 * System Metrics Placeholder
 *
 * Placeholder component for future system-level metrics collection.
 * Documents what metrics should be collected and how they would be displayed.
 *
 * Future metrics to collect:
 * - CPU temperature (via lm-sensors or /sys/class/thermal)
 * - System load average (1m, 5m, 15m)
 * - CPU utilization percentage
 * - Memory usage
 * - Disk I/O
 *
 * Implementation approach:
 * 1. Create a background worker that collects system metrics every 60 seconds
 * 2. Store metrics in a new `system_metrics` table with timestamp + readings
 * 3. Create repository functions to query time-series data
 * 4. Replace this placeholder with real charts
 */

export function SystemMetricsPlaceholder() {
  return (
    <div className="glass rounded-lg p-6 border border-surface-bright">
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="w-5 h-5 text-warning" />
        <h3 className="text-wide-caps text-text-muted">System Metrics - Coming Soon</h3>
      </div>

      <p className="text-sm text-text-muted mb-6">
        System-level metrics are not yet collected. The following metrics will be added in a future update:
      </p>

      {/* Metric placeholders */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* CPU Temperature */}
        <div className="bg-surface-container rounded-lg p-4 border border-surface-bright/50">
          <div className="flex items-center gap-2 mb-2">
            <Thermometer className="w-4 h-4 text-warning" />
            <span className="text-xs font-semibold text-text uppercase tracking-widest">
              CPU Temperature
            </span>
          </div>
          <p className="text-2xl font-bold text-text-muted/40">--°C</p>
          <p className="text-[10px] text-text-muted mt-2">
            Monitors thermal conditions to prevent overheating
          </p>
        </div>

        {/* System Load */}
        <div className="bg-surface-container rounded-lg p-4 border border-surface-bright/50">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-text uppercase tracking-widest">
              System Load
            </span>
          </div>
          <p className="text-2xl font-bold text-text-muted/40">-- / -- / --</p>
          <p className="text-[10px] text-text-muted mt-2">
            1m / 5m / 15m load average
          </p>
        </div>

        {/* Render Capacity Utilization */}
        <div className="bg-surface-container rounded-lg p-4 border border-surface-bright/50">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-success" />
            <span className="text-xs font-semibold text-text uppercase tracking-widest">
              Capacity Utilization
            </span>
          </div>
          <p className="text-2xl font-bold text-text-muted/40">--%</p>
          <p className="text-[10px] text-text-muted mt-2">
            Target: 100% when jobs are queued
          </p>
        </div>
      </div>

      {/* Implementation notes */}
      <div className="mt-6 bg-surface-container/50 rounded-lg p-4 border border-primary/20">
        <h4 className="text-xs font-bold text-primary uppercase tracking-widest mb-2">
          Implementation Roadmap
        </h4>
        <ul className="space-y-1 text-xs text-text-muted">
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            <span>
              <strong>CPU Temperature:</strong> Read from <code className="text-[10px] bg-surface-bright px-1 py-0.5 rounded">/sys/class/thermal/thermal_zone*/temp</code> on Linux
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            <span>
              <strong>System Load:</strong> Parse <code className="text-[10px] bg-surface-bright px-1 py-0.5 rounded">/proc/loadavg</code> or use <code className="text-[10px] bg-surface-bright px-1 py-0.5 rounded">os.loadavg()</code> in Node.js
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            <span>
              <strong>Utilization:</strong> Calculate as <code className="text-[10px] bg-surface-bright px-1 py-0.5 rounded">(active_render_workers / total_render_capacity) × 100</code>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            <span>
              <strong>Storage:</strong> Create <code className="text-[10px] bg-surface-bright px-1 py-0.5 rounded">system_metrics</code> table with timestamp, metric_type, value columns
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            <span>
              <strong>Collection:</strong> Background worker with 60-second interval, store in PostgreSQL via TimescaleDB or simple INSERT
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
