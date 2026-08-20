'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import {
  Download,
  Images,
  ExternalLink,
  Play,
  ImageIcon,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { JobStatusBadge } from '@/components/jobs/job-status-badge';
import { HeyGenUploadDropzone } from '@/components/jobs/heygen-upload-dropzone';
import { NarrationSourceDropzone } from '@/components/jobs/narration-source-dropzone';
import { QCReviewPanel } from '@/components/jobs/qc-review-panel';
import { VAAssignment } from '@/components/jobs/va-assignment';
import { ErrorDetailPanel } from '@/components/jobs/error-detail-panel';
import { SceneGallery, type SceneImage } from '@/components/jobs/scene-gallery';
import type { Job } from '@/lib/repositories/job-repository';
import { updateJobQCSettings } from '@/app/actions/jobs';

// ─── AI Cost Estimation ───────────────────────────────────────────────────────

/**
 * Pricing as of 2025 (per 1k tokens):
 *   claude-sonnet-4-6:          input $0.003  / output $0.015
 *   claude-haiku-4-5-20251001:  input $0.00025 / output $0.00125
 *   claude-opus-4-6:            input $0.015  / output $0.075
 */
const MODEL_PRICING: Record<string, { input_per_1k: number; output_per_1k: number }> = {
  'claude-sonnet-4-6': { input_per_1k: 0.003, output_per_1k: 0.015 },
  'claude-haiku-4-5-20251001': { input_per_1k: 0.00025, output_per_1k: 0.00125 },
  'claude-opus-4-6': { input_per_1k: 0.015, output_per_1k: 0.075 },
};

const DEFAULT_PRICING = { input_per_1k: 0.003, output_per_1k: 0.015 };

function estimateCost(model: string, input_tokens: number, output_tokens: number): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (input_tokens / 1000) * pricing.input_per_1k +
    (output_tokens / 1000) * pricing.output_per_1k;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = 'overview' | 'scenes' | 'assets' | 'logs';

interface AssetEntry {
  key: string;
  type: string;
  size_bytes: number;
}

interface GenerationLogEntry {
  stage: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  model: string;
  prompt_system?: string;
  prompt_user?: string;
  raw_output?: string;
  success: boolean;
  error?: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface JobDetailTabsProps {
  job: Job;
  sceneImages: SceneImage[];
  assetManifest: AssetEntry[];
  previewVideoKey: string | null;
  finalVideoAssetKey: string | null;
  productionVAs: Array<{ id: string; name: string; email: string }>;
  uploaderVAs: Array<{ id: string; name: string; email: string }>;
  canPause: boolean;
  canDelete: boolean;
  canReviewQC: boolean;
  canAssign: boolean;
  canEdit: boolean;
  currentUserId: string | null;
}

// ─── Tab nav ──────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'scenes', label: 'Scenes' },
  { id: 'assets', label: 'Assets' },
  { id: 'logs', label: 'Logs' },
];

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  job,
  productionVAs,
  uploaderVAs,
  finalVideoAssetKey,
  canPause,
  canReviewQC,
  canAssign,
  canEdit,
  currentUserId,
}: Pick<
  JobDetailTabsProps,
  | 'job'
  | 'productionVAs'
  | 'uploaderVAs'
  | 'finalVideoAssetKey'
  | 'canPause'
  | 'canReviewQC'
  | 'canAssign'
  | 'canEdit'
  | 'currentUserId'
