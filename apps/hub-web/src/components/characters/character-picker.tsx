'use client';

import { useEffect, useState } from 'react';
import type { Character } from '@repo/db';
import { GlassCard } from '@/app/(authenticated)/_components/glass-card';

interface CharacterPickerProps {
  channelId: string;
  selectedCharacterId: string | null;
  onSelect: (characterId: string | null) => void;
}

export function CharacterPicker({
  channelId,
  selectedCharacterId,
  onSelect,
}: CharacterPickerProps) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCharacters() {
      setLoading(true);
      try {
        const res = await fetch(`/api/characters?channel_id=${channelId}`);
        if (res.ok) {
          // Check if response is actually JSON (not HTML redirect)
          const contentType = res.headers.get('content-type');
          if (contentType?.includes('application/json')) {
            const data = await res.json();
            const characterList = data.characters || [];
            setCharacters(characterList);

            // Auto-select first character if only one exists and none selected
            if (!selectedCharacterId && characterList.length === 1) {
              onSelect(characterList[0]!.id);
            }
          } else {
            // Non-JSON response (likely HTML redirect) - treat as empty
            setCharacters([]);
          }
        } else {
          // Non-OK response - treat as empty
          setCharacters([]);
        }
      } catch (err) {
        // Silently handle errors - component will show "No characters configured" message
        setCharacters([]);
      } finally {
        setLoading(false);
      }
    }

    if (channelId) {
      loadCharacters();
    }
  }, [channelId, selectedCharacterId, onSelect]);

  if (loading) {
    return (
      <div style={{ padding: '16px', color: '#cdc3d7', fontSize: 12 }}>
        Loading characters...
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div style={{ padding: '16px', color: 'rgba(205,195,215,0.5)', fontSize: 11 }}>
        No characters configured for this channel. Create one or proceed without.
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
        Character (Optional)
      </div>

      {/* None Option */}
      <div onClick={() => onSelect(null)} style={{ cursor: 'pointer' }}>
        <GlassCard
          style={{
            padding: '12px 16px',
            border: `2px solid ${selectedCharacterId === null ? 'var(--v2-accent)' : 'transparent'}`,
            background: selectedCharacterId === null ? 'rgba(var(--v2-accent-rgb), 0.08)' : undefined,
          }}
        >
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e5e2e1', marginBottom: 2 }}>
          No Character
        </div>
        <div style={{ fontSize: 10, color: '#cdc3d7' }}>
          Generate scenes without character persona
        </div>
        </GlassCard>
      </div>

      {/* Characters */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 12,
      }}>
        {characters
          .filter((c) => c.is_active)
          .map((character) => (
            <div key={character.id} onClick={() => onSelect(character.id)} style={{ cursor: 'pointer' }}>
              <GlassCard
                style={{
                  padding: '12px 16px',
                  border: `2px solid ${selectedCharacterId === character.id ? 'var(--v2-accent)' : 'transparent'}`,
                  background: selectedCharacterId === character.id ? 'rgba(var(--v2-accent-rgb), 0.08)' : undefined,
                }}
              >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e5e2e1' }}>
                    {character.name}
                  </div>
                </div>
                {selectedCharacterId === character.id && (
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--v2-accent)' }}>
                    check_circle
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10, color: '#cdc3d7', lineHeight: 1.4 }}>
                {character.description}
              </div>
              </GlassCard>
            </div>
          ))}
      </div>
    </div>
  );
}
