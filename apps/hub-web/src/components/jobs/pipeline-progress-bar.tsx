import { cn } from '@/lib/utils';

/**
 * Pipeline Progress Bar Component
 *
 * Shows overall pipeline completion as a large progress bar with stats.
 * Server component — no client-side interactivity needed.
 * Follows the "Obsidian Pulse" aesthetic standards.
 */

interface PipelineProgressBarProps {
  totalJobs: number;
  completedJobs: number;
  activeJobs: number;
  estimatedHoursRemaining: number | null;
}

export function PipelineProgressBar({
  totalJobs,
  completedJobs,
  activeJobs,
  estimatedHoursRemaining,
}: PipelineProgressBarProps) {
  if (totalJobs === 0) {
    return (
      <div className="glass-card p-5 rounded-xl">
        <h3 className="text-wide-caps text-text-muted mb-3">Pipeline Overview</h3>
        <p className="text-sm text-text-muted">No jobs in the pipeline</p>
      </div>
    );
  }

  const percentage = Math.round((completedJobs / totalJobs) * 100);

  return (
    <div className="glass-card p-5 rounded-xl">
      <h3 className="text-wide-caps text-text-muted mb-3">Pipeline Overview</h3>

      <div className="h-3 bg-surface-container rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full bg-primary rounded-full transition-all duration-500',
            percentage > 0 && 'min-w-[4px]'
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
        <span className="text-text font-semibold">{percentage}% complete</span>
        <span className="text-text-muted/40">|</span>
        <span>{activeJobs} active</span>
        {estimatedHoursRemaining !== null && (
          <>
            <span className="text-text-muted/40">|</span>
            <span>~{estimatedHoursRemaining}h remaining</span>
          </>
        )}
      </div>
    </div>
  );
}