>) {
  const [isUpdatingQC, setIsUpdatingQC] = useState(false);

  async function handleQCToggle(field: 'skip_image_qc' | 'skip_final_qc', checked: boolean) {
    setIsUpdatingQC(true);
    try {
      const result = await updateJobQCSettings(job.id, { [field]: checked });
      if (!result.success) {
        console.error('Failed to update QC setting:', result.error);
        alert(`Failed to update QC setting: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to update QC setting:', error);
      alert('Failed to update QC setting');
    } finally {
      setIsUpdatingQC(false);
    }
  }
  return (
    <div className="space-y-6">
      {/* HeyGen Upload Section */}
      {job.status === 'AWAITING_PRODUCTION_VA' && (
        <div className="glass rounded-lg p-6 border border-surface-bright">
          <h2 className="text-wide-caps text-text-muted mb-4">
            HeyGen Footage Upload
          </h2>
          {job.assigned_production_va ? (
            <div className="space-y-4">
              <div className="p-4 bg-surface-container rounded-lg">
                <p className="text-sm text-text-muted mb-1">Assigned to</p>
                <p className="text-sm font-medium text-text">
                  {job.assigned_production_va.name}
                </p>
                <p className="text-xs text-text-muted">
                  {job.assigned_production_va.email}
                </p>
              </div>
              {(canPause ||
                (currentUserId &&
                  job.assigned_production_va_id === currentUserId)) && (
                <HeyGenUploadDropzone
                  jobId={job.id}
                  channelId={job.channel_id}
                />
              )}
              {!canPause &&
                currentUserId &&
                job.assigned_production_va_id !== currentUserId && (
                  <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
                    <p className="text-sm text-warning">
                      This job is assigned to another Production VA.
                    </p>
                  </div>
                )}
            </div>
          ) : (
            <div className="space-y-4">
              {canAssign ? (
                <VAAssignment
                  jobId={job.id}
                  currentVAId={job.assigned_production_va_id}
                  availableVAs={productionVAs}
                />
              ) : (
                <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
                  <p className="text-sm text-warning">
                    No Production VA assigned yet. An admin must assign a VA
                    before footage can be uploaded.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Image QC Review Section */}
      {job.status === 'AWAITING_IMAGE_QC' && (
        <div className="glass rounded-lg p-6 border border-warning/30 bg-warning/5">
          <h2 className="text-wide-caps text-warning mb-3">
            Image QC Required
          </h2>
          <p className="text-sm text-text-muted mb-4">
            Scene images have been generated. A VA must review them before
            rendering begins.
          </p>
          <Link
            href={`/jobs/${job.id}/image-qc`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Images className="w-4 h-4" />
            Review Images
          </Link>
        </div>
      )}

      {/* Uploader VA Section */}
      {job.status === 'AWAITING_UPLOADER' && (
        <div className="glass rounded-lg p-6 border border-surface-bright">
          <h2 className="text-wide-caps text-text-muted mb-4">
            Upload to YouTube
          </h2>
          {job.assigned_uploader_va ? (
            <div className="space-y-4">
              <div className="p-4 bg-surface-container rounded-lg">
                <p className="text-sm text-text-muted mb-1">Assigned to</p>
                <p className="text-sm font-medium text-text">
                  {job.assigned_uploader_va.name}
                </p>
                <p className="text-xs text-text-muted">
                  {job.assigned_uploader_va.email}
                </p>
              </div>
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg space-y-2">
                <p className="text-sm font-medium text-text">Instructions</p>
                <ol className="text-sm text-text-muted space-y-1 list-decimal list-inside">
                  <li>
                    Open YouTube Studio in your browser with the Chrome
                    extension active
                  </li>
                  <li>
                    Click &ldquo;Create&rdquo; &rarr; &ldquo;Upload
                    videos&rdquo; and select the final video file
                  </li>
                  <li>
                    The extension will auto-fill title, description, and tags
                    from this job
                  </li>
                  <li>
                    Review the filled fields, then publish or schedule
                  </li>
                  <li>Return here and mark the upload as complete</li>
                </ol>
              </div>
              {job.youtube_video_id && (
                <div className="p-4 bg-success/5 border border-success/20 rounded-lg">
                  <p className="text-sm text-success font-medium">
                    Video ID recorded: {job.youtube_video_id}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {canAssign ? (
                <VAAssignment
                  jobId={job.id}
                  currentVAId={job.assigned_uploader_va_id}
                  availableVAs={uploaderVAs}
                  vaType="uploader"
                />
              ) : (
                <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
                  <p className="text-sm text-warning">
                    No Uploader VA assigned yet. An admin must assign a VA
                    before uploading can begin.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* QC Review Section */}
      {job.status === 'AWAITING_QC' && canReviewQC && (
        <QCReviewPanel
          jobId={job.id}
          finalVideoAssetKey={finalVideoAssetKey}
          qcFeedback={job.qc_feedback ?? null}
        />
      )}

      {/* Narration Source */}
      <div className="glass rounded-lg p-6 border border-surface-bright space-y-3">
        <div>
          <h3 className="text-sm font-medium text-text">Narration Source</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Provide a video or audio file to use as the narration track. If
            set, TTS generation is skipped.
          </p>
        </div>
        <NarrationSourceDropzone
          jobId={job.id}
          currentPath={job.narration_source_path ?? null}
        />
      </div>

      {/* QC Settings */}
      {canEdit && (
        <div className="glass rounded-lg p-6 border border-surface-bright">
          <h3 className="text-sm font-medium text-text mb-3">QC Settings</h3>
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={job.skip_image_qc}
                disabled={isUpdatingQC}
                onChange={(e) => handleQCToggle('skip_image_qc', e.target.checked)}
                className="w-4 h-4 rounded border-surface-bright text-primary focus:ring-primary bg-surface-container disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="text-sm text-text">Skip Image QC</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={job.skip_final_qc}
                disabled={isUpdatingQC}
                onChange={(e) => handleQCToggle('skip_final_qc', e.target.checked)}
                className="w-4 h-4 rounded border-surface-bright text-primary focus:ring-primary bg-surface-container disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="text-sm text-text">Skip Final QC</span>
            </label>
          </div>
        </div>
      )}

      {/* Overview Card */}
      <div className="glass rounded-lg p-6 border border-surface-bright">
        <h2 className="text-wide-caps text-text-muted mb-4">Overview</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-text-muted mb-1">Status</p>
            <JobStatusBadge status={job.status} />
          </div>
          {job.production_version && (
            <div>
              <p className="text-sm text-text-muted mb-1">
                Production Version
              </p>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                {job.production_version}
              </span>
            </div>
          )}
          <div>
            <p className="text-sm text-text-muted mb-1">Channel</p>
            <p className="text-sm font-medium text-text">
              {job.channel?.name || 'Unknown'}
            </p>
            <p className="text-xs text-text-muted">
              {job.channel?.youtube_channel_id}
            </p>
          </div>
          <div>
            <p className="text-sm text-text-muted mb-1">Template</p>
            <p className="text-sm font-medium text-text">
              {job.template?.name || 'Unknown'}
            </p>
            <p className="text-xs text-text-muted">
              {job.template?.format}
            </p>
          </div>
          <div>
            <p className="text-sm text-text-muted mb-1">Format</p>
            <p className="text-sm font-medium text-text">
              {job.format.replace(/_/g, ' ')}
            </p>
          </div>
          <div>
            <p className="text-sm text-text-muted mb-1">Created</p>
            <p className="text-sm text-text">
              {format(new Date(job.created_at), 'PPpp')}
            </p>
          </div>
          <div>
            <p className="text-sm text-text-muted mb-1">Updated</p>
            <p className="text-sm text-text">
              {format(new Date(job.updated_at), 'PPpp')}
            </p>
          </div>
          {job.retry_count > 0 && (
            <div>
              <p className="text-sm text-text-muted mb-1">Retry Count</p>
              <p className="text-sm text-warning">{job.retry_count}</p>
            </div>
          )}
          {job.assigned_production_va && (
            <div>
              <p className="text-sm text-text-muted mb-1">Production VA</p>
              <p className="text-sm font-medium text-text">
                {job.assigned_production_va.name}
              </p>
              <p className="text-xs text-text-muted">
                {job.assigned_production_va.email}
              </p>
            </div>
          )}
          {job.assigned_uploader_va && (
            <div>
              <p className="text-sm text-text-muted mb-1">Uploader VA</p>
              <p className="text-sm font-medium text-text">
                {job.assigned_uploader_va.name}
              </p>
              <p className="text-xs text-text-muted">
                {job.assigned_uploader_va.email}
              </p>
            </div>
          )}
          {job.description && (
            <div className="md:col-span-2">
              <p className="text-sm text-text-muted mb-1">Description</p>
              <p className="text-sm text-text leading-relaxed">
                {job.description}
              </p>
            </div>
          )}
          {job.generated_tags && job.generated_tags.length > 0 && (
            <div className="md:col-span-2">
              <p className="text-sm text-text-muted mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {job.generated_tags.map((tag, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 text-xs rounded-full bg-surface-container text-text-muted border border-surface-bright"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Render Details Card */}
      {job.render_engine && (
        <div className="glass rounded-lg p-6 border border-surface-bright">
          <h2 className="text-wide-caps text-text-muted mb-4">
            Render Details
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p className="text-sm text-text-muted mb-1">Engine</p>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-bright text-text border border-surface-bright">
                {job.render_engine}
              </span>
            </div>
            {job.aspect_ratio && (
              <div>
                <p className="text-sm text-text-muted mb-1">Aspect Ratio</p>
                <p className="text-sm font-medium text-text">
                  {job.aspect_ratio}
                </p>
              </div>
            )}
            {job.target_duration_seconds && (
              <div>
                <p className="text-sm text-text-muted mb-1">
                  Target Duration
                </p>
                <p className="text-sm font-medium text-text">
                  {Math.floor(job.target_duration_seconds / 60)}m{' '}
                  {job.target_duration_seconds % 60}s
                </p>
              </div>
            )}
            {job.duration_frames && (
              <div>
                <p className="text-sm text-text-muted mb-1">
                  Duration (frames)
                </p>
                <p className="text-sm font-medium text-text">
                  {job.duration_frames.toLocaleString()}
                </p>
              </div>
            )}
            {job.render_started_at && (
              <div>
                <p className="text-sm text-text-muted mb-1">Render Started</p>
                <p className="text-sm text-text">
                  {format(new Date(job.render_started_at), 'PPpp')}
                </p>
              </div>
            )}
            {job.render_completed_at && (
              <div>
                <p className="text-sm text-text-muted mb-1">
                  Render Completed
                </p>
                <p className="text-sm text-text">
                  {format(new Date(job.render_completed_at), 'PPpp')}
                </p>
              </div>
            )}
            {job.total_render_time_seconds && (
              <div>
                <p className="text-sm text-text-muted mb-1">
                  Total Render Time
                </p>
                <p className="text-sm font-medium text-text">
                  {job.total_render_time_seconds >= 60
                    ? `${Math.floor(job.total_render_time_seconds / 60)}m ${job.total_render_time_seconds % 60}s`
                    : `${job.total_render_time_seconds}s`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Final Video Metrics Card */}
      {(job.final_video_size_bytes || job.final_video_duration_seconds) && (
        <div className="glass rounded-lg p-6 border border-surface-bright">
          <h2 className="text-wide-caps text-text-muted mb-4">Final Video</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {job.final_video_duration_seconds && (
              <div>
                <p className="text-sm text-text-muted mb-1">Duration</p>
                <p className="text-sm font-medium text-text">
                  {Math.floor(job.final_video_duration_seconds / 60)}m{' '}
                  {job.final_video_duration_seconds % 60}s
                </p>
              </div>
            )}
            {job.final_video_size_bytes && (
              <div>
                <p className="text-sm text-text-muted mb-1">File Size</p>
                <p className="text-sm font-medium text-text">
                  {(job.final_video_size_bytes / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
            )}
            {job.size_bytes_total_assets && (
              <div>
                <p className="text-sm text-text-muted mb-1">Total Assets</p>
                <p className="text-sm font-medium text-text">
                  {(job.size_bytes_total_assets / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* YouTube Performance Card */}
      {job.youtube_video_id && (
        <div className="glass rounded-lg p-6 border border-surface-bright">
          <h2 className="text-wide-caps text-text-muted mb-4">YouTube</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p className="text-sm text-text-muted mb-1">Video ID</p>
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono text-text">
                  {job.youtube_video_id}
                </p>
                <a
                  href={`https://www.youtube.com/watch?v=${job.youtube_video_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
            {job.published_at && (
              <div>
                <p className="text-sm text-text-muted mb-1">Published</p>
                <p className="text-sm text-text">
                  {format(new Date(job.published_at), 'PPp')}
                </p>
              </div>
            )}
            {job.views !== null && job.views !== undefined && (
              <div>
                <p className="text-sm text-text-muted mb-1">Views</p>
                <p className="text-sm font-medium text-text">
                  {job.views.toLocaleString()}
                </p>
              </div>
            )}
            {job.revenue_cents !== null && job.revenue_cents !== undefined && (
              <div>
                <p className="text-sm text-text-muted mb-1">Revenue</p>
                <p className="text-sm font-medium text-success">
                  ${(job.revenue_cents / 100).toFixed(2)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VA Performance Card */}
      {(job.production_va_time_spent_seconds ||
        job.uploader_va_time_spent_seconds) && (
        <div className="glass rounded-lg p-6 border border-surface-bright">
          <h2 className="text-wide-caps text-text-muted mb-4">
            VA Performance
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {job.production_va_time_spent_seconds && (
              <div>
                <p className="text-sm text-text-muted mb-1">
                  Production VA Time
                </p>
                <p className="text-sm font-medium text-text">
                  {Math.floor(job.production_va_time_spent_seconds / 60)}m{' '}
                  {job.production_va_time_spent_seconds % 60}s
                </p>
              </div>
            )}
            {job.uploader_va_time_spent_seconds && (
              <div>
                <p className="text-sm text-text-muted mb-1">
                  Uploader VA Time
                </p>
                <p className="text-sm font-medium text-text">
                  {Math.floor(job.uploader_va_time_spent_seconds / 60)}m{' '}
                  {job.uploader_va_time_spent_seconds % 60}s
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Scenes tab ───────────────────────────────────────────────────────────────

function ScenesTab({
  job,
  sceneImages,
}: {
  job: Job;
  sceneImages: SceneImage[];
}) {
  return (
    <div className="space-y-6">
      {sceneImages.length > 0 ? (
        <div className="glass rounded-lg p-6 border border-surface-bright">
          <div className="flex items-center gap-2 mb-4">
            <ImageIcon className="w-4 h-4 text-text-muted" />
            <h2 className="text-wide-caps text-text-muted">Scene Images</h2>
            <span className="ml-auto text-xs text-text-muted">
              {sceneImages.length} image
              {sceneImages.length !== 1 ? 's' : ''}
            </span>
          </div>
          <SceneGallery jobId={job.id} images={sceneImages} />
        </div>
      ) : (
        <div className="glass rounded-lg p-6 border border-surface-bright text-center py-12">
          <ImageIcon className="w-10 h-10 text-text-disabled mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            No scene images available yet.
          </p>
        </div>
      )}

      {job.script && (
        <div className="glass rounded-lg p-6 border border-surface-bright">
          <h2 className="text-wide-caps text-text-muted mb-4">Script</h2>
          <div className="prose prose-invert max-w-none">
            <pre className="text-sm text-text whitespace-pre-wrap bg-surface-container p-4 rounded-lg overflow-x-auto">
              {job.script}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Assets tab ───────────────────────────────────────────────────────────────

function AssetsTab({
  job,
  assetManifest,
  previewVideoKey,
}: {
  job: Job;
  assetManifest: AssetEntry[];
  previewVideoKey: string | null;
}) {
  return (
    <div className="space-y-6">
      {/* Video Preview */}
      {previewVideoKey && job.status !== 'AWAITING_QC' && (
        <div className="glass rounded-lg p-6 border border-surface-bright">
          <div className="flex items-center gap-2 mb-4">
            <Play className="w-4 h-4 text-text-muted" />
            <h2 className="text-wide-caps text-text-muted">Video Preview</h2>
            <a
              href={`/api/assets/${job.id}/${previewVideoKey}?download=1`}
              download
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-surface-container hover:bg-surface-bright text-text-muted text-xs rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
          </div>
          <div className="rounded-lg overflow-hidden bg-black">
            <video
              controls
              preload="metadata"
              className="w-full max-h-[480px]"
              src={`/api/assets/${job.id}/${previewVideoKey}`}
            >
              Your browser does not support video playback.
            </video>
          </div>
        </div>
      )}

      {/* Asset Manifest */}
      {assetManifest.length > 0 ? (
        <div className="glass rounded-lg p-6 border border-surface-bright">
          <h2 className="text-wide-caps text-text-muted mb-4">Assets</h2>
          <div className="space-y-2">
            {assetManifest
              .filter((asset) => asset.key !== 'skipped')
              .map((asset, i) => {
                const filename =
                  asset.key.split('/').pop() || asset.type;
                const isVideo =
                  asset.type.startsWith('video/') ||
                  asset.key.endsWith('.mp4');
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 bg-surface-container rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text">
                        {filename}
                      </p>
                      <p className="text-xs text-text-muted">
                        {asset.type}
                        {asset.size_bytes > 0 && (
                          <span className="ml-2">
                            (
                            {(asset.size_bytes / 1024 / 1024).toFixed(2)}{' '}
                            MB)
                          </span>
                        )}
                      </p>
                    </div>
                    <a
                      href={`/api/assets/${job.id}/${asset.key}?download=1`}
                      className="flex items-center space-x-1 px-3 py-1.5 bg-primary hover:bg-primary/90 text-white text-xs rounded-lg transition-all"
                    >
                      <Download className="w-3 h-3" />
                      <span>{isVideo ? 'Download Video' : 'Download'}</span>
                    </a>
                  </div>
                );
              })}
          </div>
        </div>
      ) : (
        <div className="glass rounded-lg p-6 border border-surface-bright text-center py-12">
          <p className="text-sm text-text-muted">No assets available yet.</p>
        </div>
      )}
    </div>
  );
}

// ─── Generation log entry ─────────────────────────────────────────────────────

function LogEntryCard({ entry }: { entry: GenerationLogEntry }) {
  const [expanded, setExpanded] = useState(false);

  const hasCost = entry.input_tokens !== undefined;
  const cost = hasCost
    ? estimateCost(entry.model, entry.input_tokens!, entry.output_tokens ?? 0)
    : null;

  return (
    <div className="border border-surface-bright rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-start justify-between p-4 text-left hover:bg-surface-container/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 w-2 h-2 rounded-full flex-shrink-0',
              entry.success ? 'bg-lime-400' : 'bg-red-500'
            )}
          />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-text font-mono">
                {entry.stage}
              </span>
              <span className="text-xs text-text-muted border border-surface-bright rounded px-1.5 py-0.5">
                {entry.model}
              </span>
              <span className="text-xs text-text-muted">
                {entry.duration_ms.toLocaleString()} ms
              </span>
            </div>
            {hasCost && (
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="flex items-center gap-1 text-xs text-text-muted">
                  <Zap className="w-3 h-3" />
                  In: {entry.input_tokens!.toLocaleString()} / Out:{' '}
                  {(entry.output_tokens ?? 0).toLocaleString()} tokens
                </span>
                <span className="flex items-center gap-1 text-xs font-medium text-lime-400">
                  <DollarSign className="w-3 h-3" />
                  {cost!.toFixed(5)}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 ml-2 mt-0.5">
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-surface-bright p-4 space-y-3 bg-surface-container/30">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-text-muted mb-0.5">Started</p>
              <p className="text-text font-mono">
                {new Date(entry.started_at).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-text-muted mb-0.5">Completed</p>
              <p className="text-text font-mono">
                {new Date(entry.completed_at).toLocaleString()}
              </p>
            </div>
          </div>
          {entry.error && (
            <div className="p-3 bg-error/10 border border-error/20 rounded text-xs text-error">
              {entry.error}
            </div>
          )}
          {entry.prompt_system && (
            <div>
              <p className="text-xs text-text-muted mb-1">System Prompt</p>
              <pre className="text-xs text-text bg-surface-container p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                {entry.prompt_system}
              </pre>
            </div>
          )}
          {entry.prompt_user && (
            <div>
              <p className="text-xs text-text-muted mb-1">User Prompt</p>
              <pre className="text-xs text-text bg-surface-container p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                {entry.prompt_user}
              </pre>
            </div>
          )}
          {entry.raw_output && (
            <div>
              <p className="text-xs text-text-muted mb-1">Raw Output</p>
              <pre className="text-xs text-text bg-surface-container p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                {entry.raw_output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Logs tab ─────────────────────────────────────────────────────────────────

function LogsTab({ job }: { job: Job }) {
  const generationLog = (job.generation_log ?? []) as GenerationLogEntry[];

  const totalCost = generationLog.reduce((sum, e) => {
    if (e.input_tokens === undefined) return sum;
    return sum + estimateCost(e.model, e.input_tokens, e.output_tokens ?? 0);
  }, 0);
  const hasAnyCost = generationLog.some((e) => e.input_tokens !== undefined);

  return (
    <div className="space-y-6">
      {/* Error Detail Panel */}
      <ErrorDetailPanel
        jobId={job.id}
        status={job.status}
        errorMessage={job.error_message}
        errorDetail={job.error_detail ?? null}
        stateMachineHistory={job.state_machine_history ?? []}
      />

      {/* Generation Log */}
      {generationLog.length > 0 && (
        <div className="glass rounded-lg p-6 border border-surface-bright">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h2 className="text-wide-caps text-text-muted">
              Generation Log
              <span className="ml-2 text-xs font-normal normal-case text-text-disabled">
                ({generationLog.length} call
                {generationLog.length !== 1 ? 's' : ''})
              </span>
            </h2>
            {hasAnyCost && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg border border-surface-bright">
                <DollarSign className="w-3.5 h-3.5 text-lime-400 flex-shrink-0" />
                <span className="text-xs text-text-muted">Est. AI cost:</span>
                <span className="text-xs font-semibold text-lime-400">
                  ${totalCost.toFixed(5)}
                </span>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {generationLog.map((entry, i) => (
              <LogEntryCard key={i} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!job.error_message &&
        !job.error_detail &&
        (job.state_machine_history ?? []).length === 0 &&
        generationLog.length === 0 && (
          <div className="glass rounded-lg p-6 border border-surface-bright text-center py-12">
            <p className="text-sm text-text-muted">No logs available yet.</p>
          </div>
        )}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export function JobDetailTabs({
  job,
  sceneImages,
  assetManifest,
  previewVideoKey,
  finalVideoAssetKey,
  productionVAs,
  uploaderVAs,
  canPause,
  canDelete: _canDelete,
  canReviewQC,
  canAssign,
  canEdit,
  currentUserId,
}: JobDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <div className="space-y-0">
      {/* Tab bar */}
      <div className="flex items-center border-b border-surface-bright bg-transparent mb-6 overflow-x-auto scrollbar-none">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-5 py-3 text-sm font-medium transition-all whitespace-nowrap border-b-2 -mb-px',
              activeTab === tab.id
                ? 'text-white border-lime-400'
                : 'text-text-muted border-transparent hover:text-text hover:border-surface-bright'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <OverviewTab
          job={job}
          productionVAs={productionVAs}
          uploaderVAs={uploaderVAs}
          finalVideoAssetKey={finalVideoAssetKey}
          canPause={canPause}
          canReviewQC={canReviewQC}
          canAssign={canAssign}
          canEdit={canEdit}
          currentUserId={currentUserId}
        />
      )}
      {activeTab === 'scenes' && (
        <ScenesTab job={job} sceneImages={sceneImages} />
      )}
      {activeTab === 'assets' && (
        <AssetsTab
          job={job}
          assetManifest={assetManifest}
          previewVideoKey={previewVideoKey}
        />
      )}
      {activeTab === 'logs' && <LogsTab job={job} />}
    </div>
  );
}
