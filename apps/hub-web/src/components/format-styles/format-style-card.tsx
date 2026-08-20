'use client';

import { GlassCard } from '@/app/(authenticated)/_components/glass-card';
import type { FormatStyleLibrary } from '@/lib/repositories/format-style-library-repository';

interface FormatStyleCardProps {
  library: FormatStyleLibrary & { reference_count?: number };
  onEdit?: () => void;
  onDelete?: () => void;
  onSelect?: () => void;
  isSelected?: boolean;
}

export function FormatStyleCard({
  library,
  onEdit,
  onDelete,
  onSelect,
  isSelected,
}: FormatStyleCardProps) {
  const isClickable = !!onSelect;

  return (
    <GlassCard
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        cursor: isClickable ? 'pointer' : 'default',
        border: isSelected
          ? '2px solid var(--v2-accent)'
          : '1px solid rgba(var(--v2-accent-rgb), 0.12)',
        background: isSelected
          ? 'rgba(var(--v2-accent-rgb), 0.08)'
          : 'rgba(255,255,255, 0.03)',
        transition: 'all 0.2s',
      }}
      onClick={onSelect}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#e5e2e1',
              margin: 0,
              marginBottom: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {library.name}
          </h3>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--v2-accent)',
              background: 'rgba(var(--v2-accent-rgb), 0.12)',
              padding: '2px 8px',
              borderRadius: 4,
              display: 'inline-block',
            }}
          >
            {library.format}
          </div>
        </div>

        {/* Actions */}
        {(onEdit || onDelete) && (
          <div style={{ display: 'flex', gap: 4 }}>
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                style={{
                  padding: 6,
                  background: 'rgba(var(--v2-accent-rgb), 0.08)',
                  border: '1px solid rgba(var(--v2-accent-rgb), 0.15)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                }}
                title="Edit library"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16, color: 'var(--v2-accent)' }}
                >
                  edit
                </span>
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${library.name}"? This cannot be undone.`)) {
                    onDelete();
                  }
                }}
                style={{
                  padding: 6,
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.15)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                }}
                title="Delete library"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16, color: '#ef4444' }}
                >
                  delete
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Description */}
      <p
        style={{
          fontSize: 12,
          color: '#cdc3d7',
          margin: 0,
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {library.description}
      </p>

      {/* Reference count */}
      {library.reference_count !== undefined && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: '#cdc3d7',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            image
          </span>
          <span>
            {library.reference_count}{' '}
            {library.reference_count === 1 ? 'reference image' : 'reference images'}
          </span>
        </div>
      )}

      {/* Selected indicator */}
      {isSelected && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            background: 'rgba(var(--v2-accent-rgb), 0.12)',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--v2-accent)',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            check_circle
          </span>
          <span>Selected</span>
        </div>
      )}
    </GlassCard>
  );
}
