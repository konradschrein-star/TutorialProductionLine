'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSSE } from '@/hooks/use-sse';
import type { RecentActivity } from '@/lib/repositories/dashboard-repository';

/**
 * Activity Timeline Component
 *
 * Vertical timeline of recent system events with real-time updates.
 * Color-coded by severity, prepends new events as they arrive.
 */

interface ActivityTimelineProps {
  initialEvents: RecentActivity[];
}

function getEventSeverity(
  eventType: string
): 'info' | 'success' | 'warning' | 'error' {
  if (eventType.includes('failed') || eventType.includes('error'))
    return 'error';
  if (eventType.includes('completed') || eventType.includes('published'))
    return 'success';
  if (eventType.includes('paused') || eventType.includes('retry'))
    return 'warning';
  return 'info';
}

function formatEventType(eventType: string): string {
  return eventType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ActivityTimeline({ initialEvents }: ActivityTimelineProps) {
  const [events, setEvents] = useState<RecentActivity[]>(initialEvents);
  const { data } = useSSE();

  // Listen for new system events and prepend to list
  useEffect(() => {
    if (data && data.event_type && data.id) {
      const newEvent: RecentActivity = {
        id: data.id,
        eventType: data.event_type,
        jobId: data.job_id || null,
        payload: data.payload || null,
        timestamp: new Date(data.timestamp || Date.now()),
      };

      setEvents((prev) => {
        // Prevent duplicates
        if (prev.some((e) => e.id === newEvent.id)) {
          return prev;
        }
        // Prepend new event and keep only last 50
        return [newEvent, ...prev].slice(0, 50);
      });
    }
  }, [data]);

  if (events.length === 0) {
    return (
      <div className="glass rounded-lg p-8 border border-surface-bright text-center">
        <p className="text-text-muted">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-lg p-6 border border-surface-bright">
      <h3 className="text-wide-caps text-text-muted mb-4">
        Recent Activity
        <span className="ml-2 text-xs text-success">● Live</span>
      </h3>
      <div className="space-y-4 max-h-96 overflow-y-auto scrollbar-custom">
        {events.map((event) => {
          const severity = getEventSeverity(event.eventType);

          return (
            <div key={event.id} className="flex items-start space-x-3 animate-fadeIn">
              <Circle
                className={cn(
                  'w-2 h-2 mt-1.5 flex-shrink-0',
                  severity === 'info' && 'fill-primary text-primary',
                  severity === 'success' && 'fill-success text-success',
                  severity === 'warning' && 'fill-warning text-warning',
                  severity === 'error' && 'fill-error text-error'
                )}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text">
                  {formatEventType(event.eventType)}
                </p>
                {event.jobId && (
                  <p className="text-xs text-text-muted truncate">
                    Job: {event.jobId.slice(0, 8)}
                  </p>
                )}
                <p className="text-xs text-text-disabled">
                  {formatDistanceToNow(new Date(event.timestamp), {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
