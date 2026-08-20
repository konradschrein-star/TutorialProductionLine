'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Copy, Check, Terminal, CheckCircle2, XCircle,
  ChevronDown, Plus, ListPlus, Zap, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  BatchDefaultsPanel,
  type BatchDefaults,
} from '@/components/ingestion/batch-defaults-panel';
import { RecentJobsPoller, type RecentJob } from '@/components/formats/recent-jobs-poller';
import { UnifiedDropzone } from '@/components/ingestion/unified-dropzone';
import {
  StagingTable,
  type StagedJob,
} from '@/components/ingestion/staging-table';
import {
  dispatchStagedJobs,
  type StagedJobPayload,
} from '@/app/actions/zip-ingestion';
import { createJob } from '@/app/actions/jobs';
import { generateId } from '@/lib/services/file-detector';
import { getFormatConfig } from '@/lib/format-config';
import { cn } from '@/lib/utils';
import { ComparisonIngestionPanel } from './comparison-ingestion-panel';

export interface ArchetypeReadiness {
  id: string;
  name: string;
  imageStyle: string | null;
  hasApprovedStyleGuide: boolean;
  activeCharacterCount: number;
}

interface IngestionTabProps {
  format: string;
  templates: Array<{ id: string; name: string; format: string }>;
  channels: Array<{ id: string; name: string; language: string }>;
  recentJobs: RecentJob[];
  readinessData?: ArchetypeReadiness[];
}

