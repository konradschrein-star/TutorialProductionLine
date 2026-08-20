'use client';

import { useState, useEffect } from 'react';

/**
 * BatchUploadProgress Component
 *
 * Floating progress panel for batch file uploads.
 * Shows real-time progress for each file being uploaded.
 *
 * Features:
 * - Displays per-file progress (0-100%)
 * - Success/error indicators
 * - Retry button for failed uploads
 * - Collapse/expand panel
 * - Close button (uploads continue in background)
 * - Auto-close when all complete
 */

export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'processing' | 'success' | 'error';
  error: string | null;
  assetId?: string;
}

interface BatchUploadProgressProps {
  items: UploadItem[];
  onRetry: (id: string) => void;
  onClose: () => void;
}

const STATUS_ICONS: Record<UploadItem['status'], string> = {
  pending: 'schedule',
  uploading: 'upload',
  processing: 'autorenew',
  success: 'check_circle',
  error: 'error',
};

const STATUS_COLORS: Record<UploadItem['status'], string> = {
  pending: 'rgba(156, 163, 175, 0.2)',
  uploading: 'rgba(59, 130, 246, 0.2)',
  processing: 'rgba(139, 92, 246, 0.2)',
  success: 'rgba(16, 185, 129, 0.2)',
  error: 'rgba(239, 68, 68, 0.2)',
};

const STATUS_TEXT_COLORS: Record<UploadItem['status'], string> = {
  pending: 'var(--v2-text-2)',
  uploading: 'rgb(59, 130, 246)',
  processing: 'rgb(139, 92, 246)',
  success: 'rgb(16, 185, 129)',
  error: 'rgb(239, 68, 68)',
};

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

export function BatchUploadProgress({ items, onRetry, onClose }: BatchUploadProgressProps) {
  const [collapsed, setCollapsed] = useState(false);

  const successCount = items.filter(i => i.status === 'success').length;
  const errorCount = items.filter(i => i.status === 'error').length;
  const uploadingCount = items.filter(i => i.status === 'uploading' || i.status === 'processing').length;
  const totalCount = items.length;

  const allComplete = successCount + errorCount === totalCount;

  // Calculate overall progress
  const overallProgress = items.reduce((sum, item) => sum + item.progress, 0) / totalCount;

  // Auto-close after 3 seconds when all complete
  useEffect(() => {
    if (allComplete && errorCount === 0) {
      const timer = setTimeout(() => {
        onClose();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [allComplete, errorCount, onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 400,
        maxHeight: collapsed ? 60 : 500,
        background: 'var(--v2-surface-container)',
        borderRadius: 12,
        border: '1px solid var(--v2-surface-bright)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'max-height 0.3s ease',
        zIndex: 1000,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: collapsed ? 'none' : '1px solid var(--v2-surface-bright)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--v2-text-1)' }}>
              {allComplete ? 'check_circle' : 'upload'}
            </span>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--v2-text-1)', margin: 0 }}>
              {allComplete
                ? `Uploaded ${successCount} of ${totalCount} files`
                : `Uploading ${totalCount} files...`}
            </h3>
          </div>
          {!collapsed && (
            <div
              style={{
                width: '100%',
                height: 4,
                background: 'rgba(var(--v2-text-2-rgb), 0.1)',
                borderRadius: 2,
                overflow: 'hidden',
                marginTop: 8,
              }}
            >
              <div
                style={{
                  width: `${overallProgress}%`,
                  height: '100%',
                  background: errorCount > 0
                    ? 'rgb(239, 68, 68)'
                    : allComplete
                    ? 'rgb(16, 185, 129)'
                    : 'var(--v2-accent)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(!collapsed);
            }}
            style={{
              padding: 6,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: 'var(--v2-text-2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              {collapsed ? 'expand_less' : 'expand_more'}
            </span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            style={{
              padding: 6,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: 'var(--v2-text-2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              close
            </span>
          </button>
        </div>
      </div>

      {/* Upload list */}
      {!collapsed && (
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                padding: 12,
                borderRadius: 8,
                background: STATUS_COLORS[item.status],
                border: '1px solid',
                borderColor: item.status === 'error'
                  ? 'rgba(239, 68, 68, 0.3)'
                  : 'var(--v2-surface-bright)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {/* File info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 20,
                    color: STATUS_TEXT_COLORS[item.status],
                  }}
                >
                  {STATUS_ICONS[item.status]}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: 'var(--v2-text-1)',
                      margin: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.file.name}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--v2-text-2)', margin: 0 }}>
                    {formatBytes(item.file.size)}
                  </p>
                </div>
                {item.status === 'error' && (
                  <button
                    onClick={() => onRetry(item.id)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      background: 'transparent',
                      color: 'rgb(239, 68, 68)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    Retry
                  </button>
                )}
              </div>

              {/* Progress bar */}
              {(item.status === 'uploading' || item.status === 'processing') && (
                <div
                  style={{
                    width: '100%',
                    height: 3,
                    background: 'rgba(var(--v2-text-2-rgb), 0.1)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${item.progress}%`,
                      height: '100%',
                      background: STATUS_TEXT_COLORS[item.status],
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              )}

              {/* Status text */}
              <p
                style={{
                  fontSize: 11,
                  color: STATUS_TEXT_COLORS[item.status],
                  margin: 0,
                  fontWeight: 500,
                }}
              >
                {item.status === 'pending' && 'Waiting...'}
                {item.status === 'uploading' && `Uploading... ${Math.round(item.progress)}%`}
                {item.status === 'processing' && 'Processing...'}
                {item.status === 'success' && 'Complete'}
                {item.status === 'error' && (item.error || 'Upload failed')}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Summary footer */}
      {!collapsed && allComplete && (
        <div
          style={{
            padding: 12,
            borderTop: '1px solid var(--v2-surface-bright)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'var(--v2-text-2)',
          }}
        >
          <span>
            {successCount > 0 && `✓ ${successCount} uploaded`}
            {errorCount > 0 && ` • ${errorCount} failed`}
          </span>
          {errorCount === 0 && (
            <span style={{ color: 'rgb(16, 185, 129)', fontWeight: 500 }}>
              Auto-closing in 3s
            </span>
          )}
        </div>
      )}
    </div>
  );
}
