'use client';

/**
 * Render Time Distribution Chart
 *
 * Histogram showing distribution of render times across buckets.
 * CSS-based bar chart, no external charting library.
 */

interface RenderTimeDistribution {
  bucket_label: string;
  count: number;
}

interface RenderTimeDistributionChartProps {
  data: RenderTimeDistribution[];
}

export function RenderTimeDistributionChart({ data }: RenderTimeDistributionChartProps) {
  if (data.length === 0) {
    return (
      <div className="glass rounded-lg p-6 border border-surface-bright">
        <h3 className="text-wide-caps text-text-muted mb-4">Render Time Distribution</h3>
        <p className="text-sm text-text-muted text-center py-8">No render data available</p>
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="glass rounded-lg p-6 border border-surface-bright">
      <h3 className="text-wide-caps text-text-muted mb-4">Render Time Distribution</h3>
      <p className="text-xs text-text-muted mb-6">
        Distribution of render times across duration buckets
      </p>

      <div className="flex items-end gap-3 h-48">
        {data.map((bucket) => {
          const heightPercent = (bucket.count / maxCount) * 100;

          return (
            <div key={bucket.bucket_label} className="flex-1 flex flex-col items-center gap-2 group relative">
              <div className="w-full flex items-end h-40">
                <div
                  className="w-full bg-primary rounded-t transition-all duration-300 group-hover:bg-primary/80 flex items-end justify-center pb-2"
                  style={{ height: `${Math.max(heightPercent, 4)}%` }}
                >
                  {bucket.count > 0 && (
                    <span className="text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">
                      {bucket.count}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-[9px] text-text-muted text-center leading-tight">
                {bucket.bucket_label}
              </span>

              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 glass-panel rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap">
                <p className="text-[10px] text-text font-medium">{bucket.bucket_label}</p>
                <p className="text-[10px] text-primary">Count: {bucket.count}</p>
                <p className="text-[10px] text-text-muted">
                  {((bucket.count / data.reduce((sum, d) => sum + d.count, 0)) * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
