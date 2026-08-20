'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { formatDisplayName } from '@/components/formats/format-card';
import { GlobalSettingsPanel } from './global-settings-panel';
import { AssetDropZones } from './asset-drop-zones';
import { AdvancedStagingTable, type StagedJob } from './advanced-staging-table';
import { AssetBrowserPanel } from './asset-browser-panel';
import { useJobPresets, type JobPreset } from '@/lib/hooks/use-job-presets';
import { useStagedJobsPersistence } from '@/lib/hooks/use-staged-jobs-persistence';
import { validateStagedJob } from '@/lib/validation/job-validation';
import type { DropZoneAsset } from './drop-zone-card';

interface Template {
  id: string;
  name: string;
  format: string;
  description: string | null;
}

interface Channel {
  id: string;
  name: string;
  youtube_channel_id: string;
  language: string;
}

interface TemplateCreationFormProps {
  template: Template;
  channels: Channel[];
  onBack: () => void;
  onDispatchComplete?: () => void;
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

export function TemplateCreationForm({
  template,
  channels,
  onBack,
  onDispatchComplete,
}: TemplateCreationFormProps) {
  const router = useRouter();
  const { preset, loading: presetLoading } = useJobPresets(template.id);
  const { initialized, loadStagedJobs, saveStagedJobs, clearStagedJobs } =
    useStagedJobsPersistence(template.id);

  // Global settings (batch defaults)
  const [settings, setSettings] = useState<Omit<JobPreset, 'template_id'>>(() => ({
    channel_id: channels[0]?.id ?? '',
    production_version: 'V2',
    subtitles: true,
    auto_start: true, // Auto-start by default for maximum automation
    skip_image_qc: false,
    skip_final_qc: true, // Skip final QC by default to minimize operator time
    language: channels[0]?.language ?? 'en',
    environment_id: null,
  }));

  // Asset browser panel
  const [assetBrowserOpen, setAssetBrowserOpen] = useState(false);

  // Load preset when available
  useEffect(() => {
    if (preset && !presetLoading) {
      setSettings({
        channel_id: preset.channel_id,
        production_version: preset.production_version,
        subtitles: preset.subtitles,
        auto_start: preset.auto_start,
        skip_image_qc: preset.skip_image_qc,
        skip_final_qc: preset.skip_final_qc,
        language: preset.language,
        environment_id: preset.environment_id,
      });
    }
  }, [preset, presetLoading]);

  // Staged jobs
  const [stagedJobs, setStagedJobs] = useState<StagedJob[]>([]);

  // Load persisted jobs on mount
  useEffect(() => {
    if (initialized) {
      const loaded = loadStagedJobs();
      if (loaded.length > 0) {
        setStagedJobs(loaded);
      }
    }
  }, [initialized, loadStagedJobs]);

  // Persist jobs on change
  useEffect(() => {
    if (initialized && stagedJobs.length > 0) {
      saveStagedJobs(stagedJobs);
    }
  }, [stagedJobs, initialized, saveStagedJobs]);

  // Global assets (from drop zones)
  const [globalAssets, setGlobalAssets] = useState<Map<string, DropZoneAsset[]>>(
    new Map()
  );

  // Quick topic input
  const [quickTopic, setQuickTopic] = useState('');

  // Dispatching state
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<{
    queued: number;
    errors: string[];
  } | null>(null);

  // Warnings
  const [warnings, setWarnings] = useState<string[]>([]);

  // Handle assets change from drop zones
  const handleAssetsChange = useCallback(
    (assets: Map<string, DropZoneAsset[]>) => {
      setGlobalAssets(assets);

      // If we have assets but no staged jobs, create initial jobs based on assets
      if (stagedJobs.length === 0 && assets.size > 0) {
        // Extract topics from filenames
        const topics = new Set<string>();
        assets.forEach((assetList) => {
          assetList.forEach((asset) => {
            // Extract topic from filename (remove extension)
            const topic = asset.file.name.replace(/\.[^/.]+$/, '');
            topics.add(topic);
          });
        });

        if (topics.size > 0) {
          const newJobs = Array.from(topics).map((topic) => createJob(topic));
          setStagedJobs(newJobs);
        }
      }
    },
    [stagedJobs.length, settings]
  );

  // Create a new job
  function createJob(topic: string, customAssets?: Map<string, DropZoneAsset[]>): StagedJob {
    const assets = customAssets ?? new Map(globalAssets);

    // Validate the job
    const validation = validateStagedJob({
      format: template.format,
      assets,
      topic,
      channel_id: settings.channel_id,
    });

    return {
      id: generateId(),
      topic,
      assets,
      channel_id: settings.channel_id,
      subtitles: settings.subtitles,
      auto_start: settings.auto_start,
      skip_image_qc: settings.skip_image_qc,
      skip_final_qc: settings.skip_final_qc,
      language: settings.language,
      production_version: settings.production_version,
      environment_id: settings.environment_id,
      character_ids: [],
      knowledge_refs: [],
      validation_status: validation.status,
      validation_messages: validation.messages,
      overrides: new Set(),
    };
  }

  // Add job from quick topic input
  function handleAddQuickJob() {
    if (!quickTopic.trim()) return;

    const newJob = createJob(quickTopic.trim());
    setStagedJobs((prev) => [...prev, newJob]);
    setQuickTopic('');
  }

  // Update job
  const handleUpdateJob = useCallback((id: string, updates: Partial<StagedJob>) => {
    setStagedJobs((prev) =>
      prev.map((job) => {
        if (job.id !== id) return job;

        const updated = { ...job, ...updates };

        // Re-validate if assets, topic, or channel changed
        if (updates.assets || updates.topic || updates.channel_id) {
          const validation = validateStagedJob({
            format: template.format,
            assets: updated.assets,
            topic: updated.topic,
            channel_id: updated.channel_id,
          });
          updated.validation_status = validation.status;
          updated.validation_messages = validation.messages;
        }

        return updated;
      })
    );
  }, [template.format]);

  // Delete jobs
  const handleDeleteJobs = useCallback((ids: string[]) => {
    setStagedJobs((prev) => prev.filter((job) => !ids.includes(job.id)));
  }, []);

  // Cell drop handler
  const handleCellDrop = useCallback(
    (jobId: string, zoneId: string, files: File[]) => {
      setStagedJobs((prev) =>
        prev.map((job) => {
          if (job.id !== jobId) return job;

          // Create assets for dropped files
          const newAssets: DropZoneAsset[] = files.map((file) => ({
            file,
            zoneId,
          }));

          // Update assets map
          const nextAssets = new Map(job.assets);
          const existing = nextAssets.get(zoneId) ?? [];
          nextAssets.set(zoneId, [...existing, ...newAssets]);

          // Re-validate with new assets
          const validation = validateStagedJob({
            format: template.format,
            assets: nextAssets,
            topic: job.topic,
            channel_id: job.channel_id,
          });

          return {
            ...job,
            assets: nextAssets,
            validation_status: validation.status,
            validation_messages: validation.messages,
          };
        })
      );
    },
    [template.format]
  );

  // Dispatch jobs
  const handleDispatchJobs = useCallback(
    async (ids: string[]) => {
      const jobsToDispatch = stagedJobs.filter((j) => ids.includes(j.id));
      if (jobsToDispatch.length === 0) return;

      setDispatching(true);
      setDispatchResult(null);

      try {
        // 1. Upload all video/script assets to R2
        const uploadedAssets = new Map<string, any>();

        for (const job of jobsToDispatch) {
          const jobAssets: any[] = [];

          // Process each asset zone
          for (const [zoneId, assets] of job.assets.entries()) {
            for (const asset of assets) {
              const file = asset.file;
              const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();

              // Handle scripts (read content, attach as script_text)
              if (['.txt', '.md', '.srt'].includes(ext)) {
                try {
                  const text = await file.text();
                  // Store script text in the job payload directly
                  // We'll add it when building payloads below
                  if (!uploadedAssets.has(job.id)) {
                    uploadedAssets.set(job.id, { scriptText: text, preUploadedAsset: null });
                  } else {
                    uploadedAssets.get(job.id).scriptText = text;
                  }
                } catch (err) {
                  console.warn('Failed to read script:', err);
                }
              }
              // Handle videos (upload to R2)
              else if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
                try {
                  const formData = new FormData();
                  formData.append('file', file);
                  formData.append('channel_id', job.channel_id);

                  const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData,
                    credentials: 'same-origin',
                  });

                  if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error ?? 'Upload failed');
                  }

                  const uploadResult = await response.json();

                  if (!uploadedAssets.has(job.id)) {
                    uploadedAssets.set(job.id, { scriptText: null, preUploadedAsset: uploadResult });
                  } else {
                    uploadedAssets.get(job.id).preUploadedAsset = uploadResult;
                  }
                } catch (err) {
                  throw new Error(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
              }
              // TODO: Handle other asset types (images, b-roll, etc.)
            }
          }
        }

        // 2. Build dispatch payloads
        const payloads = jobsToDispatch.map((job) => {
          const uploadedData = uploadedAssets.get(job.id);

          return {
            topic: job.topic,
            script_text: uploadedData?.scriptText ?? null,
            channel_id: job.channel_id,
            template_id: template.id,
            format: template.format,
            production_version: job.production_version,
            subtitles: job.subtitles,
            skip_image_qc: job.skip_image_qc,
            skip_final_qc: job.skip_final_qc,
            language: job.language,
            video_key: null, // Legacy field
            pre_uploaded_asset: uploadedData?.preUploadedAsset ?? null,
            environment_id: job.environment_id ?? null,
            character_ids: job.character_ids ?? [],
            knowledge_refs: job.knowledge_refs ?? [],
            media_asset_refs: job.media_asset_refs ?? [],
          };
        });

        // 3. Dispatch to backend
        const formData = new FormData();
        formData.append('jobs', JSON.stringify(payloads));

        const response = await fetch('/api/dispatch-jobs', {
          method: 'POST',
          body: formData,
          credentials: 'same-origin',
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error ?? 'Dispatch failed');
        }

        const result = await response.json();

        setDispatchResult({
          queued: result.queued ?? jobsToDispatch.length,
          errors: result.results?.filter((r: any) => !r.success).map((r: any) => r.error) ?? [],
        });

        // Remove dispatched jobs
        if (result.queued > 0) {
          setStagedJobs((prev) => prev.filter((j) => !ids.includes(j.id)));
          clearStagedJobs();

          // Auto-redirect to jobs tab after brief delay to show success message
          if (onDispatchComplete) {
            setTimeout(() => {
              onDispatchComplete();
            }, 1500);
          }
        }
      } catch (err) {
        setDispatchResult({
          queued: 0,
          errors: [err instanceof Error ? err.message : 'Dispatch failed'],
        });
      } finally {
        setDispatching(false);
      }
    },
    [stagedJobs, clearStagedJobs, template]
  );

  // Disable animations for large batches
  const disableAnimations = stagedJobs.length > 50;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'rgba(205,195,215,0.5)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginBottom: 12,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            arrow_back
          </span>
          Back to templates
        </button>

        <h1
          style={{
            color: '#e5e2e1',
            fontSize: 20,
            fontWeight: 800,
            margin: '0 0 4px 0',
          }}
        >
          {formatDisplayName(template.format)} · {template.name}
        </h1>
        {template.description && (
          <p style={{ color: '#cdc3d7', fontSize: 12, margin: 0 }}>
            {template.description}
          </p>
        )}
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Global settings */}
        <GlobalSettingsPanel
          templateId={template.id}
          templateFormat={template.format}
          channels={channels}
          settings={settings}
          onSettingsChange={setSettings}
        />

        {/* Asset drop zones */}
        <AssetDropZones
          format={template.format}
          onAssetsChange={handleAssetsChange}
          onWarnings={setWarnings}
          onJobsExtracted={(extractedJobs) => {
            // Create staged jobs from ZIP extraction
            const newJobs = extractedJobs.map((ej) => {
              const assetsMap = new Map<string, DropZoneAsset[]>();

              // Convert File[] to DropZoneAsset[]
              for (const [zoneId, files] of ej.assets.entries()) {
                assetsMap.set(
                  zoneId,
                  files.map((file) => ({ file, zoneId }))
                );
              }

              return createJob(ej.topic, assetsMap);
            });

            setStagedJobs((prev) => [...prev, ...newJobs]);
          }}
        />

        {/* Quick topic input */}
        <div
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(var(--v2-accent-rgb), 0.1)',
            borderRadius: 12,
            padding: 16,
          }}
        >
          <label
            style={{
              display: 'block',
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'rgba(205,195,215,0.6)',
              marginBottom: 8,
            }}
          >
            Quick Add Job
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <input
              type="text"
              value={quickTopic}
              onChange={(e) => setQuickTopic(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') handleAddQuickJob();
              }}
              placeholder="Enter topic and press Enter..."
              style={{
                flex: 1,
                padding: '10px 14px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(var(--v2-accent-rgb), 0.2)',
                borderRadius: 8,
                color: '#e5e2e1',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              onClick={handleAddQuickJob}
              disabled={!quickTopic.trim()}
              style={{
                padding: '10px 20px',
                background: quickTopic.trim()
                  ? 'var(--v2-accent)'
                  : 'rgba(var(--v2-accent-rgb), 0.3)',
                border: 'none',
                borderRadius: 8,
                color: '#000',
                fontSize: 12,
                fontWeight: 700,
                cursor: quickTopic.trim() ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                add
              </span>
              Add Job
            </button>
          </div>
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div
            style={{
              padding: '12px 16px',
              background: 'rgba(255,180,0,0.1)',
              border: '1px solid rgba(255,180,0,0.3)',
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {warnings.map((warning, i) => (
              <div
                key={i}
                style={{
                  fontSize: 11,
                  color: '#ffb400',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                  warning
                </span>
                {warning}
              </div>
            ))}
          </div>
        )}

        {/* Dispatch result */}
        {dispatchResult && dispatchResult.queued > 0 && (
          <div
            style={{
              padding: '12px 16px',
              background: 'rgba(var(--v2-accent-rgb), 0.1)',
              border: '1px solid rgba(var(--v2-accent-rgb), 0.3)',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--v2-accent)', fontWeight: 600 }}>
              {dispatchResult.queued} job{dispatchResult.queued !== 1 ? 's' : ''} dispatched
              successfully!
            </span>
            <button
              onClick={() => router.push('/jobs')}
              style={{
                padding: '6px 12px',
                background: 'var(--v2-accent)',
                border: 'none',
                borderRadius: 6,
                color: '#000',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              View Jobs
            </button>
          </div>
        )}

        {/* Staging table */}
        <AdvancedStagingTable
          jobs={stagedJobs}
          channels={channels}
          templateId={template.id}
          format={template.format}
          onUpdateJob={handleUpdateJob}
          onDeleteJobs={handleDeleteJobs}
          onDispatchJobs={handleDispatchJobs}
          onCellDrop={handleCellDrop}
          dispatching={dispatching}
        />
      </div>

      {/* Asset browser panel */}
      <AssetBrowserPanel
        isOpen={assetBrowserOpen}
        onToggle={() => setAssetBrowserOpen((prev) => !prev)}
        channelId={settings.channel_id}
        format={template.format}
      />
    </div>
  );
}
