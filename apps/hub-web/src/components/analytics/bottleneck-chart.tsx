/**
 * Pipeline Bottleneck Chart - V2 Styling
 *
 * Horizontal bar chart showing average time per pipeline stage.
 * Highlights the slowest stage.
 */

interface StageBottleneck {
  stage: string;
  avg_time_seconds: number;
  job_count: number;
}

interface BottleneckChartProps {
  stages: StageBottleneck[];
}

function formatStageName(stage: string): string {
  return stage
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function BottleneckChart({ stages }: BottleneckChartProps) {
  if (stages.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(205,195,215,0.4)', fontSize: 12 }}>
        No active stages
      </div>
    );
  }

  const maxTime = Math.max(...stages.map((s) => s.avg_time_seconds), 1);
  const slowestStage = stages[0]?.stage;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {stages.map((stage) => {
        const widthPercent = (stage.avg_time_seconds / maxTime) * 100;
        const isSlowest = stage.stage === slowestStage;

        return (
          <div key={stage.stage}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: isSlowest ? '#f97316' : '#e5e2e1',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {formatStageName(stage.stage)}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 10, color: 'rgba(205,195,215,0.5)' }}>
                  {stage.job_count} job{stage.job_count !== 1 ? 's' : ''}
                </span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: isSlowest ? '#f97316' : 'rgba(205,195,215,0.6)',
                }}>
                  {formatDuration(stage.avg_time_seconds)}
                </span>
              </div>
            </div>
            <div style={{
              height: 8,
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 4,
              overflow: 'hidden',
            }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.max(widthPercent, 2)}%`,
                  background: isSlowest ? '#f97316' : 'var(--v2-accent)',
                  borderRadius: 4,
                  transition: 'all 0.3s',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
