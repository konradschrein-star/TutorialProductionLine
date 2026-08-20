'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useDropzone } from 'react-dropzone';
import { Mic, FileAudio, FileVideo, X, CheckCircle, AlertCircle } from 'lucide-react';
import { setNarrationSource, clearNarrationSource } from '@/app/actions/jobs';

interface NarrationSourceDropzoneProps {
  jobId: string;
  currentPath: string | null;
}

export function NarrationSourceDropzone({ jobId, currentPath }: NarrationSourceDropzoneProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      const file = acceptedFiles[0];
      setUploading(true);
      setProgress(0);
      setError(null);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const uploadResult = await new Promise<{ path: string; size_bytes: number }>(
          (resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/narration-upload');

            xhr.upload.addEventListener('progress', (e) => {
              if (e.lengthComputable) {
                setProgress(Math.round((e.loaded / e.total) * 90));
              }
            });

            xhr.addEventListener('load', () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  resolve(JSON.parse(xhr.responseText));
                } catch {
                  reject(new Error('Invalid response from upload server'));
                }
              } else {
                try {
                  const body = JSON.parse(xhr.responseText);
                  reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
                } catch {
                  reject(new Error(`Upload failed (${xhr.status})`));
                }
              }
            });

            xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
            xhr.send(formData);
          }
        );

        setProgress(95);

        const result = await setNarrationSource(jobId, uploadResult.path);
        setProgress(100);

        if (result.success) {
          router.refresh();
        } else {
          setError(result.error || 'Failed to set narration source');
          setProgress(0);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
        setProgress(0);
      } finally {
        setUploading(false);
      }
    },
    [jobId, router]
  );

  const handleClear = useCallback(async () => {
    setClearing(true);
    setError(null);
    const result = await clearNarrationSource(jobId);
    setClearing(false);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error || 'Failed to clear narration source');
    }
  }, [jobId, router]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    disabled: uploading || clearing,
    // No accept filter — any video or audio file is valid; black-screen or silent files produce a silent narration track
  });

  if (currentPath) {
    const filename = currentPath.split('/').pop() ?? currentPath;
    return (
      <div className="glass rounded-lg p-4 border border-success/30 bg-success/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <CheckCircle className="w-5 h-5 text-success flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-text">Narration source set</p>
              <p className="text-xs text-text-muted font-mono truncate max-w-xs">{filename}</p>
            </div>
          </div>
          <button
            onClick={handleClear}
            disabled={clearing}
            aria-label="Remove narration source"
            title="Remove narration source"
            className="p-1.5 rounded hover:bg-surface-bright transition-colors text-text-muted hover:text-error disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={`glass rounded-lg p-6 border-2 border-dashed transition-all cursor-pointer ${
          isDragActive
            ? 'border-primary bg-primary/10'
            : 'border-surface-bright hover:border-primary/50'
        } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input {...getInputProps()} />
        <div className="text-center">
          {uploading ? (
            <>
              <Mic className="w-8 h-8 text-primary mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-medium text-text mb-2">Uploading... {progress}%</p>
              <div className="w-full bg-surface-container rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-center space-x-2 mb-3">
                <FileVideo className="w-6 h-6 text-text-muted" />
                <FileAudio className="w-6 h-6 text-text-muted" />
              </div>
              <p className="text-sm font-medium text-text mb-1">
                {isDragActive ? 'Drop narration file here' : 'Drag narration source'}
              </p>
              <p className="text-xs text-text-muted">
                or click to browse — video or audio, any format
              </p>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start space-x-2 text-error">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="text-xs">{error}</p>
        </div>
      )}

      <p className="text-xs text-text-disabled">
        When set, TTS generation is skipped and this file is used as the narration audio source.
      </p>
    </div>
  );
}
