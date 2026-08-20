'use client';

/**
 * Render Jobs Per Hour Chart
 *
 * Time series showing render completion rate over time (hourly granularity).
 * CSS-based bar chart, no external charting library.
 */

interface RenderJobsPerHour {
  hour: string; // YYYY-MM-DD HH:00:00
  render_count: number;
}

interface RenderJobsPerHourChartProps {
  data: RenderJobsPerHour[];
}

function formatHourLabel(hourString: string): string {
  // Convert "YYYY-MM-DD HH:00:00" to "MM-DD HH"
  const date = new Date(hourString);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  return `${month}-${day} ${hour}h`;
}

export function RenderJobsPerHourChart({ data }: RenderJobsPerHourChartProps) {
  if (data.length === 0) {
    return (
      <div className="glass rounded-lg p-6 border border-surface-bright">
        <h3 className="text-wide-caps text-text-muted mb-4">Render Jobs Per Hour</h3>
        <p className="text-sm text-text-muted text-center py-8">No hourly data available</p>
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.render_count), 1);

  // Show last 48 hours max to keep readable
  const displayData = data.slice(-48);

  return (
    <div className="glass rounded-lg p-6 border border-surface-bright">
      <h3 className="text-wide-caps text-text-muted mb-4">Render Jobs Per Hour</h3>
      <p className="text-xs text-text-muted mb-6">
        Hourly render completion rate (last {displayData.length} hours)
      </p>

      <div className="flex items-end gap-0.5 h-40 overflow-x-auto scrollbar-custom">
        {displayData.map((hourData) => {
          const heightPercent = (hourData.render_count / maxCount) * 100;
          const label = formatHourLabel(hourData.hour);

          return (
            <div key={hourData.hour} className="flex flex-col items-center gap-1 group relative min-w-[20px]">
              <div className="w-full flex items-end h-32">
                <div
                  className="w-full bg-success rounded-t transition-all duration-300 group-hover:bg-success/80"
                  style={{ height: `${Math.max(heightPercent, 2)}%`, minHeight: hourData.render_count > 0 ? '4px' : '0' }}
                />
              </div>
              <span className="text-[8px] text-text-muted transform -rotate-45 origin-top-left whitespace-nowrap">
                {label}
              </span>

              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 glass-panel rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap">
                <p className="text-[10px] text-text font-medium">{hourData.hour}</p>
                <p className="text-[10px] text-success">Renders: {hourData.render_count}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
