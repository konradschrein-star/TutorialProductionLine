'use client';

import type { Asset } from '@repo/db';

/**
 * AssetVariantsPanel Component
 *
 * Displays a list of asset variants with their metadata.
 * Shows variant type, resolution, language, and other variant-specific details.
 */

interface AssetVariantsPanelProps {
  variants: Asset[];
  onSelectVariant?: (variant: Asset) => void;
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

/**
 * Format duration in seconds to MM:SS
 */
function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get display label for variant type
 */
function getVariantTypeLabel(variantType: string | null | undefined): string {
  if (!variantType) return 'Unknown';

  const labels: Record<string, string> = {
    original: 'Original',
    compressed: 'Compressed',
    mobile: 'Mobile',
    translated: 'Translated',
    cropped: 'Cropped',
    thumbnail: 'Thumbnail',
  };

  return labels[variantType] || variantType;
}

/**
 * Get badge color for variant type
 */
function getVariantTypeBadgeColor(variantType: string | null | undefined): string {
  if (!variantType) return 'rgba(var(--v2-text-2-rgb), 0.6)';

  const colors: Record<string, string> = {
    original: '#10B981',
    compressed: '#F59E0B',
    mobile: '#3B82F6',
    translated: '#8B5CF6',
    cropped: '#EC4899',
    thumbnail: '#6B7280',
  };

  return colors[variantType] || 'rgba(var(--v2-text-2-rgb), 0.6)';
}

export function AssetVariantsPanel({ variants, onSelectVariant }: AssetVariantsPanelProps) {
  if (variants.length === 0) {
    return (
      <div
        style={{
          padding: 16,
          textAlign: 'center',
          color: 'var(--v2-text-2)',
          fontSize: 12,
        }}
      >
        No variants
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {variants.map((variant) => (
        <button
          key={variant.id}
          onClick={() => onSelectVariant?.(variant)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: 8,
            borderRadius: 6,
            background: 'var(--v2-surface-container)',
            border: '1px solid var(--v2-surface-bright)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(var(--v2-surface-bright-rgb), 0.5)';
            e.currentTarget.style.borderColor = 'rgba(var(--v2-accent-rgb), 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--v2-surface-container)';
            e.currentTarget.style.borderColor = 'var(--v2-surface-bright)';
          }}
        >
          {/* Variant type badge */}
          <div
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              background: getVariantTypeBadgeColor(variant.variant_type),
              color: 'white',
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            {getVariantTypeLabel(variant.variant_type)}
          </div>

          {/* Variant details */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--v2-text-1)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {variant.name}
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--v2-text-2)',
                display: 'flex',
                gap: 8,
                marginTop: 2,
              }}
            >
              {(() => {
                const metadata = variant.variant_metadata as Record<string, unknown> | null | undefined;
                if (!metadata || typeof metadata !== 'object') return null;

                return (
                  <>
                    {metadata.resolution && <span>{String(metadata.resolution)}</span>}
                    {metadata.language && <span>Lang: {String(metadata.language)}</span>}
                    {metadata.bitrate && <span>{String(metadata.bitrate)}</span>}
                  </>
                );
              })()}
              <span>{formatBytes(variant.size_bytes)}</span>
              {variant.duration_seconds && (
                <span>{formatDuration(variant.duration_seconds)}</span>
              )}
            </div>
          </div>

          {/* Action icon */}
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 16,
              color: 'var(--v2-text-2)',
            }}
          >
            chevron_right
          </span>
        </button>
      ))}
    </div>
  );
}
