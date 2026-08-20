'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, Trash2, RefreshCw } from 'lucide-react';
import { JobStatusBadge } from '@/components/jobs/job-status-badge';
import { deleteJob } from '@/app/actions/jobs';

/**
 * Pipeline stage order for progress bar calculation.
 * Maps each status to a 0-100 progress value.
 */
const PIPELINE_PROGRESS: Record<string, number | null> = {
  IDEA_GENERATION: 5,
  SCRIPTING: 10,
  ASSET_COLLECTION: 20,
  AWAITING_PRODUCTION_VA: 30,
  AWAITING_IMAGE_QC: 40,
  QMS_VALIDATING: 50,
  ROUTING_RENDER: 55,
  RENDERING_FFMPEG: 65,
  RENDERING_REMOTION: 65,
  AWAITING_QC: 80,
  AWAITING_UPLOADER: 88,
  UPLOADING: 94,
  PUBLISHED: 100,
  // Terminal / paused
  PAUSED: null,
  CANCELLED: null,
  DELETED: null,
  FAILED_QMS: null,
  FAILED_RENDER: null,
  FAILED_UPLOAD: null,
  FAILED_GENERAL: null,
  MARKED_FOR_DELETION: null,
};

const TERMINAL_STATUSES = new Set([
  'PUBLISHED', 'CANCELLED', 'DELETED',
  'FAILED_QMS', 'FAILED_RENDER', 'FAILED_UPLOAD', 'FAILED_GENERAL',
  'MARKED_FOR_DELETION',
]);

const FAILED_STATUSES = new Set([
  'FAILED_QMS', 'FAILED_RENDER', 'FAILED_UPLOAD', 'FAILED_GENERAL',
]);

export interface RecentJob {
  id: string;
  title: string;
  status: string;
  channel_name: string | null;
  template_name: string | null;
  created_at: string;
  updated_at: string;
}

interface RecentJobsPollerProps {
  format: string;
  initialJobs: RecentJob[];
}

const POLL_INTERVAL_MS = 5_000;

export function RecentJobsPoller({ format, initialJobs }: RecentJobsPollerProps) {
  const [jobs, setJobs] = useState<RecentJob[]>(initialJobs);
  const [polling, setPolling] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchJobs = useCallback(async (showSpinner = false) => {
    if (showSpinner) setPolling(true);
    try {
      const res = await fetch(`/api/jobs/recent?format=${encodeURIComponent(format)}&limit=20`, {
        credentials: 'same-origin',
      });
      if (res.ok) {
        const data: RecentJob[] = await res.json();
        setJobs(data);
        setLastUpdated(new Date());
      }
    } catch {
      // silent — keep stale data
    } finally {
      if (showSpinner) setPolling(false);
    }
  }, [format]);

  // Schedule recurring poll
  useEffect(() => {
    function schedule() {
      timerRef.current = setTimeout(async () => {
        await fetchJobs(false);
        schedule();
      }, POLL_INTERVAL_MS);
    }

    schedule();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchJobs]);

  async function handleDelete(job: RecentJob) {
    if (!confirm(`Delete "${job.title || 'this job'}"? This cannot be undone.`)) return;
    setDeletingId(job.id);
    const result = await deleteJob(job.id);
    if (result.success) {
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    } else {
      alert(result.error ?? 'Failed to delete job');
    }
    setDeletingId(null);
  }

  // Determine if any job is still active (drives showing the live indicator)
  const hasActiveJobs = jobs.some((j) => !TERMINAL_STATUSES.has(j.status) && j.status !== 'PAUSED');

  return (
    <div className="glass rounded-lg p-6 border border-surface-bright">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-wide-caps text-text-muted">Recent Jobs</h3>
          {hasActiveJobs && (
            <span className="flex items-center gap-1 text-[10px] text-success font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-text-disabled">
            {formatDistanceToNow(lastUpdated, { addSuffix: true })}
          </span>
          <button
            onClick={() => fetchJobs(true)}
            disabled={polling}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors disabled:opacity-50"
            title="Refresh now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${polling ? 'animate-spin' : ''}`} />
          </button>
          <Link
            href={`/jobs?format=${format}`}
            className="text-xs text-primary hover:text-primary/80 transition-colors"
          >
            View All
          </Link>
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">
          No jobs yet for this format
        </p>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onDelete={() => handleDelete(job)}
              deleting={deletingId === job.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function JobRow({
  job,
  onDelete,
  deleting,
}: {
  job: RecentJob;
  onDelete: () => void;
  deleting: boolean;
}) {
  const progress = PIPELINE_PROGRESS[job.status] ?? null;
  const isFailed = FAILED_STATUSES.has(job.status);
  const isPublished = job.status === 'PUBLISHED';
  const isTerminal = TERMINAL_STATUSES.has(job.status);

  return (
    <div className="rounded-lg bg-surface-container/50 border border-surface-bright/50 px-4 py-3 hover:bg-surface-bright/20 transition-colors">
      <div className="flex items-center gap-3">
        {/* Title + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Link
              href={`/jobs/${job.id}`}
              className="text-sm font-medium text-text hover:text-primary transition-colors truncate"
            >
              {job.title || 'Untitled'}
            </Link>
            <JobStatusBadge status={job.status} />
          </div>
          <div className="flex items-center gap-2 text-[10px] text-text-muted">
            {job.channel_name && <span>{job.channel_name}</span>}
            {job.channel_name && job.template_name && <span>·</span>}
            {job.template_name && <span>{job.template_name}</span>}
            <span>·</span>
            <span>{formatDistanceToNow(new Date(job.updated_at), { addSuffix: true })}</span>
          </div>
        </div>

        {/* Delete */}
        <div className="shrink-0">
          {deleting ? (
            <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
          ) : (
            <button
              onClick={onDelete}
              className="p-1 text-text-muted hover:text-error transition-colors rounded"
              title="Delete job"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {!isTerminal && progress !== null && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-text-muted font-mono">{progress}%</span>
          </div>
          <div className="h-1 rounded-full bg-surface-bright overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progress}%`,
                background: 'linear-gradient(to right, hsl(var(--primary)), hsl(var(--primary-700)))',
              }}
            />
          </div>
        </div>
      )}

      {isPublished && (
        <div className="mt-2 h-1 rounded-full bg-success/30 overflow-hidden">
          <div className="h-full rounded-full bg-success" style={{ width: '100%' }} />
        </div>
      )}

      {isFailed && (
        <div className="mt-2 h-1 rounded-full bg-error/30 overflow-hidden">
          <div className="h-full rounded-full bg-error" style={{ width: '100%' }} />
        </div>
      )}
    </div>
  );
}
