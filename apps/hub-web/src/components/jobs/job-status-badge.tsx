import { cn } from '@/lib/utils';

/**
 * Job Status Badge
 *
 * Color-coded badge for all 23 job statuses.
 * Animated pulse for active states (RENDERING, UPLOADING, etc.).
 */

interface JobStatusBadgeProps {
  status: string;
  className?: string;
}

const STATUS_STYLES: Record<
  string,
  { bg: string; text: string; border: string; pulse?: boolean }
> = {
  // Initial / Ingestion
  IDEA_GENERATION: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
    pulse: true,
  },
  SCRIPTING: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
    pulse: true,
  },
  TRANSLATING: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
    pulse: true,
  },

  // Research Phase
  AWAITING_RESEARCH: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
  },
  RESEARCH_UPLOADED: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
  },

  // Asset Collection
  ASSET_COLLECTION: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
    pulse: true,
  },
  AWAITING_PRODUCTION_VA: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
  },
  AWAITING_IMAGE_QC: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
  },

  // QMS & Routing
  QMS_VALIDATING: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
    pulse: true,
  },
  ROUTING_RENDER: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
  },

  // Rendering
  RENDERING_FFMPEG: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
    pulse: true,
  },
  RENDERING_REMOTION: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
    pulse: true,
  },

  // QC & Upload
  AWAITING_QC: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
  },
  AWAITING_UPLOADER: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
  },
  UPLOADING: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
    pulse: true,
  },

  // Terminal States
  PUBLISHED: {
    bg: 'bg-success/10',
    text: 'text-success',
    border: 'border-success/20',
  },
  CANCELLED: {
    bg: 'bg-surface-bright',
    text: 'text-text-muted',
    border: 'border-surface-bright',
  },
  MARKED_FOR_DELETION: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
  },
  DELETED: {
    bg: 'bg-surface-container',
    text: 'text-text-disabled',
    border: 'border-surface-bright',
  },

  // Failed States
  FAILED_QMS: {
    bg: 'bg-error/10',
    text: 'text-error',
    border: 'border-error/20',
  },
  FAILED_RENDER: {
    bg: 'bg-error/10',
    text: 'text-error',
    border: 'border-error/20',
  },
  FAILED_UPLOAD: {
    bg: 'bg-error/10',
    text: 'text-error',
    border: 'border-error/20',
  },
  FAILED_GENERAL: {
    bg: 'bg-error/10',
    text: 'text-error',
    border: 'border-error/20',
  },
  FAILED_IRRECOVERABLE: {
    bg: 'bg-error/10',
    text: 'text-error',
    border: 'border-error/20',
  },

  // Paused
  PAUSED: {
    bg: 'bg-surface-bright',
    text: 'text-text-muted',
    border: 'border-surface-bright',
  },

  // Default fallback
  DEFAULT: {
    bg: 'bg-surface-bright',
    text: 'text-text-muted',
    border: 'border-surface-bright',
  },
};

function formatStatusText(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) =>
    c.toUpperCase()
  );
}

export function JobStatusBadge({ status, className }: JobStatusBadgeProps) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.DEFAULT;

  return (
    <span
      className={cn(
        'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border',
        style.bg,
        style.text,
        style.border,
        style.pulse && 'animate-pulse-slow',
        className
      )}
    >
      {formatStatusText(status)}
    </span>
  );
}
