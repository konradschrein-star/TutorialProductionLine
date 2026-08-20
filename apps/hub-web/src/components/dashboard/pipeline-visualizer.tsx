import { cn } from '@/lib/utils';
import type { PipelineStageCount } from '@/lib/repositories/dashboard-repository';

/**
 * Pipeline Visualizer Component
 *
 * Horizontal swimlane showing job counts at each pipeline stage.
 * Color-coded by status (purple: active, gray: waiting, red: failed).
 */

interface PipelineVisualizerProps {
  stages: PipelineStageCount[];
}

function formatStageName(stage: string): string {
  return stage
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PipelineVisualizer({ stages }: PipelineVisualizerProps) {
  if (stages.length === 0) {
    return (
      <div className="glass rounded-lg p-8 border border-surface-bright text-center">
        <p className="text-text-muted">No active jobs in pipeline</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-lg p-6 border border-surface-bright">
      <h3 className="text-wide-caps text-text-muted mb-4">Active Pipeline</h3>
      <div className="space-y-3">
        {stages.map((stage) => {
          const isActive = stage.status === 'active';
          const isFailed = stage.status === 'failed';

          return (
            <div key={stage.stage} className="flex items-center space-x-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-text truncate">
                    {formatStageName(stage.stage)}
                  </span>
                  <span
                    className={cn(
                      'text-sm font-semibold',
                      isActive && 'text-primary',
                      isFailed && 'text-error',
                      !isActive && !isFailed && 'text-text-muted'
                    )}
                  >
                    {stage.count}
                  </span>
                </div>
                <div className="h-2 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full transition-all duration-300',
                      isActive && 'bg-primary',
                      isFailed && 'bg-error',
                      !isActive && !isFailed && 'bg-surface-bright'
                    )}
                    style={{ width: `${Math.min(stage.count * 10, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
