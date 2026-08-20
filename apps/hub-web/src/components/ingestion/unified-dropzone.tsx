'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { detectAndGroupFiles, generateId } from '@/lib/services/file-detector';
import { parseZipAction } from '@/app/actions/parse-zip-action';
import type { StagedJob } from './staging-table';
import type { BatchDefaults } from './batch-defaults-panel';

interface UnifiedDropzoneProps {
  defaults: BatchDefaults;
  onAddJobs: (jobs: StagedJob[]) => void;
  onWarnings: (warnings: string[]) => void;
  dropzoneHint?: string;
}

const MAX_SIZE = 15 * 1024 * 1024 * 1024; // 15GB

export function UnifiedDropzone({
  defaults,
  onAddJobs,
  onWarnings,
  dropzoneHint,
}: UnifiedDropzoneProps) {
  const [processing, setProcessing] = useState(false);

  const onDrop = useCallback(
    async (acceptedFiles: File[], rejectedFiles: any[]) => {
      // Report rejected files
      if (rejectedFiles.length > 0) {
        const rejectionWarnings = rejectedFiles.map((r: any) => {
          const name = r.file?.name ?? 'unknown';
          const reasons = (r.errors ?? [])
            .map((e: any) => e.message ?? e.code)
            .join(', ');
          return `Rejected "${name}": ${reasons}`;
        });
        onWarnings(rejectionWarnings);
      }

      if (acceptedFiles.length === 0) return;

      setProcessing(true);
      const allWarnings: string[] = [];

      try {
        // Separate zip files from other files
        const zipFiles: File[] = [];
        const otherFiles: File[] = [];

        for (const file of acceptedFiles) {
          if (file.name.toLowerCase().endsWith('.zip')) {
            zipFiles.push(file);
          } else {
            otherFiles.push(file);
          }
        }

        const newJobs: StagedJob[] = [];

        // Process zip files via server action
        for (const zipFile of zipFiles) {
          const formData = new FormData();
          formData.append('file', zipFile);

          const result = await parseZipAction(formData);

          if (result.warnings.length > 0) {
            allWarnings.push(...result.warnings);
          }
          if (result.errors.length > 0) {
            allWarnings.push(
              ...result.errors.map(
                (e) => `${e.folder ? e.folder + ': ' : ''}${e.error}`
              )
            );
          }

          // Apply batch_meta overrides if present
          const effectiveDefaults = { ...defaults };
          if (result.batch_meta?.template_id) {
            effectiveDefaults.template_id = result.batch_meta.template_id;
          }
          if (result.batch_meta?.channel_id) {
            effectiveDefaults.channel_id = result.batch_meta.channel_id;
          }

          for (const job of result.jobs) {
            newJobs.push({
              id: generateId(),
              topic: job.topic,
              script_text: job.script_text,
              script_filename: 'script.txt',
              video_file: null,
              video_filename: job.has_video ? job.video_filename : null,
              channel_id: effectiveDefaults.channel_id,
              subtitles: effectiveDefaults.subtitles,
              overrides: new Set<string>(),
              validation_status: 'valid',
              validation_messages: [],
            });
          }
        }

        // Process non-zip files client-side
        if (otherFiles.length > 0) {
          const detection = await detectAndGroupFiles(otherFiles);

          if (detection.warnings.length > 0) {
            allWarnings.push(...detection.warnings);
          }

          for (const detected of detection.jobs) {
            newJobs.push({
              id: detected.id,
              topic: detected.topic,
              script_text: detected.script_text,
              script_filename: detected.script_filename,
              video_file: detected.video_file,
              video_filename: detected.video_filename,
              channel_id: defaults.channel_id,
              subtitles: defaults.subtitles,
              overrides: new Set<string>(),
              validation_status: 'valid',
              validation_messages: [],
            });
          }
        }

        if (newJobs.length > 0) {
          onAddJobs(newJobs);
        }

        if (allWarnings.length > 0) {
          onWarnings(allWarnings);
        }
      } catch (err) {
        const stack = err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err);
        onWarnings([`Processing failed: ${stack}`]);
      } finally {
        setProcessing(false);
      }
    },
    [defaults, onAddJobs, onWarnings]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/zip': ['.zip'],
      'application/x-zip-compressed': ['.zip'],
      'video/mp4': ['.mp4'],
      'video/quicktime': ['.mov'],
      'text/plain': ['.txt', '.srt'],
      'text/markdown': ['.md'],
      'application/x-subrip': ['.srt'],
    },
    maxSize: MAX_SIZE,
    disabled: processing,
    multiple: true,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        {...getRootProps()}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          borderRadius: 12,
          border: isDragActive
            ? '2px dashed rgba(var(--v2-accent-rgb), 0.6)'
            : '2px dashed rgba(var(--v2-accent-rgb), 0.2)',
          background: isDragActive
            ? 'rgba(var(--v2-accent-rgb), 0.08)'
            : 'rgba(255,255,255,0.02)',
          cursor: processing ? 'not-allowed' : 'pointer',
          opacity: processing ? 0.5 : 1,
          transition: 'all 0.2s ease',
        }}
      >
        <input {...getInputProps()} />

        {processing ? (
          <>
            <div
              style={{
                width: 40,
                height: 40,
                border: '3px solid rgba(var(--v2-accent-rgb), 0.2)',
                borderTopColor: 'var(--v2-accent)',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
                marginBottom: 16,
              }}
            />
            <p style={{ fontSize: 13, color: 'rgba(205,195,215,0.6)' }}>
              Processing files...
            </p>
          </>
        ) : (
          <>
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 40,
                color: isDragActive ? 'var(--v2-accent)' : 'rgba(205,195,215,0.6)',
                marginBottom: 16,
              }}
            >
              cloud_upload
            </span>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#e5e2e1', marginBottom: 4 }}>
              {isDragActive
                ? 'Drop files here'
                : (dropzoneHint ?? 'Drop files here — .zip, .mp4, .mov, .txt, .md, .srt')}
            </p>
            <p style={{ fontSize: 11, color: 'rgba(205,195,215,0.5)' }}>
              or click to browse
            </p>
          </>
        )}
      </div>

      <button
        onClick={() => {
          onAddJobs([
            {
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
            },
          ]);
        }}
        disabled={processing}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(var(--v2-accent-rgb), 0.2)',
          borderRadius: 8,
          fontSize: 11,
          fontWeight: 600,
          color: 'rgba(205,195,215,0.6)',
          cursor: processing ? 'not-allowed' : 'pointer',
          opacity: processing ? 0.5 : 1,
          transition: 'all 0.2s',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          add
        </span>
        Add Empty Row
      </button>
    </div>
  );
}
