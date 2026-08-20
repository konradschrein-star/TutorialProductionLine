'use client';

import { useEffect, useState } from 'react';
import { GlassCard } from '@/app/(authenticated)/_components/glass-card';
import { NarratorCard } from './narrator-card';
import type { Narrator } from '@repo/db';

interface Channel {
  id: string;
  name: string;
  youtube_channel_id: string;
  language: string;
}

interface NarratorsByChannelViewProps {
  channels: Channel[];
  canManage: boolean;
}

export function NarratorsByChannelView({ channels, canManage }: NarratorsByChannelViewProps) {
  const [narratorsByChannel, setNarratorsByChannel] = useState<Record<string, Narrator[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadNarrators() {
      try {
        const results: Record<string, Narrator[]> = {};

        await Promise.all(
          channels.map(async (channel) => {
            const res = await fetch(`/api/narrators?channel_id=${channel.id}`);
            if (res.ok) {
              const data = await res.json();
              results[channel.id] = data.narrators || [];
            }
          })
        );

        setNarratorsByChannel(results);
      } catch (err) {
        console.error('Failed to load narrators:', err);
      } finally {
        setLoading(false);
      }
    }

    loadNarrators();
  }, [channels]);

  if (loading) {
    return (
      <GlassCard style={{ padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ color: 'rgba(205,195,215,0.4)', fontSize: 12, margin: 0 }}>
          Loading narrators...
        </p>
      </GlassCard>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {channels.map((channel) => {
        const narrators = narratorsByChannel[channel.id] || [];

        return (
          <div key={channel.id}>
            {/* Channel Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: '#e5e2e1', margin: 0 }}>
                {channel.name}
              </h2>
              <span style={{ fontSize: 11, color: '#cdc3d7' }}>
                {narrators.length} narrator{narrators.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Narrators Grid */}
            {narrators.length === 0 ? (
              <GlassCard style={{ padding: '24px', textAlign: 'center' }}>
                <p style={{ color: 'rgba(205,195,215,0.4)', fontSize: 11, margin: 0 }}>
                  No narrators for this channel yet.
                </p>
              </GlassCard>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 12,
              }}>
                {narrators.map((narrator) => (
                  <NarratorCard
                    key={narrator.id}
                    narrator={narrator}
                    canManage={canManage}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
