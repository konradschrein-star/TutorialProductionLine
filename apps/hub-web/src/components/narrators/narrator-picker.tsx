'use client';

import { useEffect, useState } from 'react';
import type { Narrator } from '@repo/db';
import { GlassCard } from '@/app/(authenticated)/_components/glass-card';

interface NarratorPickerProps {
  channelId: string;
  selectedNarratorId: string | null;
  onSelect: (narratorId: string | null) => void;
}

export function NarratorPicker({
  channelId,
  selectedNarratorId,
  onSelect,
}: NarratorPickerProps) {
  const [narrators, setNarrators] = useState<Narrator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadNarrators() {
      setLoading(true);
      try {
        const res = await fetch(`/api/narrators?channel_id=${channelId}`);
        if (res.ok) {
          // Check if response is actually JSON (not HTML redirect)
          const contentType = res.headers.get('content-type');
          if (contentType?.includes('application/json')) {
            const data = await res.json();
            const narratorList = data.narrators || [];
            setNarrators(narratorList);

            // Auto-select default narrator if none selected
            if (!selectedNarratorId && narratorList.length > 0) {
              const defaultNarrator = narratorList.find((n: Narrator) => n.is_default);
              if (defaultNarrator) {
                onSelect(defaultNarrator.id);
              }
            }
          } else {
            // Non-JSON response (likely HTML redirect) - treat as empty
            setNarrators([]);
          }
        } else {
          // Non-OK response - treat as empty
          setNarrators([]);
        }
      } catch (err) {
        // Silently handle errors - component will show "No narrators configured" message
        setNarrators([]);
      } finally {
        setLoading(false);
      }
    }

    if (channelId) {
      loadNarrators();
    }
  }, [channelId, selectedNarratorId, onSelect]);

  if (loading) {
    return (
      <div style={{ padding: '16px', color: '#cdc3d7', fontSize: 12 }}>
        Loading narrators...
      </div>
    );
  }

  if (narrators.length === 0) {
    return (
      <div style={{ padding: '16px', color: 'rgba(205,195,215,0.5)', fontSize: 11 }}>
        No narrators configured for this channel. Create one or proceed without.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: '#cdc3d7',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}>
        Narrator (Optional)
      </div>

      {/* None Option */}
      <div onClick={() => onSelect(null)} style={{ cursor: 'pointer' }}>
        <GlassCard
          style={{
            padding: '12px 16px',
            border: `2px solid ${selectedNarratorId === null ? 'var(--v2-accent)' : 'transparent'}`,
            background: selectedNarratorId === null ? 'rgba(var(--v2-accent-rgb), 0.08)' : undefined,
          }}
        >
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e5e2e1', marginBottom: 2 }}>
          No Narrator
        </div>
        <div style={{ fontSize: 10, color: '#cdc3d7' }}>
          Generate scenes without narrator character
        </div>
        </GlassCard>
      </div>

      {/* Narrators */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 12,
      }}>
        {narrators
          .filter((n) => n.is_active)
          .map((narrator) => (
            <div key={narrator.id} onClick={() => onSelect(narrator.id)} style={{ cursor: 'pointer' }}>
              <GlassCard
                style={{
                  padding: '12px 16px',
                  border: `2px solid ${selectedNarratorId === narrator.id ? 'var(--v2-accent)' : 'transparent'}`,
                  background: selectedNarratorId === narrator.id ? 'rgba(var(--v2-accent-rgb), 0.08)' : undefined,
                }}
              >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e5e2e1' }}>
                    {narrator.name}
                  </div>
                  {narrator.is_default && (
                    <div style={{
                      fontSize: 8,
                      fontWeight: 700,
                      color: 'var(--v2-accent)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      marginTop: 2,
                    }}>
                      Default
                    </div>
                  )}
                </div>
                {selectedNarratorId === narrator.id && (
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--v2-accent)' }}>
                    check_circle
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10, color: '#cdc3d7', lineHeight: 1.4 }}>
                {narrator.description}
              </div>
              </GlassCard>
            </div>
          ))}
      </div>
    </div>
  );
}