export function IngestionTab({
  format,
  templates,
  channels,
  recentJobs,
  readinessData = [],
}: IngestionTabProps) {
  const formatConfig = getFormatConfig(format);

  const anyMissing = readinessData.some((a) => !a.hasApprovedStyleGuide);
  const [readinessOpen, setReadinessOpen] = useState(() => anyMissing);
  const [mode, setMode] = useState<'quick' | 'batch'>('quick');

  const [defaults, setDefaults] = useState<BatchDefaults>({
    template_id: templates[0]?.id ?? '',
    channel_id: channels[0]?.id ?? '',
    production_version: 'V2',
    subtitles: true,
    auto_start: true,
    skip_image_qc: false,
    skip_final_qc: false,
    language: channels[0]?.language ?? 'en',
  });

  const [stagedJobs, setStagedJobs] = useState<StagedJob[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<{
    queued: number;
    errors: string[];
  } | null>(null);

  // --- Activity log ---
  const log = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setActivityLog((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 200));
  }, []);

  // --- Validation ---
  function validateJob(job: StagedJob): StagedJob {
    const messages: string[] = [];
    let status: StagedJob['validation_status'] = 'valid';

    if (!job.topic.trim()) {
      messages.push('Topic is required');
      status = 'error';
    }
    if (!job.channel_id) {
      messages.push('Select a channel');
      status = 'error';
    }
    if (!defaults.template_id) {
      messages.push('Select a template');
      status = 'error';
    }

    if (status !== 'error') {
      if (!job.script_text && job.topic.trim()) {
        messages.push('No script — AI will generate');
        status = 'warning';
      }
    }

    return { ...job, validation_status: status, validation_messages: messages };
  }

  function revalidateAll(jobs: StagedJob[]): StagedJob[] {
    return jobs.map(validateJob);
  }

  // --- Batch defaults change ---
  const handleDefaultsChange = useCallback(
    (newDefaults: BatchDefaults) => {
      setDefaults(newDefaults);
      setStagedJobs((prev) =>
        revalidateAll(
          prev.map((job) => {
            const updated = { ...job };
            if (!job.overrides.has('channel_id')) updated.channel_id = newDefaults.channel_id;
            if (!job.overrides.has('subtitles')) updated.subtitles = newDefaults.subtitles;
            return updated;
          })
        )
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // --- Add jobs from dropzone ---
  const handleAddJobs = useCallback(
    (newJobs: StagedJob[]) => {
      setStagedJobs((prev) => revalidateAll([...prev, ...newJobs]));
      setDispatchResult(null);
      newJobs.forEach((j) => {
        const parts = [j.topic || '(no topic)'];
        if (j.script_filename) parts.push(`script: ${j.script_filename}`);
        if (j.video_filename) parts.push(`video: ${j.video_filename}`);
        log(`Staged: ${parts.join(' | ')}`);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log]
  );

  // --- Update a single job ---
  const handleUpdateJob = useCallback(
    (id: string, updates: Partial<StagedJob>) => {
      setStagedJobs((prev) =>
        revalidateAll(prev.map((j) => (j.id === id ? { ...j, ...updates } : j)))
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // --- Delete ---
  const handleDeleteJob = useCallback((id: string) => {
    setStagedJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const handleDeleteSelected = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setStagedJobs((prev) => prev.filter((j) => !set.has(j.id)));
    log(`Removed ${ids.length} row${ids.length !== 1 ? 's' : ''}`);
  }, [log]);

  const handleClearAll = useCallback(() => {
    setStagedJobs([]);
    setWarnings([]);
    setDispatchResult(null);
  }, []);

  // --- Dispatch helpers ---
  async function doDispatch(jobsToDispatch: StagedJob[]) {
    setDispatching(true);
    setDispatchResult(null);
    log(`Dispatching ${jobsToDispatch.length} job${jobsToDispatch.length !== 1 ? 's' : ''}...`);

    try {
      const uploadedAssets = new Map<
        string,
        { key: string; type: string; size_bytes: number }
      >();

      for (const job of jobsToDispatch) {
        if (!job.video_file) continue;
        log(`Uploading video: ${job.video_file.name} (${(job.video_file.size / 1024 / 1024).toFixed(1)} MB)...`);
        const uploadForm = new FormData();
        uploadForm.append('file', job.video_file);
        uploadForm.append('channel_id', job.channel_id);
        const resp = await fetch('/api/upload', { method: 'POST', body: uploadForm, credentials: 'same-origin' });
        const contentType = resp.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          const text = await resp.text();
          throw new Error(`Video upload for "${job.topic}" returned ${resp.status}: ${text.slice(0, 200)}`);
        }
        const uploadResult = await resp.json();
        if (!resp.ok || !uploadResult.success) {
          throw new Error(`Video upload failed for "${job.topic}": ${uploadResult.error ?? resp.statusText}`);
        }
        log(`Video uploaded: ${uploadResult.key}`);
        uploadedAssets.set(job.id, { key: uploadResult.key, type: uploadResult.type, size_bytes: uploadResult.size_bytes });
      }

      const formData = new FormData();
      const payloads: StagedJobPayload[] = jobsToDispatch.map((job) => ({
        topic: job.topic,
        script_text: job.script_text,
        channel_id: job.channel_id,
        template_id: defaults.template_id,
        format,
        production_version: defaults.production_version,
        subtitles: job.subtitles,
        skip_image_qc: defaults.skip_image_qc,
        skip_final_qc: defaults.skip_final_qc,
        language: defaults.language,
        video_key: null,
        pre_uploaded_asset: uploadedAssets.get(job.id) ?? null,
      }));

      log(`Sending ${payloads.length} payload${payloads.length !== 1 ? 's' : ''}...`);
      formData.append('jobs', JSON.stringify(payloads));
      const result = await dispatchStagedJobs(formData);

      const errors = result.results.filter((r) => !r.success).map((r) => `${r.topic}: ${r.error}`);
      setDispatchResult({ queued: result.queued, errors });

      if (result.queued > 0) log(`OK: ${result.queued} job${result.queued !== 1 ? 's' : ''} queued`);
      errors.forEach((e) => log(`ERROR: ${e}`));

      if (result.queued > 0) {
        const failedTopics = new Set(result.results.filter((r) => !r.success).map((r) => r.topic));
        const dispatchedIds = new Set(jobsToDispatch.map((j) => j.id));
        setStagedJobs((prev) =>
          prev.filter((j) => !dispatchedIds.has(j.id) || failedTopics.has(j.topic))
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? `${err.message}${err.stack ? '\n' + err.stack : ''}` : String(err);
      log(`FATAL: ${detail}`);
      setDispatchResult({ queued: 0, errors: [detail] });
    } finally {
      setDispatching(false);
    }
  }

  const handleDispatch = useCallback(() => {
    const valid = stagedJobs.filter((j) => j.validation_status !== 'error');
    if (valid.length > 0) doDispatch(valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedJobs, defaults, format]);

  const handleDispatchSelected = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      const valid = stagedJobs.filter((j) => set.has(j.id) && j.validation_status !== 'error');
      if (valid.length > 0) doDispatch(valid);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stagedJobs, defaults, format]
  );

  // --- Warnings ---
  const handleWarnings = useCallback((newWarnings: string[]) => {
    setWarnings((prev) => [...prev, ...newWarnings]);
    newWarnings.forEach((w) => log(`WARN: ${w}`));
  }, [log]);

  // Format-specific workstations replace the generic ingestion UI entirely
  if (format === 'TECH_COMPARISON') {
    return (
      <ComparisonIngestionPanel
        format={format}
        templates={templates}
        channels={channels}
        recentJobs={recentJobs}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-1 p-1 bg-surface-container rounded-lg w-fit">
        <button
          onClick={() => setMode('quick')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-all',
            mode === 'quick'
              ? 'bg-surface-bright text-text shadow-sm'
              : 'text-text-muted hover:text-text',
          )}
        >
          <Zap className="w-3.5 h-3.5" />
          Quick
        </button>
        <button
          onClick={() => setMode('batch')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-all',
            mode === 'batch'
              ? 'bg-surface-bright text-text shadow-sm'
              : 'text-text-muted hover:text-text',
          )}
        >
          <Layers className="w-3.5 h-3.5" />
          Batch
        </button>
      </div>

      {/* Quick mode */}
      {mode === 'quick' && (
        <QuickIngestionForm
          format={format}
          templates={templates}
          channels={channels}
          defaultChannelId={defaults.channel_id}
          defaultTemplateId={defaults.template_id}
        />
      )}

      {/* Batch mode */}
      {mode === 'batch' && (
      <>
      {/* Format Readiness Panel */}
      {readinessData.length > 0 && (
        <div className="glass rounded-xl border border-surface-bright overflow-hidden">
          <button
            onClick={() => setReadinessOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text hover:bg-surface-bright/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <span>Format Readiness</span>
              {anyMissing && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-warning/15 text-warning font-semibold">
                  Action needed
                </span>
              )}
            </div>
            <ChevronDown
              className={cn('w-4 h-4 text-text-muted transition-transform', readinessOpen && 'rotate-180')}
            />
          </button>
          {readinessOpen && (
            <div className="px-4 pb-4 border-t border-surface-bright pt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {readinessData.map((archetype) => (
                <ArchetypeReadinessCard key={archetype.id} archetype={archetype} />
              ))}
              <div className="col-span-full flex items-center gap-4 pt-1">
                <Link href="/archetypes" className="text-xs text-primary hover:underline">View Archetypes →</Link>
                <Link href="/characters" className="text-xs text-primary hover:underline">View Characters →</Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Batch Defaults */}
      <BatchDefaultsPanel
        templates={templates}
        channels={channels}
        defaults={defaults}
        onChange={handleDefaultsChange}
      />

      {/* Format hint */}
      <div className="flex items-center gap-2 px-1">
        <span className={`text-xs font-medium ${formatConfig.accentColor}`}>{formatConfig.label}</span>
        <span className="text-xs text-text-muted">— {formatConfig.description}</span>
      </div>

      {/* ── Entry area: Dropzone + Paste Topics side-by-side ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Left: File Dropzone */}
        <UnifiedDropzone
          defaults={defaults}
          onAddJobs={handleAddJobs}
          onWarnings={handleWarnings}
          dropzoneHint={formatConfig.dropzoneHint}
        />

        {/* Right: Paste Topics */}
        <PasteTopicsPanel
          defaults={defaults}
          onAddJobs={handleAddJobs}
          onLog={log}
        />
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <ErrorLogPanel title="Warnings" messages={warnings} type="warning" onDismiss={() => setWarnings([])} />
      )}

      {/* Dispatch Result */}
      {dispatchResult && (
        <div className="glass rounded-lg p-4 border border-surface-bright space-y-2">
          {dispatchResult.queued > 0 && (
            <p className="text-sm text-success">
              {dispatchResult.queued} job{dispatchResult.queued !== 1 ? 's' : ''} queued successfully
            </p>
          )}
          {dispatchResult.errors.length > 0 && (
            <ErrorLogPanel
              title="Dispatch Errors"
              messages={dispatchResult.errors}
              type="error"
              onDismiss={() => setDispatchResult(null)}
            />
          )}
        </div>
      )}

      {/* Staging Table */}
      <StagingTable
        jobs={stagedJobs}
        channels={channels}
        onUpdateJob={handleUpdateJob}
        onDeleteJob={handleDeleteJob}
        onDeleteSelected={handleDeleteSelected}
        onClearAll={handleClearAll}
        onDispatch={handleDispatch}
        onDispatchSelected={handleDispatchSelected}
        dispatching={dispatching}
        videoLabel={formatConfig.videoLabel}
        scriptLabel={formatConfig.scriptLabel}
        topicPlaceholder={formatConfig.topicPlaceholder}
      />

      {/* Activity Log */}
      <ActivityLog entries={activityLog} onClear={() => setActivityLog([])} />
      </>
      )}

      {/* Recent Jobs — shown in both modes */}
      <RecentJobsPoller format={format} initialJobs={recentJobs} />
    </div>
  );
}

// ── Quick Ingestion Form ─────────────────────────────────────────────────────

interface QuickIngestionFormProps {
  format: string;
  templates: Array<{ id: string; name: string; format: string }>;
  channels: Array<{ id: string; name: string; language: string }>;
  defaultChannelId: string;
  defaultTemplateId: string;
}

function QuickIngestionForm({
  format,
  templates,
  channels,
  defaultChannelId,
  defaultTemplateId,
}: QuickIngestionFormProps) {
  const [topic, setTopic] = useState('');
  const [channelId, setChannelId] = useState(defaultChannelId);
  const [templateId, setTemplateId] = useState(defaultTemplateId || templates[0]?.id || '');
  const [productionVersion, setProductionVersion] = useState<'V1' | 'V2'>('V2');
  const [submitting, setSubmitting] = useState(false);
  const [successCount, setSuccessCount] = useState(0);

  const selectedChannel = channels.find((c) => c.id === channelId);
  const canSubmit = topic.trim().length > 0 && channelId && templateId && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const result = await createJob({
        channel_id: channelId,
        template_id: templateId,
        format,
        production_version: productionVersion,
        initial_topic: topic.trim(),
        language: selectedChannel?.language ?? 'en',
      });

      if (result.success) {
        setSuccessCount((n) => n + 1);
        toast.success('Job queued', {
          description: topic.trim(),
          action: {
            label: 'View Jobs',
            onClick: () => { window.location.href = '/jobs'; },
          },
        });
        setTopic('');
      } else {
        toast.error('Failed to create job', {
          description: result.error ?? 'Unknown error',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="glass rounded-xl border border-surface-bright p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-text-muted">
          Quick Job
        </span>
        {successCount > 0 && (
          <span className="text-xs text-lime-400 font-semibold">
            {successCount} job{successCount !== 1 ? 's' : ''} queued this session
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Topic */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted" htmlFor="quick-topic">
            Topic
          </label>
          <textarea
            id="quick-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What should this video be about?"
            rows={3}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (canSubmit) handleSubmit(e as unknown as React.FormEvent);
              }
            }}
            className="w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/40 focus:outline-none focus:border-lime-400/50 resize-none leading-relaxed transition-colors"
          />
        </div>

        {/* Channel + Template row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor="quick-channel">
              Channel
            </label>
            <select
              id="quick-channel"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="w-full bg-surface-container border border-surface-bright rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-lime-400/50 transition-colors"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor="quick-template">
              Template
            </label>
            <select
              id="quick-template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full bg-surface-container border border-surface-bright rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-lime-400/50 transition-colors"
            >
              {templates.length === 0 ? (
                <option value="">No templates</option>
              ) : (
                templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Production version */}
        <div className="space-y-1">
          <span className="text-xs font-medium text-text-muted">Production version</span>
          <div className="flex gap-2">
            {(['V2', 'V1'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setProductionVersion(v)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-lg border transition-all',
                  productionVersion === v
                    ? 'bg-lime-400/10 border-lime-400/30 text-lime-400 font-semibold'
                    : 'border-surface-bright text-text-muted hover:text-text hover:border-surface-bright/80',
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all',
            canSubmit
              ? 'bg-lime-400 text-black hover:bg-lime-300 shadow-[0_0_16px_hsl(var(--lime-glow,80_100%_50%)/0.2)]'
              : 'bg-surface-container text-text-muted cursor-not-allowed',
          )}
        >
          {submitting ? (
            <span className="opacity-70">Queuing…</span>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              Create Job
            </>
          )}
        </button>
        <p className="text-xs text-text-disabled text-center">⌘↵ to submit</p>
      </form>
    </div>
  );
}

// ── Paste Topics Panel ──────────────────────────────────────────────────────

interface PasteTopicsPanelProps {
  defaults: BatchDefaults;
  onAddJobs: (jobs: StagedJob[]) => void;
  onLog: (msg: string) => void;
}

function PasteTopicsPanel({ defaults, onAddJobs, onLog }: PasteTopicsPanelProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const topics = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  function handleAdd() {
    if (topics.length === 0) return;
    const newJobs: StagedJob[] = topics.map((topic) => ({
      id: generateId(),
      topic,
      script_text: null,
      script_filename: null,
      video_file: null,
      video_filename: null,
      channel_id: defaults.channel_id,
      subtitles: defaults.subtitles,
      overrides: new Set<string>(),
      validation_status: 'valid',
      validation_messages: [],
    }));
    onAddJobs(newJobs);
    onLog(`Staged ${topics.length} topic${topics.length !== 1 ? 's' : ''} (AI will generate scripts)`);
    setText('');
    textareaRef.current?.focus();
  }

  function handleAddEmpty() {
    onAddJobs([{
      id: generateId(),
      topic: '',
      script_text: null,
      script_filename: null,
      video_file: null,
      video_filename: null,
      channel_id: defaults.channel_id,
      subtitles: defaults.subtitles,
      overrides: new Set<string>(),
      validation_status: 'error',
      validation_messages: ['Topic is required'],
    }]);
  }

  return (
    <div className="glass rounded-lg border border-surface-bright p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ListPlus className="w-4 h-4 text-text-muted flex-shrink-0" />
        <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">
          Paste Topics
        </span>
        {topics.length > 0 && (
          <span className="ml-auto text-xs text-primary font-semibold">
            {topics.length} topic{topics.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl/Cmd+Enter submits
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
          }
        }}
        placeholder={"The Rise of AI\nClimate Change Economics\nTerm Limits Analysis\n\n(one topic per line)"}
        rows={6}
        className="flex-1 w-full px-3 py-2 text-sm bg-surface-container border border-surface-bright rounded-lg text-text placeholder-text-muted/40 focus:outline-none focus:border-primary/50 resize-none font-mono leading-relaxed"
      />

      <div className="flex items-center gap-2">
        <button
          onClick={handleAdd}
          disabled={topics.length === 0}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all',
            topics.length > 0
              ? 'bg-primary text-white hover:bg-primary/90 shadow-[0_0_12px_hsl(var(--primary)/0.25)]'
              : 'bg-surface-container text-text-muted cursor-not-allowed'
          )}
        >
          <ListPlus className="w-4 h-4" />
          Add {topics.length > 0 ? topics.length : ''} Topic{topics.length !== 1 ? 's' : ''}
        </button>
        <button
          onClick={handleAddEmpty}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-muted hover:text-text border border-surface-bright hover:border-primary/30 rounded-lg transition-all"
          title="Add blank row"
        >
          <Plus className="w-3.5 h-3.5" />
          Empty
        </button>
      </div>
      <p className="text-xs text-text-disabled text-center">
        ⌘↵ to add · AI generates scripts for each topic
      </p>
    </div>
  );
}

// ── Archetype Readiness Card ────────────────────────────────────────────────

function ArchetypeReadinessCard({ archetype }: { archetype: ArchetypeReadiness }) {
  return (
    <div className="glass rounded-lg border border-surface-bright p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-text">{archetype.name}</span>
        {archetype.imageStyle && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-container text-text-muted font-mono">
            {archetype.imageStyle}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {archetype.hasApprovedStyleGuide ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-warning flex-shrink-0" />
        )}
        <span className={cn('text-xs', archetype.hasApprovedStyleGuide ? 'text-success' : 'text-warning')}>
          {archetype.hasApprovedStyleGuide ? 'Style guide approved' : 'No approved style guide'}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-text-muted">
          {archetype.activeCharacterCount === 0
            ? 'No active characters'
            : `${archetype.activeCharacterCount} active character${archetype.activeCharacterCount !== 1 ? 's' : ''}`}
        </span>
      </div>
    </div>
  );
}

// ── Error Log Panel ─────────────────────────────────────────────────────────

function ErrorLogPanel({
  title, messages, type, onDismiss,
}: {
  title: string;
  messages: string[];
  type: 'warning' | 'error';
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const fullLog = `[${title}] ${new Date().toISOString()}\n${messages.map((m, i) => `${i + 1}. ${m}`).join('\n')}`;
  const borderColor = type === 'error' ? 'border-error/20' : 'border-warning/20';
  const bgColor = type === 'error' ? 'bg-error/5' : 'bg-warning/5';
  const textColor = type === 'error' ? 'text-error' : 'text-warning';

  async function handleCopy() {
    try { await navigator.clipboard.writeText(fullLog); }
    catch { const t = document.createElement('textarea'); t.value = fullLog; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={`glass rounded-lg border ${borderColor} ${bgColor} overflow-hidden`}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-bright/50">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`w-3.5 h-3.5 ${textColor}`} />
          <span className={`text-xs font-medium ${textColor}`}>{title} ({messages.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-text hover:bg-surface-container/50 transition-colors">
            {copied ? <><Check className="w-3 h-3 text-success" /><span className="text-success">Copied</span></> : <><Copy className="w-3 h-3" /><span>Copy</span></>}
          </button>
          <button onClick={onDismiss} className="px-2 py-0.5 text-xs text-text-muted hover:text-text border border-surface-bright/50 rounded transition-colors">Dismiss</button>
        </div>
      </div>
      <div className="px-4 py-2 max-h-[200px] overflow-y-auto space-y-1">
        {messages.map((msg, i) => <p key={i} className="text-xs text-text-muted font-mono break-all">{msg}</p>)}
      </div>
    </div>
  );
}

// ── Activity Log ─────────────────────────────────────────────────────────────

function ActivityLog({ entries, onClear }: { entries: string[]; onClear: () => void }) {
  const [copied, setCopied] = useState(false);
  if (entries.length === 0) return null;
  const fullLog = entries.join('\n');

  async function handleCopy() {
    try { await navigator.clipboard.writeText(fullLog); }
    catch { const t = document.createElement('textarea'); t.value = fullLog; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="glass rounded-lg border border-surface-bright overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-bright bg-surface-container/50">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-xs font-medium text-text-muted">Activity Log ({entries.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-text hover:bg-surface-container/50 transition-colors">
            {copied ? <><Check className="w-3 h-3 text-success" /><span className="text-success">Copied</span></> : <><Copy className="w-3 h-3" /><span>Copy Log</span></>}
          </button>
          <button onClick={onClear} className="px-2 py-0.5 text-xs text-text-muted hover:text-text border border-surface-bright/50 rounded transition-colors">Clear</button>
        </div>
      </div>
      <div className="px-4 py-2 max-h-[250px] overflow-y-auto bg-surface-container/50">
        {entries.map((entry, i) => {
          let color = 'text-text-muted';
          if (entry.includes('ERROR') || entry.includes('FATAL')) color = 'text-error';
          else if (entry.includes('WARN')) color = 'text-warning';
          else if (entry.includes('OK:')) color = 'text-success';
          return <p key={i} className={`text-xs font-mono ${color} leading-5 break-all`}>{entry}</p>;
        })}
      </div>
    </div>
  );
}
