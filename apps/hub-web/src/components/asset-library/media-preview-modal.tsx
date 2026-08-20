'use client';

import { useEffect } from 'react';
import { X, Calendar, FileType, HardDrive, Clock } from 'lucide-react';
import type { AssetCardAsset } from './asset-card';
import { VideoPreview } from './video-preview';
import { AudioPreview } from './audio-preview';
import { ImagePreview } from './image-preview';

interface MediaPreviewModalProps {
  asset: AssetCardAsset | null;
  onClose: () => void;
  onEdit: (asset: AssetCardAsset) => void;
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return 'Unknown';
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format date to human-readable format
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Route to correct preview component based on asset_type
 */
function renderPreview(asset: AssetCardAsset) {
  const assetType = asset.asset_type.toLowerCase();

  if (assetType.startsWith('video/')) {
    return <VideoPreview assetId={asset.id} name={asset.name} />;
  }

  if (assetType.startsWith('audio/')) {
    return (
      <AudioPreview
        assetId={asset.id}
        name={asset.name}
        waveformData={asset.waveform_data ?? undefined}
      />
    );
  }

  if (assetType.startsWith('image/')) {
    return <ImagePreview assetId={asset.id} name={asset.name} />;
  }

  // Fallback for unknown types
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 400,
        gap: 12,
        padding: 40,
        color: 'var(--v2-text-2)',
        background: 'var(--v2-surface-container)',
        borderRadius: 8,
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 48, opacity: 0.3 }}
      >
        file_present
      </span>
      <p style={{ margin: 0, fontSize: 14 }}>
        Preview not available for this asset type
      </p>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
        Type: {asset.asset_type}
      </p>
    </div>
  );
}

export function MediaPreviewModal({ asset, onClose, onEdit }: MediaPreviewModalProps) {
  const open = asset !== null;

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || !asset) return null;

  const duration = formatDuration(asset.duration_seconds);
  const showDuration = duration !== null;

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="modal-backdrop"
        className="fixed inset-0 bg-background/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-[900px] glass-card rounded-2xl shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Media Preview"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10">
          <h2 className="text-lg font-bold text-text">{asset.name}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-bright transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body - Preview + Metadata */}
        <div className="flex flex-col lg:flex-row">
          {/* Preview area */}
          <div className="flex-1 p-6">{renderPreview(asset)}</div>

          {/* Metadata panel */}
          <div className="w-full lg:w-80 p-6 bg-surface-container/30 border-t lg:border-t-0 lg:border-l border-primary/10 space-y-5">
            {/* File Format */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-text-muted">
                <FileType className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Format</span>
              </div>
              <p className="text-sm font-semibold text-text uppercase">
                {asset.file_format}
              </p>
            </div>

            {/* File Size */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-text-muted">
                <HardDrive className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Size</span>
              </div>
              <p className="text-sm font-semibold text-text">
                {formatBytes(asset.size_bytes)}
              </p>
            </div>

            {/* Duration (only for video/audio) */}
            {showDuration && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-text-muted">
                  <Clock className="w-4 h-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">Duration</span>
                </div>
                <p className="text-sm font-semibold text-text">{duration}</p>
              </div>
            )}

            {/* Created Date */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-text-muted">
                <Calendar className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Created</span>
              </div>
              <p className="text-sm font-semibold text-text">
                {formatDate(asset.created_at)}
              </p>
            </div>

            {/* Edit button */}
            <button
              onClick={() => onEdit(asset)}
              className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Edit Asset
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
