'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Narrator } from '@repo/db';
import { GlassCard } from '@/app/(authenticated)/_components/glass-card';

interface NarratorCardProps {
  narrator: Narrator;
  canManage: boolean;
}

export function NarratorCard({ narrator, canManage }: NarratorCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete "${narrator.name}"? This will remove the narrator and all associated pose images.`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/narrators/${narrator.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete narrator');
      }

      // Reload page to reflect changes
      window.location.reload();
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
      setIsDeleting(false);
    }
  };

  return (
    <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid rgba(var(--v2-accent-rgb), 0.10)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#e5e2e1', margin: 0 }}>
            {narrator.name}
          </h3>
          {narrator.is_default && (
            <span style={{
              fontSize: 8,
              fontWeight: 700,
              color: 'var(--v2-accent)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              padding: '3px 6px',
              borderRadius: 3,
              background: 'rgba(var(--v2-accent-rgb), 0.15)',
            }}>
              Default
            </span>
          )}
        </div>
        <p style={{ fontSize: 10, color: '#cdc3d7', margin: 0, lineHeight: 1.4 }}>
          {narrator.description}
        </p>
      </div>

      {/* Tags */}
      {narrator.tags && narrator.tags.length > 0 && (
        <div style={{
          padding: '10px 16px',
          background: 'rgba(0,0,0,0.15)',
          borderBottom: '1px solid rgba(var(--v2-accent-rgb), 0.10)',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {narrator.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 9,
                  color: 'rgba(205,195,215,0.6)',
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.05)',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Status */}
      <div style={{
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 10,
        color: narrator.is_active ? '#4ade80' : '#f87171',
        borderBottom: '1px solid rgba(var(--v2-accent-rgb), 0.10)',
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          {narrator.is_active ? 'check_circle' : 'cancel'}
        </span>
        {narrator.is_active ? 'Active' : 'Inactive'}
      </div>

      {/* Actions */}
      <div style={{
        padding: '10px 16px',
        display: 'flex',
        gap: 6,
        justifyContent: 'flex-end',
      }}>
        <Link
          href={`/narrators/${narrator.id}`}
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--v2-accent)',
            textDecoration: 'none',
            padding: '5px 10px',
            borderRadius: 4,
            background: 'rgba(var(--v2-accent-rgb), 0.1)',
            border: '1px solid rgba(var(--v2-accent-rgb), 0.2)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>visibility</span>
          Poses
        </Link>
        {canManage && (
          <>
            <Link
              href={`/narrators/${narrator.id}/edit`}
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#cdc3d7',
                textDecoration: 'none',
                padding: '5px 10px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>edit</span>
              Edit
            </Link>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: isDeleting ? '#666' : '#f87171',
                background: isDeleting ? 'rgba(255,255,255,0.05)' : 'rgba(248,113,113,0.1)',
                border: `1px solid ${isDeleting ? 'rgba(255,255,255,0.1)' : 'rgba(248,113,113,0.2)'}`,
                padding: '5px 10px',
                borderRadius: 4,
                cursor: isDeleting ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>delete</span>
              {isDeleting ? '...' : 'Delete'}
            </button>
          </>
        )}
      </div>
    </GlassCard>
  );
}
