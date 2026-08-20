import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Render Counter Component
 *
 * Displays jobs currently being rendered with progress estimation.
 * Server component — elapsed time is computed at render time.
 * Follows the "Obsidian Pulse" aesthetic standards.
 */

interface RenderingJob {
  id: string;
  title: string;
  render_engine: string | null;
  render_started_at: string | null;
  target_duration_seconds: number | null;
  format: string;
}

interface RenderCounterProps {
  jobs: RenderingJob[];
}

/**
 * Estimate render progress as a rough percentage.
 * Heuristic: assume render time is ~1/3 of target duration for FFmpeg,
 * ~1/2 for Remotion. If no target, treat as indeterminate.
 * Caps at 99% since we cannot know true completion from time alone.
 */
function estimateProgress(job: RenderingJob, now: Date): number | null {
  if (!job.render_started_at) return null;

  const started = new Date(job.render_started_at);
  const elapsedMs = now.getTime() - started.getTime();
  const elapsedMinutes = elapsedMs / 60_000;

  if (!job.target_duration_seconds) return null;

  const targetMinutes = job.target_duration_seconds / 60;
  const renderFactor = job.render_engine === 'REMOTION' ? 0.5 : 0.33;
  const estimatedMinutes = targetMinutes * renderFactor;

  if (estimatedMinutes <= 0) return null;

  const pct = Math.round((elapsedMinutes / estimatedMinutes) * 100);
  return Math.min(pct, 99);
}

function formatElapsed(startedAt: string, now: Date): string {
  const started = new Date(startedAt);
  const diffMs = now.getTime() - started.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '\u2026';
}

export function RenderCounter({ jobs }: RenderCounterProps) {
  const now = new Date();

  return (
    <div className="glass-card p-5 rounded-xl">
      <h3 className="text-wide-caps text-text-muted mb-3">
        Rendering Now:{' '}
        <span className="text-primary">{jobs.length}</span>{' '}
        {jobs.length === 1 ? 'job' : 'jobs'}
      </h3>

      {jobs.length === 0 ? (
        <p className="text-sm text-text-muted">No active renders</p>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const progress = estimateProgress(job, now);
            const engineLabel = job.render_engine ?? 'UNKNOWN';

            return (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="block p-3 bg-surface-container rounded-lg hover:bg-surface-bright/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-text truncate mr-2">
                    {truncate(job.title, 30)}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        'text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded',
                        engineLabel === 'FFMPEG' && 'bg-primary/10 text-primary',
                        engineLabel === 'REMOTION' && 'bg-warning/10 text-warning',
                        engineLabel === 'UNKNOWN' && 'bg-surface-bright text-text-muted'
                      )}
                    >
                      {engineLabel}
                    </span>
                    {job.render_started_at && (
                      <span className="text-[10px] text-text-muted">
                        {formatElapsed(job.render_started_at, now)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="h-1.5 bg-surface-bright rounded-full overflow-hidden">
                  {progress !== null ? (
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  ) : (
                    <div className="h-full w-full bg-primary/20 rounded-full animate-pulse" />
                  )}
                </div>

                {progress !== null && (
                  <div className="mt-1 text-[10px] text-text-muted text-right">
                    ~{progress}%
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
