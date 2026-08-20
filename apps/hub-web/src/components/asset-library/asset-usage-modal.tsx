'use client';

import { useEffect, useState } from 'react';
import type { AssetCardAsset } from './asset-card';

/**
 * AssetUsageModal Component
 *
 * Displays which jobs use a specific media asset.
 * Helps operators understand the impact of deleting or modifying an asset.
 *
 * Features:
 * - List of jobs using this asset
 * - Job details: title, status, format, template
 * - Links to view each job
 * - Empty state if asset is unused
 * - Loading and error states
 */

interface AssetUsageModalProps {
  asset: AssetCardAsset;
  onClose: () => void;
}

interface JobUsage {
  id: string;
  title: string;
  status: string;
  format: string;
  template_name: string | null;
  created_at: string;
}

interface UsageData {
  total_jobs: number;
  jobs: JobUsage[];
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'rgba(156, 163, 175, 0.2)',
  AWAITING_SCRIPT: 'rgba(59, 130, 246, 0.2)',
  SCRIPT_READY: 'rgba(59, 130, 246, 0.2)',
  AWAITING_IMAGE_QC: 'rgba(245, 158, 11, 0.2)',
  IMAGE_QC_APPROVED: 'rgba(16, 185, 129, 0.2)',
  RENDERING: 'rgba(139, 92, 246, 0.2)',
  AWAITING_QC: 'rgba(245, 158, 11, 0.2)',
  QC_APPROVED: 'rgba(16, 185, 129, 0.2)',
  PUBLISHED: 'rgba(16, 185, 129, 0.2)',
  FAILED: 'rgba(239, 68, 68, 0.2)',
};

export function AssetUsageModal({ asset, onClose }: AssetUsageModalProps) {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUsage = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/assets/${asset.id}/usage`);
        if (!response.ok) {
          throw new Error('Failed to fetch usage data');
        }

        const data = await response.json();
        setUsage(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchUsage();
  }, [asset.id]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        {/* Modal */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--v2-surface-container)',
            borderRadius: 16,
            border: '1px solid var(--v2-surface-bright)',
            width: '100%',
            maxWidth: 700,
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--v2-surface-bright)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--v2-text-1)', margin: '0 0 4px 0' }}>
                Asset Usage
              </h2>
              <p style={{ fontSize: 13, color: 'var(--v2-text-2)', margin: 0 }}>
                {asset.name}
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                padding: 8,
                borderRadius: 8,
                border: 'none',
                background: 'transparent',
                color: 'var(--v2-text-2)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--v2-surface-bright)';
                e.currentTarget.style.color = 'var(--v2-text-1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--v2-text-2)';
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                close
              </span>
            </button>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
                <div style={{ fontSize: 14, color: 'var(--v2-text-2)' }}>Loading usage data...</div>
              </div>
            )}

            {error && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 8,
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: 'var(--v2-text-1)',
                  fontSize: 13,
                }}
              >
                <strong>Error:</strong> {error}
              </div>
            )}

            {!loading && !error && usage && (
              <>
                {/* Summary */}
                <div
                  style={{
                    padding: 16,
                    borderRadius: 8,
                    background: usage.total_jobs > 0
                      ? 'rgba(var(--v2-accent-rgb), 0.1)'
                      : 'var(--v2-surface-bright)',
                    border: '1px solid',
                    borderColor: usage.total_jobs > 0
                      ? 'rgba(var(--v2-accent-rgb), 0.3)'
                      : 'var(--v2-surface-bright)',
                    marginBottom: 20,
                  }}
                >
                  <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--v2-text-1)', marginBottom: 4 }}>
                    {usage.total_jobs}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--v2-text-2)' }}>
                    {usage.total_jobs === 1 ? 'job uses' : 'jobs use'} this asset
                  </div>
                </div>

                {/* Job list */}
                {usage.total_jobs === 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: '40px 20px',
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{
                        fontSize: 48,
                        color: 'rgba(var(--v2-text-2-rgb), 0.2)',
                        marginBottom: 16,
                      }}
                    >
                      check_circle
                    </span>
                    <p style={{ fontSize: 14, color: 'var(--v2-text-1)', fontWeight: 500, margin: '0 0 8px 0' }}>
                      Asset is not in use
                    </p>
                    <p style={{ fontSize: 13, color: 'var(--v2-text-2)', margin: 0, textAlign: 'center' }}>
                      This asset can be safely deleted without affecting any jobs.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {usage.jobs.map((job) => (
                      <a
                        key={job.id}
                        href={`/jobs/${job.id}`}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          padding: 16,
                          borderRadius: 8,
                          background: 'var(--v2-surface-bright)',
                          border: '1px solid var(--v2-surface-bright)',
                          textDecoration: 'none',
                          color: 'inherit',
                          transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(var(--v2-accent-rgb), 0.4)';
                          e.currentTarget.style.background = 'var(--v2-surface-container)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'var(--v2-surface-bright)';
                          e.currentTarget.style.background = 'var(--v2-surface-bright)';
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--v2-text-1)', margin: 0, flex: 1 }}>
                            {job.title}
                          </h3>
                          <span
                            style={{
                              padding: '4px 8px',
                              borderRadius: 6,
                              background: STATUS_COLORS[job.status] || 'rgba(156, 163, 175, 0.2)',
                              fontSize: 11,
                              fontWeight: 600,
                              color: 'var(--v2-text-1)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}
                          >
                            {job.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: 'var(--v2-text-2)' }}>
                          {job.template_name && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                                description
                              </span>
                              {job.template_name}
                            </span>
                          )}
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                              schedule
                            </span>
                            {new Date(job.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
