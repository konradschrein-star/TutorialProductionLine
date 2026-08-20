import { cn } from '@/lib/utils';

/**
 * Job Stage Progress
 *
 * Compact horizontal step indicator showing where a job is in the pipeline.
 * - Completed stages: filled lime dot
 * - Current stage: larger highlighted lime dot with ring
 * - Future stages: dim dots
 * - FAILED_* status: current stage dot in red
 * - PAUSED: current stage dot in amber
 * - CANCELLED / DELETED: terminal red state
 */

const PIPELINE_STAGES = [
  { key: 'IDEA_GENERATION', label: 'Idea' },
  { key: 'SCRIPTING', label: 'Script' },
  { key: 'TRANSLATING', label: 'Translate' },
  { key: 'ASSET_COLLECTION', label: 'Assets' },
  { key: 'AWAITING_PRODUCTION_VA', label: 'Production VA' },
  { key: 'AWAITING_IMAGE_QC', label: 'Image QC' },
  { key: 'QMS_VALIDATING', label: 'QMS' },
  { key: 'ROUTING_RENDER', label: 'Route' },
  { key: 'RENDERING', label: 'Render' },
  { key: 'AWAITING_QC', label: 'QC' },
  { key: 'AWAITING_UPLOADER', label: 'Uploader' },
  { key: 'UPLOADING', label: 'Upload' },
  { key: 'PUBLISHED', label: 'Published' },
] as const;

type StageKey = (typeof PIPELINE_STAGES)[number]['key'];

/** Map a raw job status to a canonical stage key (or null for unmapped states). */
function resolveStageKey(status: string): StageKey | null {
  if (status === 'RENDERING_FFMPEG' || status === 'RENDERING_REMOTION') {
    return 'RENDERING';
  }
  const match = PIPELINE_STAGES.find((s) => s.key === status);
  return match ? match.key : null;
}

/** Return the index of a stage key in the pipeline, or -1. */
function stageIndex(key: StageKey | null): number {
  if (key === null) return -1;
  return PIPELINE_STAGES.findIndex((s) => s.key === key);
}

type StageState = 'completed' | 'current' | 'failed' | 'paused' | 'future';

interface JobStageProgressProps {
  status: string;
}

export function JobStageProgress({ status }: JobStageProgressProps) {
  const isFailed = status.startsWith('FAILED_');
  const isCancelled = status === 'CANCELLED' || status === 'DELETED';
  const isPaused = status === 'PAUSED';

  // For PAUSED, we resolve against the pre-pause status via the status itself
  // (we don't have paused_from_status here, but PAUSED is shown at its own position)
  const currentKey = resolveStageKey(status);
  const currentIdx = stageIndex(currentKey);

  function getState(idx: number, key: StageKey): StageState {
    if (isCancelled) {
      if (currentIdx === -1) return 'future';
      return idx < currentIdx ? 'completed' : idx === currentIdx ? 'failed' : 'future';
    }
    if (isFailed) {
      if (currentIdx === -1) return 'future';
      return idx < currentIdx ? 'completed' : idx === currentIdx ? 'failed' : 'future';
    }
    if (isPaused) {
      if (currentIdx === -1) return 'future';
      return idx < currentIdx ? 'completed' : idx === currentIdx ? 'paused' : 'future';
    }
    if (key === 'PUBLISHED' && status === 'PUBLISHED') return 'current';
    if (currentIdx === -1) return 'future';
    return idx < currentIdx ? 'completed' : idx === currentIdx ? 'current' : 'future';
  }

  return (
    <div className="flex items-center gap-0 overflow-x-auto py-1 scrollbar-none">
      {PIPELINE_STAGES.map((stage, idx) => {
        const state = getState(idx, stage.key);
        const isLast = idx === PIPELINE_STAGES.length - 1;

        return (
          <div key={stage.key} className="flex items-center shrink-0">
            {/* Step dot + label */}
            <div className="flex flex-col items-center gap-1 min-w-[52px]">
              <div
                className={cn(
                  'rounded-full transition-all duration-200',
                  state === 'completed' && 'w-2 h-2 bg-lime-400',
                  state === 'current' && 'w-3 h-3 bg-lime-400 ring-2 ring-lime-400/30',
                  state === 'failed' && 'w-3 h-3 bg-red-500 ring-2 ring-red-500/30',
                  state === 'paused' && 'w-3 h-3 bg-amber-400 ring-2 ring-amber-400/30',
                  state === 'future' && 'w-2 h-2 bg-surface-bright'
                )}
              />
              <span
                className={cn(
                  'text-[9px] font-medium leading-none text-center whitespace-nowrap',
                  state === 'completed' && 'text-lime-400/70',
                  state === 'current' && 'text-lime-400',
                  state === 'failed' && 'text-red-400',
                  state === 'paused' && 'text-amber-400',
                  state === 'future' && 'text-text-disabled'
                )}
              >
                {stage.label}
              </span>
            </div>

            {/* Connector line between dots */}
            {!isLast && (
              <div
                className={cn(
                  'h-px w-4 mx-0.5 shrink-0',
                  idx < (currentIdx === -1 ? -1 : currentIdx)
                    ? 'bg-lime-400/40'
                    : 'bg-surface-bright'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
