import { Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QueueMetrics } from '@/lib/services/queue-service';

/**
 * Queue Health Widget
 *
 * Displays health status for all BullMQ queues.
 * Shows waiting, active, failed counts and health indicator.
 */

interface QueueHealthWidgetProps {
  queues: QueueMetrics[];
}

function getHealthStatus(metrics: QueueMetrics): 'healthy' | 'warning' | 'error' {
  if (metrics.failed > 10) return 'error';
  if (metrics.waiting > 100) return 'warning';
  if (metrics.paused) return 'error';
  return 'healthy';
}

function formatQueueName(name: string): string {
  return name.replace('queue:', '').replace(/-/g, ' ').toUpperCase();
}

export function QueueHealthWidget({ queues }: QueueHealthWidgetProps) {
  return (
    <div className="glass rounded-lg p-6 border border-surface-bright">
      <h3 className="text-wide-caps text-text-muted mb-4">Queue Health</h3>
      <div className="space-y-4">
        {queues.map((queue) => {
          const health = getHealthStatus(queue);

          return (
            <div key={queue.name} className="flex items-center space-x-4">
              <Circle
                className={cn(
                  'w-3 h-3 flex-shrink-0',
                  health === 'healthy' && 'fill-success text-success',
                  health === 'warning' && 'fill-warning text-warning',
                  health === 'error' && 'fill-error text-error'
                )}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text truncate">
                  {formatQueueName(queue.name)}
                </p>
                <div className="flex items-center space-x-3 mt-1">
                  <span className="text-xs text-text-muted">
                    Waiting: {queue.waiting}
                  </span>
                  <span className="text-xs text-text-muted">
                    Active: {queue.active}
                  </span>
                  {queue.failed > 0 && (
                    <span className="text-xs text-error">
                      Failed: {queue.failed}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
