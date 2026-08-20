'use client';

import { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Job Heatmap Component
 *
 * GitHub-style heatmap showing active (non-terminal) jobs as colored pixels.
 * Each cell links to the job detail page and shows a tooltip on hover.
 * Follows the "Obsidian Pulse" aesthetic standards.
 */

interface HeatmapJob {
  id: string;
  title: string;
  status: string;
  format: string;
  created_at: string;
}

interface JobHeatmapProps {
  jobs: HeatmapJob[];
  formatFilter?: string;
}

const STATUS_COLORS: Record<string, string> = {
  // Not started / queued
  CREATED: '#374151',
  QUEUED: '#374151',

  // Early pipeline
  IDEA_GENERATION: '#4b5e4b',
  SCRIPTING: '#4b5e4b',

  // Mid pipeline
  ASSET_COLLECTION: '#65a30d',

  // QMS & Routing
  QMS_VALIDATING: '#84cc16',
  ROUTING_RENDER: '#84cc16',

  // Rendering
  RENDERING_FFMPEG: '#22c55e',
  RENDERING_REMOTION: '#22c55e',

  // Awaiting human
  AWAITING_PRODUCTION_VA: '#f59e0b',
  AWAITING_QC: '#f59e0b',
  AWAITING_UPLOADER: '#f59e0b',

  // Upload
  UPLOADING: '#10b981',

  // Failed
  FAILED_QMS: '#ef4444',
  FAILED_RENDER: '#ef4444',
  FAILED_UPLOAD: '#ef4444',
  FAILED_GENERAL: '#ef4444',

  // Paused / Deletion
  PAUSED: '#6b7280',
  MARKED_FOR_DELETION: '#6b7280',
};

const LEGEND_ITEMS = [
  { label: 'Queued', color: '#374151' },
  { label: 'Early Pipeline', color: '#4b5e4b' },
  { label: 'Mid Pipeline', color: '#65a30d' },
  { label: 'QMS / Routing', color: '#84cc16' },
  { label: 'Rendering', color: '#22c55e' },
  { label: 'Awaiting Human', color: '#f59e0b' },
  { label: 'Uploading', color: '#10b981' },
  { label: 'Failed', color: '#ef4444' },
  { label: 'Paused', color: '#6b7280' },
];

function formatStatusText(status: string): string {
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#374151';
}

export function JobHeatmap({ jobs, formatFilter }: JobHeatmapProps) {
  const [hoveredJob, setHoveredJob] = useState<{
    job: HeatmapJob;
    x: number;
    y: number;
  } | null>(null);

  const sortedJobs = [...jobs].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <div className="glass rounded-lg p-6 border border-surface-bright">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-wide-caps text-text-muted">
          Active Jobs Heatmap ({sortedJobs.length} jobs)
        </h3>
        {formatFilter && (
          <span className="text-xs text-text-muted bg-surface-container px-2 py-1 rounded">
            {formatFilter}
          </span>
        )}
      </div>

      {sortedJobs.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-text-muted text-sm">No active jobs</p>
        </div>
      ) : (
        <>
          <div className="relative flex flex-wrap gap-[2px]">
            {sortedJobs.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="block"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredJob({
                    job,
                    x: rect.left + rect.width / 2,
                    y: rect.top,
                  });
                }}
                onMouseLeave={() => setHoveredJob(null)}
              >
                <div
                  className="w-3 h-3 rounded-sm transition-opacity hover:opacity-80"
                  style={{ backgroundColor: getStatusColor(job.status) }}
                />
              </Link>
            ))}

            {hoveredJob && (
              <div
                className="glass-panel fixed z-50 px-3 py-2 rounded-lg text-xs max-w-[220px] pointer-events-none"
                style={{
                  left: hoveredJob.x,
                  top: hoveredJob.y - 8,
                  transform: 'translate(-50%, -100%)',
                }}
              >
                <p className="text-text font-medium truncate">{hoveredJob.job.title}</p>
                <p className="text-text-muted mt-0.5">
                  {formatStatusText(hoveredJob.job.status)}
                </p>
                <p className="text-text-muted">{hoveredJob.job.format}</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-4 border-t border-surface-bright">
            {LEGEND_ITEMS.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-[10px] text-text-muted">{item.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
